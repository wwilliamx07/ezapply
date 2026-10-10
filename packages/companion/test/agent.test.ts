import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@ezapply/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NeedsYou } from "../src/agent/needs.js";
import { agentArgs, type ClaudeCommand } from "../src/agent/process.js";
import { AgentService } from "../src/agent/service.js";
import { readStreamLine, toolSummary } from "../src/agent/stream.js";
import { MemoryStore } from "../src/github/secrets.js";
import { createLogger } from "../src/logger.js";
import { type CompanionHandle, startCompanion } from "../src/main.js";
import { waitFor } from "../src/util/wait.js";
import { Workspace } from "../src/workspace/workspace.js";

const STUB = join(import.meta.dirname, "claude-stream-stub.mjs");
const claude: ClaudeCommand = { file: process.execPath, args: [STUB], shell: false };
const log = createLogger({ toFile: false, level: "silent" });
const AT = "2026-01-01T00:00:00.000Z";
const now = () => AT;

describe("reading Claude Code's stream-json", () => {
  // Shapes as recorded from Claude Code 2.1 (`claude -p --output-format stream-json --verbose`), values replaced.
  it("reads a turn: the session, the replayed message, text, a tool call and its result, the turn's end", () => {
    const lines = [
      {
        type: "system",
        subtype: "init",
        session_id: "s-1",
        tools: ["Bash"],
        mcp_servers: [{ name: "ezapply", status: "connected", source: "project" }],
      },
      {
        type: "user",
        message: { role: "user", content: "tailor my resume" },
        session_id: "s-1",
        parent_tool_use_id: null,
        uuid: "u1",
        isReplay: true,
      },
      {
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "thinking", thinking: "", signature: "x" }] },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        message: {
          id: "m1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Bash",
              input: { command: "echo   hello", description: "Print" },
              caller: { type: "direct" },
            },
          ],
        },
        parent_tool_use_id: null,
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ tool_use_id: "toolu_1", type: "tool_result", content: "hello", is_error: false }],
        },
        parent_tool_use_id: null,
        tool_use_result: { stdout: "hello" },
      },
      {
        type: "assistant",
        message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Done.\n" }] },
        parent_tool_use_id: "toolu_sub",
      },
      { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
      { type: "system", subtype: "post_turn_summary", status_detail: "done" },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 4846,
        total_cost_usd: 0.0074,
        terminal_reason: "completed",
        queued_turn_count: 0,
        result: "Done.",
      },
    ].map((l) => JSON.stringify(l));
    const items = lines.flatMap((l) => readStreamLine(l, now));
    expect(items).toEqual([
      { type: "init", sessionId: "s-1", mcpServers: [{ name: "ezapply", status: "connected" }] },
      { type: "taken", text: "tailor my resume" },
      { type: "event", event: { kind: "tool", at: AT, id: "toolu_1", name: "Bash", summary: "echo hello" } },
      { type: "event", event: { kind: "toolDone", at: AT, id: "toolu_1", ok: true } },
      { type: "event", event: { kind: "text", at: AT, text: "Done.", parent: "toolu_sub" } },
      {
        type: "turnEnd",
        queued: 0,
        event: { kind: "turnEnd", at: AT, ok: true, totalCostUsd: 0.0074, durationMs: 4846 },
      },
    ]);
  });

  it("reads a failed tool call, an interrupted turn, a failed turn, a retry and an interrupt's answer", () => {
    const read = (o: object) => readStreamLine(JSON.stringify(o), now);
    expect(
      read({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t2",
              is_error: true,
              content: [{ type: "text", text: "The user denied this." }],
            },
          ],
        },
      }),
    ).toEqual([
      { type: "event", event: { kind: "toolDone", at: AT, id: "t2", ok: false, error: "The user denied this." } },
    ]);
    expect(
      read({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        total_cost_usd: 0.01,
        terminal_reason: "aborted_tools",
        queued_turn_count: 1,
      }),
    ).toEqual([
      {
        type: "turnEnd",
        queued: 1,
        event: { kind: "turnEnd", at: AT, ok: false, interrupted: true, totalCostUsd: 0.01 },
      },
    ]);
    expect(
      read({ type: "result", subtype: "error_max_turns", is_error: true, result: "Reached the turn limit" }),
    ).toEqual([
      { type: "turnEnd", queued: 0, event: { kind: "turnEnd", at: AT, ok: false, error: "Reached the turn limit" } },
    ]);
    expect(
      read({
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 10,
        error: "overloaded",
        retry_delay_ms: 500,
      }),
    ).toEqual([
      {
        type: "event",
        event: { kind: "notice", at: AT, level: "warn", text: "The API failed (overloaded); retrying (1 of 10)." },
      },
    ]);
    expect(
      read({
        type: "control_response",
        response: { subtype: "success", request_id: "interrupt-1", response: { still_queued: [] } },
      }),
    ).toEqual([{ type: "controlResponse", requestId: "interrupt-1", ok: true }]);
    expect(readStreamLine("not json")).toEqual([]);
    expect(read({ type: "stream_event", event: {} })).toEqual([]);
  });

  it("folds a tool call to what it runs or touches", () => {
    expect(toolSummary("Edit", { file_path: "postings/x/resume.tex", old_string: "a", new_string: "b" })).toBe(
      "postings/x/resume.tex",
    );
    expect(toolSummary("Skill", { skill: "ezapply-resume" })).toBe("ezapply-resume");
    expect(toolSummary("mcp__ezapply__posting_active", {})).toBe("");
    expect(toolSummary("mcp__ezapply__tex_compile", { path: "postings/x/resume.tex" })).toBe(
      '{"path":"postings/x/resume.tex"}',
    );
    expect(toolSummary("mcp__ezapply__fill_fields", { fills: [{}, {}, {}], tabId: 4 })).toBe("3 fields");
    expect(toolSummary("mcp__ezapply__upload_file", { fieldId: "f", path: "postings/x/resume.pdf" })).toBe(
      "resume.pdf",
    );
    expect(toolSummary("mcp__ezapply__ask_user", { title: "Step 2: screening" })).toBe("Step 2: screening");
    expect(toolSummary("Bash", { command: "x".repeat(300) })).toHaveLength(200);
  });

  it("runs Claude Code headless with the panel's permissions and questions, starting or resuming a session", () => {
    const fresh = agentArgs("abc", false);
    expect(fresh).toEqual(expect.arrayContaining(["-p", "--verbose", "--replay-user-messages", "--session-id", "abc"]));
    expect(fresh.join(" ")).toContain("--input-format stream-json --output-format stream-json");
    // The defaults: auto mode, Sonnet, medium effort.
    expect(fresh.join(" ")).toContain(
      "--permission-mode auto --model sonnet --effort medium --permission-prompt-tool mcp__ezapply__permission_ask",
    );
    expect(fresh.join(" ")).toContain("--disallowedTools AskUserQuestion");
    expect(fresh).not.toContain("--bare");
    expect(agentArgs("abc", true).slice(-2)).toEqual(["--resume", "abc"]);
    const chosen = agentArgs("abc", false, { permissionMode: "default", model: "opus", effort: "max" }).join(" ");
    expect(chosen).toContain("--permission-mode default --model opus --effort max --permission-prompt-tool");
  });
});

