// Stands in for `codex app-server` in the agent tests. Its messages follow Codex 0.163's app server as recorded live
// (codex.ts reads them), with the values made up. Each start appends its arguments, and every request it gets and
// answer it's given, to $STUB_LOG. A message's last word picks the turn: anything → an ezapply call, then
// "echo: <text>"; "approve" → a command needing approval, then what it was told; "edit" → a file change needing
// approval; "slow" → a call that never ends (Stop interrupts it). A thread whose id starts "gone" can't be resumed.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const log = (o) => process.env.STUB_LOG && appendFileSync(process.env.STUB_LOG, `${JSON.stringify(o)}\n`);
log({ args });
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const notify = (method, params) => out({ method, params });

let thread;
let turn;
let turns = 0;
let tokens = 0;
let serverSeq = 0;
const waiting = new Map();
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = serverSeq++;
    waiting.set(id, resolve);
    out({ id, method, params });
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const item = (phase, o) => notify(`item/${phase}`, { threadId: thread, turnId: turn, item: o });
const usage = () => {
  tokens += 1000;
  notify("thread/tokenUsage/updated", {
    threadId: thread,
    turnId: turn,
    tokenUsage: { total: { totalTokens: tokens }, last: { totalTokens: 1000 }, modelContextWindow: null },
  });
};
const complete = (status) => {
  const t = turn;
  turn = undefined;
  notify("turn/completed", {
    threadId: thread,
    turn: { id: t, items: [], status, error: status === "failed" ? { message: "boom" } : null, durationMs: 1234 },
  });
};
const textOf = (input) =>
  input
    .filter((i) => i.type === "text")
    .map((i) => i.text)
    .join("\n");

async function runTurn(input) {
  const text = textOf(input);
  const word = text.split(/\s+/).pop();
  item("started", { type: "userMessage", id: `u-${turns}`, clientId: null, content: input });
  if (word === "slow") {
    item("started", {
      type: "mcpToolCall",
      id: "call-slow",
      server: "ezapply",
      tool: "get_form",
      status: "inProgress",
      arguments: {},
    });
    return;
  }
  if (word === "approve" || word === "edit") {
    const itemId = `exec-${turns}`;
    const started = turn;
    let decision;
    if (word === "approve") {
      const command = '"C:\\\\WINDOWS\\\\powershell.exe" -Command "git status"';
      item("started", {
        type: "commandExecution",
        id: itemId,
        command,
        commandActions: [{ type: "unknown", command: "git status" }],
        status: "inProgress",
      });
      ({ decision } = await ask("item/commandExecution/requestApproval", {
        kind: "command",
        threadId: thread,
        turnId: started,
        itemId,
        startedAtMs: 1,
        command,
        commandActions: [{ type: "unknown", command: "git status" }],
        reason: "To see what changed",
      }));
      item("completed", {
        type: "commandExecution",
        id: itemId,
        command,
        commandActions: [{ type: "unknown", command: "git status" }],
        status: decision === "accept" ? "completed" : "declined",
        exitCode: decision === "accept" ? 0 : null,
      });
    } else {
      const changes = [{ path: "C:\\ws\\notes.md", kind: { type: "update" }, diff: "+a line" }];
      item("started", { type: "fileChange", id: itemId, changes, status: "inProgress" });
      ({ decision } = await ask("item/fileChange/requestApproval", {
        threadId: thread,
        turnId: started,
        itemId,
        startedAtMs: 1,
        reason: null,
      }));
      item("completed", {
        type: "fileChange",
        id: itemId,
        changes,
        status: decision === "accept" ? "completed" : "declined",
      });
    }
    log({ decision });
    // A deny's reason is steered in: give it a moment to arrive.
    await wait(150);
    usage();
    item("completed", { type: "agentMessage", id: `m-${turns}`, text: `told: ${decision}` });
    complete("completed");
    return;
  }
  item("started", {
    type: "mcpToolCall",
    id: `call-${turns}`,
    server: "ezapply",
    tool: "ask_user",
    status: "inProgress",
    arguments: { title: "Work history" },
  });
  item("completed", {
    type: "mcpToolCall",
    id: `call-${turns}`,
    server: "ezapply",
    tool: "ask_user",
    status: "completed",
    arguments: { title: "Work history" },
    result: { content: [] },
    error: null,
  });
  usage();
  item("started", { type: "agentMessage", id: `m-${turns}`, text: "" });
  item("completed", { type: "agentMessage", id: `m-${turns}`, text: `echo: ${text.split("\n").pop()}` });
  complete("completed");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) {
    // An answer to one of ours.
    log({ answer: m });
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
    return;
  }
  log({ method: m.method, params: m.params });
  const reply = (result) => out({ id: m.id, result });
  const refuse = (message) => out({ id: m.id, error: { code: -32600, message } });
  switch (m.method) {
    case "initialize":
      return reply({ userAgent: "stub", codexHome: "/home/.codex", platformFamily: "unix", platformOs: "linux" });
    case "initialized":
      return;
    case "config/read":
      return reply({ config: { model: "m", mcp_servers: { "user-server": { command: "x" } } } });
    case "model/list":
      return reply({
        data: [
          { id: "model-a", model: "model-a", displayName: "Model A", hidden: false, isDefault: true },
          { id: "model-h", model: "model-h", displayName: "Hidden", hidden: true, isDefault: false },
        ],
        nextCursor: null,
      });
    case "thread/start":
    case "thread/resume": {
      if (m.method === "thread/resume" && m.params.threadId.startsWith("gone"))
        return refuse(`no rollout found for thread id ${m.params.threadId}`);
      thread = m.method === "thread/resume" ? m.params.threadId : `thr-${process.pid}`;
      reply({ thread: { id: thread, turns: [] }, model: "m" });
      if (m.params.config?.mcp_servers?.ezapply) {
        notify("mcpServer/startupStatus/updated", {
          threadId: thread,
          name: "ezapply",
          status: "starting",
          error: null,
        });
        notify("mcpServer/startupStatus/updated", { threadId: thread, name: "ezapply", status: "ready", error: null });
      }
      return;
    }
    case "turn/start": {
      turns++;
      turn = `turn-${turns}`;
      reply({ turn: { id: turn, items: [], status: "inProgress" } });
      notify("turn/started", { threadId: thread, turn: { id: turn, items: [], status: "inProgress" } });
      void runTurn(m.params.input);
      return;
    }
    case "turn/steer": {
      if (!turn || m.params.expectedTurnId !== turn) return refuse("no active turn to steer");
      reply({ turnId: turn });
      item("started", {
        type: "userMessage",
        id: `s-${turns}`,
        clientId: m.params.clientUserMessageId ?? null,
        content: m.params.input,
      });
      return;
    }
    case "turn/interrupt":
      reply({});
      if (turn === m.params.turnId) complete("interrupted");
      return;
    default:
      return refuse(`unknown method ${m.method}`);
  }
});
