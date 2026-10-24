import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@ezapply/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentCommand } from "../src/agent/child.js";
import {
  CODEX_RULES,
  CodexReader,
  codexBackend,
  codexInput,
  codexInstructions,
  codexModels,
  codexPolicy,
  codexServers,
  PLAN_LINE,
} from "../src/agent/codex.js";
import { NeedsYou } from "../src/agent/needs.js";
import { PANEL_PROMPT, PART_PROMPTS } from "../src/agent/process.js";
import { AgentService } from "../src/agent/service.js";
import { SESSION_ENV } from "../src/endpoints.js";
import { createLogger } from "../src/logger.js";
import { waitFor } from "../src/util/wait.js";
import { Workspace } from "../src/workspace/workspace.js";

const CODEX: AgentCommand = {
  file: process.execPath,
  args: [join(import.meta.dirname, "codex-app-server-stub.mjs")],
  shell: false,
};
const log = createLogger({ toFile: false, level: "silent" });
const AT = "2026-01-01T00:00:00.000Z";

describe("reading Codex's app server", () => {
  const reader = () => {
    let ms = 0;
    const r = new CodexReader(
      () => AT,
      () => ms,
    );
    return { r, advance: (by: number) => (ms += by) };
  };
  const item = (o: object) => ({ threadId: "t1", turnId: "u1", item: o });

  it("names the thread, and reports ezapply's server once it's up", () => {
    const { r } = reader();
    expect(r.read("mcpServer/startupStatus/updated", { name: "ezapply", status: "starting" })).toEqual([]);
    expect(r.started("t1", true)).toEqual([
      { type: "agentSession", id: "t1" },
      { type: "init", sessionId: "t1" },
    ]);
    expect(r.read("mcpServer/startupStatus/updated", { name: "other", status: "ready" })).toEqual([]);
    expect(r.read("mcpServer/startupStatus/updated", { name: "ezapply", status: "ready" })).toEqual([
      { type: "init", sessionId: "t1", mcpServers: [{ name: "ezapply", status: "connected" }] },
    ]);
    expect(r.read("mcpServer/startupStatus/updated", { name: "ezapply", status: "ready" })).toEqual([]);
  });

  it("says at once when the workspace names no ezapply server, and passes a failed one's state on", () => {
    expect(reader().r.started("t1", false).at(-1)).toEqual({ type: "init", sessionId: "t1", mcpServers: [] });
    const { r } = reader();
    r.read("mcpServer/startupStatus/updated", { name: "ezapply", status: "failed" });
    expect(r.started("t1", true).at(-1)).toEqual({
      type: "init",
      sessionId: "t1",
      mcpServers: [{ name: "ezapply", status: "failed" }],
    });
  });

  it("marks the user's messages taken, but not a deny's reason ezapply sent itself", () => {
    const { r } = reader();
    const user = { type: "userMessage", id: "a", clientId: null, content: [{ type: "text", text: "hi" }] };
    expect(r.read("item/started", item(user))).toEqual([{ type: "taken", text: "hi" }]);
    r.ownMessage("ezapply-deny-1", "The user denied this in the ezapply panel.");
    const own = { ...user, clientId: "ezapply-deny-1", content: [{ type: "text", text: "anything" }] };
    expect(r.read("item/started", item(own))).toEqual([]);
    // Should the id not come back, its words tell it.
    r.ownMessage("ezapply-deny-2", "No.");
    expect(r.read("item/started", item({ ...user, content: [{ type: "text", text: "No." }] }))).toEqual([]);
  });

  it("folds calls into the panel's tools: ezapply's as Claude Code names them, a command by what it runs", () => {
    const { r } = reader();
    const call = { type: "mcpToolCall", id: "c1", server: "ezapply", tool: "ask_user", arguments: { title: "Work" } };
    expect(r.read("item/started", item({ ...call, status: "inProgress" }))).toEqual([
      { type: "event", event: { kind: "tool", at: AT, id: "c1", name: "mcp__ezapply__ask_user", summary: "Work" } },
    ]);
    expect(r.read("item/completed", item({ ...call, status: "completed" }))).toEqual([
      { type: "event", event: { kind: "toolDone", at: AT, id: "c1", ok: true } },
    ]);
    const command = {
      type: "commandExecution",
      id: "x1",
      command: '"powershell.exe" -Command "git status"',
      commandActions: [{ type: "unknown", command: "git status" }],
    };
    expect(r.read("item/started", item({ ...command, status: "inProgress" }))).toEqual([
      { type: "event", event: { kind: "tool", at: AT, id: "x1", name: "Shell", summary: "git status" } },
    ]);
    expect(
      r.read("item/completed", item({ ...command, status: "failed", exitCode: 1, aggregatedOutput: "not a repo\n" })),
    ).toEqual([
      { type: "event", event: { kind: "toolDone", at: AT, id: "x1", ok: false, error: "exit code 1: not a repo" } },
    ]);
    const patch = { type: "fileChange", id: "f1", changes: [{ path: "/ws/a.tex", diff: "+x" }], status: "inProgress" };
    expect(r.read("item/started", item(patch))).toEqual([
      { type: "event", event: { kind: "tool", at: AT, id: "f1", name: "Patch", summary: "/ws/a.tex" } },
    ]);
    expect(r.changes("f1")).toEqual([{ path: "/ws/a.tex", diff: "+x" }]);
    expect(r.read("item/completed", item({ ...patch, status: "declined" }))).toEqual([
      { type: "event", event: { kind: "toolDone", at: AT, id: "f1", ok: false, error: "Declined" } },
    ]);
    expect(r.read("item/started", item({ type: "reasoning", id: "r1" }))).toEqual([]);
  });

  it("shows an agent message once complete, and ends a turn with the thread's tokens", () => {
    const { r, advance } = reader();
    expect(r.read("item/started", item({ type: "agentMessage", id: "m", text: "" }))).toEqual([]);
    expect(r.read("item/completed", item({ type: "agentMessage", id: "m", text: " Done. " }))).toEqual([
      { type: "event", event: { kind: "text", at: AT, text: "Done." } },
    ]);
    r.read("turn/started", { turn: { id: "u1" } });
    advance(2000);
    r.read("thread/tokenUsage/updated", { tokenUsage: { total: { totalTokens: 13_500 } } });
    expect(r.read("turn/completed", { turn: { id: "u1", status: "completed", durationMs: null } })).toEqual([
      {
        type: "turnEnd",
        queued: 0,
        event: { kind: "turnEnd", at: AT, ok: true, totalTokens: 13_500, durationMs: 2000 },
      },
    ]);
    expect(r.read("turn/completed", { turn: { status: "interrupted", durationMs: 5 } })[0]).toMatchObject({
      event: { ok: false, interrupted: true, durationMs: 5 },
    });
    expect(r.read("turn/completed", { turn: { status: "failed", error: { message: "quota" } } })[0]).toMatchObject({
      event: { ok: false, error: "quota" },
    });
  });

  it("says when the API is retried, and leaves a final error to the turn's end", () => {
    const { r } = reader();
    expect(r.read("error", { error: { message: "overloaded" }, willRetry: true })).toEqual([
      {
        type: "event",
        event: { kind: "notice", at: AT, level: "warn", text: "The API failed (overloaded); retrying." },
      },
    ]);
    expect(r.read("error", { error: { message: "overloaded" }, willRetry: false })).toEqual([]);
  });
});