describe("the agent service", () => {
  let dir: string;
  let workspace: Workspace;
  let needs: NeedsYou;
  let agent: AgentService;
  let events: [string, AgentEvent][];
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, STUB_LOG: join(dir, "starts.log"), ...extra });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-agent-"));
    workspace = new Workspace(dir);
    needs = new NeedsYou();
    events = [];
  });
  afterEach(async () => {
    await agent?.close();
    await rm(dir, { recursive: true, force: true });
  });

  function make(extraEnv: Record<string, string> = {}, withClaude = true) {
    agent = new AgentService({ workspace, needs, log, ...(withClaude ? { claude } : {}), env: env(extraEnv) });
    agent.onEvent((k, e) => events.push([k, e]));
    return agent;
  }
  const turns = (k: string) => events.filter(([key, e]) => key === k && e.kind === "turnEnd").length;
  const logged = async () =>
    (await readFile(join(dir, "starts.log"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as unknown);
  const starts = async () => (await logged()).filter((l): l is string[] => Array.isArray(l));
  const switches = async () => (await logged()).filter((l) => !Array.isArray(l));
  const after = async (k: string, n: number) => {
    await waitFor(async () => (turns(k) >= n ? true : null), 10_000);
    expect(turns(k)).toBeGreaterThanOrEqual(n);
  };

  it("relays a turn: the message (taken once Claude has it), Claude's text, the turn's cost; and keeps it as history", async () => {
    make();
    expect(agent.state()).toEqual({ status: "idle", queued: 0 });
    await agent.send("2026-01-01_acme_dev", "hello there");
    await after("2026-01-01_acme_dev", 1);
    const kinds = events.map(([, e]) => e.kind);
    expect(kinds).toEqual(["user", "user", "text", "turnEnd"]);
    expect(events[1]?.[1]).toMatchObject({ kind: "user", text: "hello there", taken: true });
    expect(events[2]?.[1]).toMatchObject({ kind: "text", text: "echo: hello there" });
    expect(events[3]?.[1]).toMatchObject({ kind: "turnEnd", ok: true, totalCostUsd: 0.01 });
    expect(agent.state()).toEqual({ status: "idle", conversation: "2026-01-01_acme_dev", queued: 0 });
    await waitFor(async () => ((await agent.history("2026-01-01_acme_dev")).length === 3 ? true : null), 5000);
    const history = await agent.history("2026-01-01_acme_dev");
    expect(history.map((e) => e.kind)).toEqual(["user", "text", "turnEnd"]);
    expect(history[0]).toMatchObject({ taken: true });
    expect(await agent.cost("2026-01-01_acme_dev")).toBe(0.01);
  });

  it("keeps one process per conversation, resumes a conversation's session, and refuses to switch while working", async () => {
    make();
    await agent.send("p1", "one");
    await after("p1", 1);
    await agent.send("p1", "two");
    await after("p1", 2);
    expect((await starts()).length).toBe(1);
    const first = (await starts())[0] as string[];
    const session = first[first.indexOf("--session-id") + 1] as string;

    await agent.send("general", "other");
    await after("general", 1);
    await agent.send("p1", "three");
    await after("p1", 3);
    const all = await starts();
    expect(all).toHaveLength(3);
    expect(all[2]?.slice(-2)).toEqual(["--resume", session]);

    await agent.send("p1", "slow");
    await waitFor(async () => (agent.state().status === "working" ? true : null), 5000);
    await expect(agent.send("general", "now")).rejects.toThrow(/another conversation/);
    expect(agent.stop()).toBe(true);
    await after("p1", 4);
    expect(events.filter(([, e]) => e.kind === "turnEnd").at(-1)?.[1]).toMatchObject({ ok: false, interrupted: true });
    expect(events.some(([, e]) => e.kind === "toolDone" && !e.ok)).toBe(true);
    expect(agent.state().status).toBe("idle");
  });

  it("starts a new session on Reset, keeping the old one as earlier, with an empty history", async () => {
    make();
    await agent.send("p1", "one");
    await after("p1", 1);
    const before = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    await agent.reset("p1");
    expect(await agent.history("p1")).toEqual([]);
    await agent.send("p1", "fresh");
    await after("p1", 2);
    const file = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    const c = file.conversations.p1;
    expect(c.sessionId).not.toBe(before.conversations.p1.sessionId);
    expect(c.earlier).toEqual([expect.objectContaining({ sessionId: before.conversations.p1.sessionId })]);
    const last = (await starts()).at(-1) as string[];
    expect(last.slice(-2)).toEqual(["--session-id", c.sessionId]);
  });

  it("keeps the permission mode and model, starts with them, and switches a running conversation at once", async () => {
    make();
    expect(await agent.settings()).toEqual({ permissionMode: "auto", model: "sonnet", effort: "medium" });
    await agent.send("p1", "one");
    await after("p1", 1);
    expect(await agent.setSettings({ permissionMode: "plan" })).toEqual({
      permissionMode: "plan",
      model: "sonnet",
      effort: "medium",
    });
    await agent.setSettings({ model: "haiku" });
    await waitFor(async () => ((await switches()).length === 2 ? true : null), 5000);
    expect(await switches()).toEqual([
      { subtype: "set_permission_mode", mode: "plan" },
      { subtype: "set_model", model: "haiku" },
    ]);
    // Unchanged settings send nothing; a mode the panel doesn't offer is refused.
    await agent.setSettings({ model: "haiku" });
    await expect(agent.setSettings({ permissionMode: "bypassPermissions" as "plan" })).rejects.toThrow();
    expect(JSON.parse(await readFile(join(dir, "agent", "settings.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      permissionMode: "plan",
      model: "haiku",
      effort: "medium",
    });

    // ezapply started again: the settings are read back, and the next process starts with them.
    await agent.close();
    events = [];
    make();
    expect(await agent.settings()).toEqual({ permissionMode: "plan", model: "haiku", effort: "medium" });
    await agent.send("p1", "two");
    await after("p1", 1);
    expect((await starts()).at(-1)?.join(" ")).toContain("--permission-mode plan --model haiku --effort medium");
    expect(await switches()).toHaveLength(2);
  });

  it("restarts the conversation's process for a new effort: at once when idle, after the turn while working", async () => {
    make();
    await agent.send("p1", "one");
    await after("p1", 1);
    await agent.setSettings({ effort: "high" });
    expect(agent.state()).toEqual({ status: "idle", queued: 0 });
    await agent.send("p1", "two");
    await after("p1", 2);
    const session = (await starts())[0]?.at(-1) as string;
    expect((await starts()).at(-1)?.join(" ")).toContain(`--effort high`);
    expect((await starts()).at(-1)?.slice(-2)).toEqual(["--resume", session]);

    // While it works, the process stays until the turn ends.
    await agent.send("p1", "slow");
    await waitFor(async () => (agent.state().status === "working" ? true : null), 5000);
    await agent.setSettings({ effort: "low" });
    expect(agent.state().status).toBe("working");
    agent.stop();
    await after("p1", 3);
    await waitFor(async () => (agent.state().conversation === undefined ? true : null), 5000);
    await agent.send("p1", "three");
    await after("p1", 4);
    expect(await starts()).toHaveLength(3);
    expect((await starts()).at(-1)?.join(" ")).toContain(`--effort low`);
    expect(await switches()).toEqual([]);
  });

  it("reads each setting on its own, so one an older build kept falls back alone", async () => {
    await mkdir(join(dir, "agent"), { recursive: true });
    await writeFile(
      join(dir, "agent", "settings.json"),
      JSON.stringify({ schemaVersion: 1, permissionMode: "plan", model: "default" }),
    );
    make();
    expect(await agent.settings()).toEqual({ permissionMode: "plan", model: "sonnet", effort: "medium" });
  });

  it("says so when Claude Code refuses a switch, and keeps the setting for the next start", async () => {
    make({ STUB_REFUSE_SWITCH: "1" });
    await agent.send("p1", "one");
    await after("p1", 1);
    await agent.setSettings({ permissionMode: "plan" });
    await waitFor(async () => (events.some(([, e]) => e.kind === "notice") ? true : null), 5000);
    expect(events.find(([, e]) => e.kind === "notice")?.[1]).toMatchObject({
      level: "warn",
      text: expect.stringContaining("didn't switch the permission mode to plan: not allowed here"),
    });
    expect(await agent.settings()).toMatchObject({ permissionMode: "plan" });
  });

  it("starts afresh when a session can't be resumed, and says so", async () => {
    make();
    await agent.send("p1", "one");
    await after("p1", 1);
    await agent.close();
    make({ STUB_FAIL_RESUME: "1" });
    await agent.send("p1", "again");
    await after("p1", 2);
    expect(events.some(([, e]) => e.kind === "notice" && /couldn't be reopened/.test(e.text))).toBe(true);
    expect(events.some(([, e]) => e.kind === "text" && e.text === "echo: again")).toBe(true);
  });

  it("tells the user when Claude Code stops mid-turn, or runs without ezapply's tools", async () => {
    make({ STUB_MCP_STATUS: "failed" });
    await agent.send("p1", "hi");
    await after("p1", 1);
    expect(
      events.some(
        ([, e]) => e.kind === "notice" && e.level === "error" && /tools aren't connected.*failed/.test(e.text),
      ),
    ).toBe(true);
    await agent.send("p1", "crash");
    await waitFor(
      async () => (events.some(([, e]) => e.kind === "notice" && /stopped unexpectedly/.test(e.text)) ? true : null),
      5000,
    );
    expect(events.find(([, e]) => e.kind === "notice" && /stopped unexpectedly/.test(e.text))?.[1]).toMatchObject({
      text: expect.stringContaining("boom"),
    });
    expect(agent.state()).toEqual({ status: "idle", queued: 0 });
  });

  it("is unavailable without Claude Code, and refuses empty messages and odd conversation names", async () => {
    make({}, false);
    expect(agent.state().status).toBe("unavailable");
    await expect(agent.send("p1", "hi")).rejects.toThrow(/isn't available/);
    make();
    await expect(agent.send("p1", "  ")).rejects.toThrow(/empty/);
    await expect(agent.send("../x", "hi")).rejects.toThrow(/Not a conversation/);
  });

  it("answers the open card with a message typed into its conversation, and records cards in the conversation", async () => {
    make();
    await agent.send("p1", "one");
    await after("p1", 1);
    const card = needs.ask({ title: "Step 2", questions: [{ id: "q", prompt: "Why us?", type: "text" }] }, "p1");
    const waiting = needs.waitAsk(card.id, 5000);
    await agent.send("p1", "I'll say it here instead");
    expect(await waiting).toEqual({ replied: "I'll say it here instead" });
    expect(events.at(-1)?.[1]).toMatchObject({ kind: "card", title: "Step 2", outcome: "replied in the chat" });

    const decision = needs.permission({ toolName: "Bash", input: { command: "winget install x" } }, "p1");
    await agent.send("p1", "use the other installer");
    expect(await decision).toEqual({
      behavior: "deny",
      message: "The user denied this in the ezapply panel: use the other installer",
    });
    expect(turns("p1")).toBe(1); // neither message went to Claude
  });
});

describe("cards", () => {
  it("keeps an answer given while nothing waits, checks answers against the questions, and withdraws on reset", async () => {
    const needs = new NeedsYou();
    const changes: number[] = [];
    needs.onChange(() => changes.push(needs.list().length));
    const card = needs.ask(
      {
        title: "Step 3",
        questions: [
          {
            id: "auth",
            prompt: "Authorized to work here?",
            type: "single",
            options: [{ value: "Yes" }, { value: "No" }],
            proposed: "Yes",
            sensitive: true,
          },
          {
            id: "where",
            prompt: "Where?",
            type: "multi",
            options: [{ value: "A" }, { value: "B" }],
            allowOther: true,
            max: 2,
          },
          { id: "note", prompt: "Anything else?", type: "text", required: false },
        ],
      },
      "p1",
    );
    expect(needs.list()).toEqual([card]);
    expect(() => needs.answer(card.id, { auth: { value: "Maybe" } })).toThrow(
      /"Maybe" isn't one of the options.*where: an answer is needed/,
    );
    needs.answer(card.id, {
      auth: { value: "Yes" },
      where: { value: ["Elsewhere"], other: true },
      note: { skipped: true },
    });
    expect(needs.list()).toEqual([]);
    expect(await needs.waitAsk(card.id, 10)).toEqual({
      answers: { auth: { value: "Yes" }, where: { value: ["Elsewhere"], other: true }, note: { skipped: true } },
    });
    await expect(needs.waitAsk(card.id, 10)).rejects.toThrow(/No question card/);

    const open = needs.ask({ title: "Later", questions: [{ id: "q", prompt: "?", type: "text" }] }, "p1");
    expect(await needs.waitAsk(open.id, 10)).toBeNull();
    const perm = needs.permission({ toolName: "Bash", input: { command: "rm -r x" } }, "p1");
    needs.withdraw("p1");
    expect(await perm).toEqual({ behavior: "deny", message: "The conversation was reset." });
    expect(needs.list()).toEqual([]);
    expect(changes.at(-1)).toBe(0);
  });

  it("denies a permission request nobody answers in time, and allows with the input unchanged", async () => {
    const needs = new NeedsYou();
    expect(await needs.permission({ toolName: "Bash", input: { command: "x" } }, undefined, 20)).toMatchObject({
      behavior: "deny",
    });
    const p = needs.permission({ toolName: "Write", input: { file_path: "a.txt", content: "b" } });
    needs.decide(needs.list()[0]?.id as string, true);
    expect(await p).toEqual({ behavior: "allow", updatedInput: { file_path: "a.txt", content: "b" } });
    expect(() => needs.decide("perm-nope", true)).toThrow(/No open approval/);
  });
});

describe("ask_user and permission_ask over MCP", () => {
  const MCP_TOKEN = "t".repeat(43);
  let dir: string;
  let handle: CompanionHandle;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-agent-mcp-"));
    handle = await startCompanion({
      config: {
        schemaVersion: 1,
        host: "127.0.0.1",
        port: 0,
        mcpToken: MCP_TOKEN,
        pairingToken: "ABCD-EFGH-JKLM-NPQR",
        workspace: join(dir, "ws"),
      },
      log,
      appDataDir: join(dir, "app"),
      secrets: new MemoryStore(),
      saveConfig: async () => {},
      opener: { file: async () => "default", url: async () => "default" },
      claude: { ...claude },
    });
  });
  afterEach(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function client(session?: string): Promise<Client> {
    const c = new Client({ name: "test", version: "0.0.0" });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), {
        requestInit: {
          headers: { Authorization: `Bearer ${MCP_TOKEN}`, ...(session ? { "x-ezapply-chat-session": session } : {}) },
        },
      }),
    );
    return c;
  }
  const call = async (c: Client, name: string, args: Record<string, unknown>) => {
    const res = await c.callTool({ name, arguments: args });
    return JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");
  };
  /** A panel conversation with a session Claude Code knows, as the agent would have. */
  async function conversation(key: string): Promise<string> {
    const { agent } = handle.services;
    const seen = new Promise<void>((resolve) => agent.onEvent((_, e) => e.kind === "turnEnd" && resolve()));
    await agent.send(key, "hi");
    await seen;
    const file = JSON.parse(await readFile(join(dir, "ws", "agent", "conversations.json"), "utf8"));
    return file.conversations[key].sessionId;
  }

  it("asks a panel conversation's questions on a card and returns the answers", async () => {
    const session = await conversation("p1");
    const c = await client(session);
    const { needs } = handle.services;
    const asked = call(c, "ask_user", {
      title: "Acme, step 3",
      questions: [
        {
          id: "salary",
          prompt: "Expected salary?",
          type: "text",
          proposed: "Open to discussion",
          sensitive: true,
          why: "From your preferences",
        },
        { id: "relocate", prompt: "Will you relocate?", type: "single", options: [{ value: "Yes" }, { value: "No" }] },
      ],
    });
    await waitFor(async () => (needs.list().length === 1 ? true : null), 5000);
    const card = needs.list()[0];
    expect(card).toMatchObject({ kind: "ask", conversation: "p1", spec: { title: "Acme, step 3" } });
    needs.answer(card?.id as string, { salary: { value: "Open to discussion" }, relocate: { value: "No" } });
    expect(await asked).toEqual({
      done: true,
      answers: { salary: { value: "Open to discussion" }, relocate: { value: "No" } },
    });
    await c.close();
  });

  it("refuses questions that don't fit, waits again by askId, and sends a terminal chat's questions back to chat without a panel", async () => {
    const c = await client("terminal-session-1");
    const bad = await c.callTool({
      name: "ask_user",
      arguments: {
        title: "T",
        questions: [{ id: "a", prompt: "?", type: "single", options: [{ value: "x" }, { value: "y" }], proposed: "z" }],
      },
    });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("isn't one of the options");
    expect(
      await call(c, "ask_user", { title: "T", questions: [{ id: "a", prompt: "?", type: "text" }] }),
    ).toMatchObject({ noPanel: true });

    const { needs } = handle.services;
    const stop = needs.watch();
    const first = await call(c, "ask_user", {
      title: "T",
      questions: [{ id: "a", prompt: "?", type: "text" }],
      timeoutSeconds: 5,
    });
    expect(first).toMatchObject({ done: false, askId: expect.any(String) });
    needs.answer(first.askId, { a: { value: "late" } });
    expect(await call(c, "ask_user", { askId: first.askId })).toEqual({
      done: true,
      answers: { a: { value: "late" } },
    });
    stop();
    await c.close();
  });

  it("asks the panel to approve a tool call, and denies when no panel can", async () => {
    const session = await conversation("p1");
    const c = await client(session);
    const { needs } = handle.services;
    const asked = call(c, "permission_ask", {
      tool_name: "Bash",
      input: { command: "mkdir x", description: "Make a folder" },
      tool_use_id: "toolu_1",
    });
    await waitFor(async () => (needs.list().length === 1 ? true : null), 5000);
    expect(needs.list()[0]).toMatchObject({
      kind: "permission",
      toolName: "Bash",
      description: "Make a folder",
      conversation: "p1",
    });
    needs.decide(needs.list()[0]?.id as string, false, "not that folder");
    expect(await asked).toEqual({
      behavior: "deny",
      message: "The user denied this in the ezapply panel: not that folder",
    });

    const other = await client("terminal-session-2");
    expect(await call(other, "permission_ask", { tool_name: "Bash", input: { command: "x" } })).toMatchObject({
      behavior: "deny",
    });
    await c.close();
    await other.close();
  });
});