describe("what a Codex thread runs with", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-codex-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps each panel mode to an approval policy, a reviewer and a sandbox", () => {
    expect(codexPolicy("default")).toEqual({
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    });
    expect(codexPolicy("acceptEdits")).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "user" });
    expect(codexPolicy("auto")).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "auto_review" });
    expect(codexPolicy("plan")).toEqual({ approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" });
    expect(codexPolicy("dontAsk")).toMatchObject({ approvalPolicy: "never", sandbox: "workspace-write" });
  });

  it("turns the user's servers off, and runs ezapply's unasked with its session", () => {
    expect(codexServers(["mine"], { command: "node", args: ["main.js", "mcp"] }, "s-1")).toEqual({
      mine: { enabled: false },
      ezapply: {
        command: "node",
        args: ["main.js", "mcp"],
        env: { [SESSION_ENV]: "s-1" },
        default_tools_approval_mode: "approve",
        tool_timeout_sec: 3600,
        enabled: true,
      },
    });
    expect(codexServers(["mine"], null, "s-1")).toEqual({ mine: { enabled: false } });
  });

  it("gives the panel's prompt, the workspace's rules, EZAPPLY.md and the preferences as instructions", async () => {
    expect(codexInstructions(dir)).toBe(`${PANEL_PROMPT}\n\n${CODEX_RULES}`);
    await writeFile(join(dir, "EZAPPLY.md"), "# ezapply workspace\n");
    await mkdir(join(dir, "profile"));
    await writeFile(join(dir, "profile", "preferences.md"), "Warm tone.\n");
    expect(codexInstructions(dir, "fill")).toBe(
      `${PANEL_PROMPT} ${PART_PROMPTS.fill}\n\n${CODEX_RULES}\n\n# ezapply workspace\n\n` +
        "# The user's preferences (profile/preferences.md)\n\nWarm tone.",
    );
  });

  it("runs a skill the message starts with, and says Plan only before a plan turn's message", async () => {
    const text = (t: string) => ({ type: "text", text: t, text_elements: [] });
    expect(codexInput(dir, "/ezapply-resume Tailor it.")).toEqual([text("/ezapply-resume Tailor it.")]);
    await mkdir(join(dir, ".agents", "skills", "ezapply-resume"), { recursive: true });
    await writeFile(join(dir, ".agents", "skills", "ezapply-resume", "SKILL.md"), "---\nname: ezapply-resume\n---\n");
    expect(codexInput(dir, "/ezapply-resume Tailor it.", "plan")).toEqual([
      { type: "skill", name: "ezapply-resume", path: join(dir, ".agents", "skills", "ezapply-resume", "SKILL.md") },
      text(PLAN_LINE),
      text("/ezapply-resume Tailor it."),
    ]);
  });

  it("lists the models the app server offers, without hidden ones", async () => {
    expect(await codexModels(CODEX)).toEqual([{ id: "model-a", label: "Model A" }]);
  });
});

describe("the agent service with Codex", () => {
  let dir: string;
  let agent: AgentService;
  let needs: NeedsYou;
  let events: [string, AgentEvent][];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-codex-"));
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { ezapply: { type: "stdio", command: "node", args: ["main.js", "mcp"] } } }),
    );
    events = [];
  });
  afterEach(async () => {
    await agent?.close();
    await rm(dir, { recursive: true, force: true });
  });

  function make() {
    needs = new NeedsYou();
    agent = new AgentService({
      workspace: new Workspace(dir),
      needs,
      log,
      backends: { codex: codexBackend(CODEX) },
      env: { ...process.env, STUB_LOG: join(dir, "stub.log") },
    });
    agent.onEvent((k, e) => events.push([k, e]));
    return agent;
  }
  const turns = (k: string) => events.filter(([key, e]) => key === k && e.kind === "turnEnd").length;
  const after = async (k: string, n: number) => {
    await waitFor(async () => (turns(k) >= n ? true : null), 10_000);
    expect(turns(k)).toBeGreaterThanOrEqual(n);
  };
  type Logged = { args?: string[]; method?: string; params?: Record<string, unknown>; decision?: string };
  const logged = async () =>
    (await readFile(join(dir, "stub.log"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Logged);
  const requests = async (method: string) => (await logged()).filter((l) => l.method === method);
  const conversations = async () =>
    JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8")) as {
      conversations: Record<
        string,
        { agent: string; agentSessionId?: string; sessionId: string; totalTokens?: number }
      >;
    };

  it("relays a turn with ezapply's server alone, and continues Codex's thread in a later process", async () => {
    make();
    expect((await agent.settings()).agent).toBe("codex");
    await agent.send("p1/tailor", "hello");
    await after("p1/tailor", 1);
    expect(events.map(([, e]) => e.kind)).toEqual(["user", "user", "tool", "toolDone", "text", "turnEnd"]);
    expect(events[2]?.[1]).toMatchObject({ kind: "tool", name: "mcp__ezapply__ask_user", summary: "Work history" });
    expect(events[4]?.[1]).toMatchObject({ kind: "text", text: "echo: hello" });
    expect(events[5]?.[1]).toMatchObject({ kind: "turnEnd", ok: true, totalTokens: 1000, durationMs: 1234 });
    // The server connected: no notice.
    expect(events.some(([, e]) => e.kind === "notice")).toBe(false);

    const [start] = await requests("thread/start");
    const sessionId = (await conversations()).conversations["p1/tailor"]?.sessionId;
    expect(start?.params).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      config: {
        model_reasoning_effort: "medium",
        mcp_servers: {
          "user-server": { enabled: false },
          ezapply: { command: "node", args: ["main.js", "mcp"], env: { [SESSION_ENV]: sessionId } },
        },
      },
    });
    expect(String(start?.params?.developerInstructions)).toContain(PART_PROMPTS.tailor);
    expect((await logged())[0]?.args).toEqual([
      "app-server",
      "--disable",
      "plugins",
      "--disable",
      "apps",
      "-c",
      "notify=[]",
    ]);
    expect((await requests("turn/start"))[0]?.params).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "workspaceWrite" },
      effort: "medium",
      input: [{ type: "text", text: "hello" }],
    });

    await waitFor(async () => ((await conversations()).conversations["p1/tailor"]?.totalTokens ? true : null), 5000);
    const record = (await conversations()).conversations["p1/tailor"];
    expect(record).toMatchObject({
      agent: "codex",
      agentSessionId: expect.stringMatching(/^thr-\d+$/),
      totalTokens: 1000,
    });
    expect(await agent.usage("p1/tailor")).toEqual({ totalTokens: 1000 });
    await agent.close();

    make();
    await agent.send("p1/tailor", "later");
    await after("p1/tailor", 2);
    expect((await requests("thread/resume")).at(-1)?.params).toMatchObject({ threadId: record?.agentSessionId });
  });

  it("starts a new thread when Codex no longer has the old one", async () => {
    make();
    await agent.send("general", "one");
    await after("general", 1);
    await agent.close();
    const file = await conversations();
    const c = file.conversations.general as { agentSessionId?: string };
    c.agentSessionId = "gone-thread";
    await writeFile(join(dir, "agent", "conversations.json"), JSON.stringify(file));

    make();
    await agent.send("general", "two");
    await after("general", 2);
    expect(events.some(([, e]) => e.kind === "notice" && /couldn't be reopened/.test(e.text))).toBe(true);
    expect((await requests("thread/start")).length).toBe(2);
  });

  it("asks for an approval on the panel's card, and tells Codex a deny's reason word for word", async () => {
    make();
    await agent.send("general", "approve");
    await waitFor(async () => (needs.list().length > 0 ? true : null), 10_000);
    const [card] = needs.list();
    expect(card).toMatchObject({
      kind: "permission",
      conversation: "general",
      toolName: "Shell",
      input: { command: "git status" },
      description: "To see what changed",
    });
    // Typing in the chat while the card is open denies it, the message being the reason.
    await agent.send("general", "Not now, read the diff instead");
    await after("general", 1);
    expect((await logged()).find((l) => l.decision)?.decision).toBe("decline");
    expect((await requests("turn/steer")).at(-1)?.params).toMatchObject({
      clientUserMessageId: "ezapply-deny-1",
      input: [{ type: "text", text: "The user denied this in the ezapply panel: Not now, read the diff instead" }],
    });
    // The reason went in as ezapply's own message: no user message of the panel's is marked taken for it.
    const users = events.filter(([, e]) => e.kind === "user");
    expect(users.map(([, e]) => e.kind === "user" && e.text)).toEqual([
      "approve",
      "approve",
      "Not now, read the diff instead",
    ]);
    expect(events.find(([, e]) => e.kind === "card")?.[1]).toMatchObject({ outcome: "denied" });
  });

  it("allows a file change from its card, showing the files it touches", async () => {
    make();
    await agent.send("general", "edit");
    await waitFor(async () => (needs.list().length > 0 ? true : null), 10_000);
    const [card] = needs.list();
    expect(card).toMatchObject({ toolName: "Patch", input: { file_path: "C:\\ws\\notes.md", diff: "+a line" } });
    needs.decide(card?.id as string, true);
    await after("general", 1);
    expect((await logged()).find((l) => l.decision)?.decision).toBe("accept");
    expect(await requests("turn/steer")).toEqual([]);
  });

  it("stops a turn with an interrupt, keeping the process, and steers a message into the running turn", async () => {
    make();
    await agent.send("general", "slow");
    await waitFor(async () => (events.some(([, e]) => e.kind === "tool") ? true : null), 10_000);
    await agent.send("general", "also this");
    await waitFor(async () => ((await requests("turn/steer")).length > 0 ? true : null), 5000);
    expect((await requests("turn/steer"))[0]?.params).toMatchObject({ expectedTurnId: "turn-1" });
    await waitFor(async () => (agent.statusOf("general") === "working" ? true : null), 5000);
    expect(agent.stop("general")).toBe(true);
    await after("general", 1);
    expect(events.at(-1)?.[1]).toMatchObject({ kind: "turnEnd", interrupted: true });
    await agent.send("general", "next");
    await after("general", 2);
    expect((await logged()).filter((l) => l.args).length).toBe(1);
  });

  it("takes a new mode, model and effort from the next turn, without a new process", async () => {
    make();
    await agent.send("general", "one");
    await after("general", 1);
    await agent.setPrefs({
      agent: "codex",
      choices: { codex: { permissionMode: "default", model: "model-a", effort: "high" } },
    });
    await agent.send("general", "two");
    await after("general", 2);
    expect((await requests("turn/start")).at(-1)?.params).toMatchObject({
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      model: "model-a",
      effort: "high",
    });
    expect((await logged()).filter((l) => l.args).length).toBe(1);
    expect(events.some(([, e]) => e.kind === "notice")).toBe(false);
  });
});
