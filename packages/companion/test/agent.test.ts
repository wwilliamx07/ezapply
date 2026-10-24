import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import {
  type AgentEvent,
  type AgentPrefs,
  type AgentSettings,
  changeAgentPrefs,
  DEFAULT_AGENT_PREFS,
} from "@ezapply/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentBackend } from "../src/agent/backend.js";
import { NeedsYou } from "../src/agent/needs.js";
import {
  agentArgs,
  type ClaudeCommand,
  claudeBackend,
  PANEL_PROMPT,
  PANEL_TOOLS,
  PART_PROMPTS,
  panelShell,
  sessionId,
} from "../src/agent/process.js";
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
    expect(toolSummary("mcp__ezapply__posting_get", {})).toBe("");
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
    // Only the workspace's setup, and only the tools the panel uses: one shell, and no AskUserQuestion.
    expect(fresh.join(" ")).toContain("--strict-mcp-config --mcp-config .mcp.json --setting-sources project,local");
    const tools = (args: string[]) => (args[args.indexOf("--tools") + 1] as string).split(",");
    expect(tools(fresh)).toEqual(["Bash", ...PANEL_TOOLS]);
    expect(tools(agentArgs("abc", false, undefined, undefined, "PowerShell"))[0]).toBe("PowerShell");
    expect(tools(fresh)).not.toContain("AskUserQuestion");
    expect(fresh).not.toContain("--bare");
    expect(agentArgs("abc", true).slice(-2)).toEqual(["--resume", "abc"]);
    const chosen = agentArgs("abc", false, {
      agent: "claude",
      permissionMode: "default",
      model: "opus",
      effort: "max",
    }).join(" ");
    expect(chosen).toContain("--permission-mode default --model opus --effort max --permission-prompt-tool");
  });

  it("gives the panel Bash where Claude Code can run it, else PowerShell on Windows", () => {
    const none = () => null;
    expect(panelShell({}, "linux", none, () => false)).toBe("Bash");
    expect(panelShell({}, "win32", none, () => false)).toBe("PowerShell");
    const git = "C:\\Git\\cmd\\git.exe";
    const bash = win32.join("C:\\Git", "bin", "bash.exe");
    expect(
      panelShell(
        {},
        "win32",
        () => git,
        (p) => p === bash,
      ),
    ).toBe("Bash");
    expect(
      panelShell(
        {},
        "win32",
        () => git,
        () => false,
      ),
    ).toBe("PowerShell");
    const env = { CLAUDE_CODE_GIT_BASH_PATH: "D:\\bash.exe" };
    expect(panelShell(env, "win32", none, (p) => p === "D:\\bash.exe")).toBe("Bash");
  });

  it("keeps a posting's tailoring and filling conversations to their part in the system prompt", () => {
    const prompt = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
    expect(prompt(agentArgs("abc", false))).toBe(PANEL_PROMPT);
    expect(prompt(agentArgs("abc", false, undefined, "tailor"))).toBe(`${PANEL_PROMPT} ${PART_PROMPTS.tailor}`);
    expect(prompt(agentArgs("abc", true, undefined, "fill"))).toBe(`${PANEL_PROMPT} ${PART_PROMPTS.fill}`);
  });

  it("accepts only plain session ids from the relay's header", () => {
    expect(sessionId("0b7c7f1e-4a52-4b8e-9d0e-6d4f3c2a1b00")).toBe("0b7c7f1e-4a52-4b8e-9d0e-6d4f3c2a1b00");
    expect(sessionId(["session-one-x", "session-two-x"])).toBe("session-one-x");
    expect(sessionId("short")).toBeUndefined();
    expect(sessionId("has spaces and ; semicolons")).toBeUndefined();
    expect(sessionId(undefined)).toBeUndefined();
  });
});

describe("the agent service", () => {
  let dir: string;
  let workspace: Workspace;
  let needs: NeedsYou;
  let agent: AgentService;
  let events: [string, AgentEvent][];
  /** The extension's settings, as the panel changes them. */
  let prefs: AgentPrefs;
  const set = (change: Partial<AgentSettings>) => {
    prefs = changeAgentPrefs(prefs, agent.agents(), change);
    return agent.setPrefs(prefs);
  };
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, STUB_LOG: join(dir, "starts.log"), ...extra });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-agent-"));
    workspace = new Workspace(dir);
    needs = new NeedsYou();
    events = [];
    prefs = DEFAULT_AGENT_PREFS;
  });
  afterEach(async () => {
    await agent?.close();
    await rm(dir, { recursive: true, force: true });
  });

  function make(extraEnv: Record<string, string> = {}, withClaude = true) {
    agent = new AgentService({
      workspace,
      needs,
      log,
      ...(withClaude ? { backends: { claude: claudeBackend(claude) } } : {}),
      env: env(extraEnv),
    });
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
    expect(agent.state()).toEqual({ status: "idle", conversations: [] });
    await agent.send("2026-01-01_acme_dev/fill", "hello there");
    await after("2026-01-01_acme_dev/fill", 1);
    const kinds = events.map(([, e]) => e.kind);
    expect(kinds).toEqual(["user", "user", "text", "turnEnd"]);
    expect(events[1]?.[1]).toMatchObject({ kind: "user", text: "hello there", taken: true });
    expect(events[2]?.[1]).toMatchObject({ kind: "text", text: "echo: hello there" });
    expect(events[3]?.[1]).toMatchObject({ kind: "turnEnd", ok: true, totalCostUsd: 0.01 });
    expect(agent.state()).toEqual({
      status: "idle",
      conversations: [{ conversation: "2026-01-01_acme_dev/fill", status: "idle", queued: 0 }],
    });
    await waitFor(async () => ((await agent.history("2026-01-01_acme_dev/fill")).length === 3 ? true : null), 5000);
    const history = await agent.history("2026-01-01_acme_dev/fill");
    expect(history.map((e) => e.kind)).toEqual(["user", "text", "turnEnd"]);
    expect(history[0]).toMatchObject({ taken: true });
    expect(await agent.usage("2026-01-01_acme_dev/fill")).toEqual({ totalCostUsd: 0.01 });
  });

  it("runs a process per conversation side by side, and Stop ends only its own conversation's turn", async () => {
    make();
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    await agent.send("p1/tailor", "two");
    await after("p1/tailor", 2);
    expect((await starts()).length).toBe(1);

    // Another conversation gets its own process, and the first keeps its own.
    await agent.send("general", "other");
    await after("general", 1);
    await agent.send("p1/tailor", "three");
    await after("p1/tailor", 3);
    expect(await starts()).toHaveLength(2);

    // One works while the other is sent to and answers.
    await agent.send("p1/tailor", "slow");
    await waitFor(async () => (agent.statusOf("p1/tailor") === "working" ? true : null), 5000);
    await agent.send("general", "now");
    await after("general", 2);
    expect(agent.statusOf("p1/tailor")).toBe("working");
    expect(agent.state()).toMatchObject({
      status: "working",
      conversations: expect.arrayContaining([
        { conversation: "p1/tailor", status: "working", queued: 0 },
        { conversation: "general", status: "idle", queued: 0 },
      ]),
    });
    expect(agent.stop("general")).toBe(false);
    expect(agent.stop("p1/tailor")).toBe(true);
    await after("p1/tailor", 4);
    const tailor = events.filter(([k]) => k === "p1/tailor").map(([, e]) => e);
    expect(tailor.filter((e) => e.kind === "turnEnd").at(-1)).toMatchObject({ ok: false, interrupted: true });
    expect(tailor.some((e) => e.kind === "toolDone" && !e.ok)).toBe(true);
    expect(agent.state().status).toBe("idle");
  });

  it("starts a new session on Reset, keeping the old one as earlier, with an empty history", async () => {
    make();
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    const before = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    await agent.reset("p1/tailor");
    expect(await agent.history("p1/tailor")).toEqual([]);
    await agent.send("p1/tailor", "fresh");
    await after("p1/tailor", 2);
    const file = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    const c = file.conversations["p1/tailor"];
    expect(c.sessionId).not.toBe(before.conversations["p1/tailor"].sessionId);
    expect(c.earlier).toEqual([expect.objectContaining({ sessionId: before.conversations["p1/tailor"].sessionId })]);
    const last = (await starts()).at(-1) as string[];
    expect(last.slice(-2)).toEqual(["--session-id", c.sessionId]);
  });

  it("gives a posting's filling and tailoring their own sessions, whichever comes first, and forgets both", async () => {
    make();
    await agent.send("p1/fill", "fill it");
    await after("p1/fill", 1);
    await agent.send("p1/tailor", "tailor it");
    await after("p1/tailor", 1);
    const file = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    expect(file.conversations["p1/fill"].sessionId).not.toBe(file.conversations["p1/tailor"].sessionId);
    const [first, second] = await starts();
    expect(first?.join(" ")).toContain(PART_PROMPTS.fill);
    expect(second?.join(" ")).toContain(PART_PROMPTS.tailor);
    expect(
      (await agent.history("p1/fill")).filter((e) => e.kind === "user").map((e) => e.kind === "user" && e.text),
    ).toEqual(["fill it"]);
    await expect(agent.send("p1", "hi")).rejects.toThrow(/Not a conversation/);

    await agent.forgetPosting("p1");
    const after2 = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    expect(Object.keys(after2.conversations)).toEqual(["general"]);
    await expect(
      readFile(join(dir, "agent", "p1", "fill", `${file.conversations["p1/fill"].sessionId}.jsonl`)),
    ).rejects.toThrow();
  });

  it("moves an older build's one conversation per posting to the posting's tailoring conversation", async () => {
    const said: AgentEvent = { kind: "user", at: AT, id: "m1", text: "earlier", taken: true };
    await mkdir(join(dir, "agent", "p1"), { recursive: true });
    await writeFile(
      join(dir, "agent", "conversations.json"),
      JSON.stringify({ schemaVersion: 1, conversations: { p1: { sessionId: "s-old", startedAt: AT, started: true } } }),
    );
    await writeFile(
      join(dir, "agent", "p1", "s-old.jsonl"),
      `${JSON.stringify(said)}
`,
    );
    make();
    expect(await agent.history("p1/tailor")).toEqual([said]);
    const file = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    expect(Object.keys(file.conversations).sort()).toEqual(["general", "p1/tailor"]);
  });

  it("always has the general conversation, which resets before its first message too", async () => {
    make();
    expect(await agent.history("general")).toEqual([]);
    const before = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    expect(before.conversations.general).toMatchObject({ started: false, earlier: [] });
    await agent.reset("general");
    const file = JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8"));
    expect(file.conversations.general.sessionId).not.toBe(before.conversations.general.sessionId);
    // Never started, so there's nothing to keep as earlier.
    expect(file.conversations.general.earlier).toEqual([]);
  });

  it("keeps the permission mode and model, starts with them, and switches a running conversation at once", async () => {
    make();
    expect(await agent.settings()).toEqual({
      agent: "claude",
      permissionMode: "auto",
      model: "sonnet",
      effort: "medium",
    });
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    expect(await set({ permissionMode: "plan" })).toEqual({
      agent: "claude",
      permissionMode: "plan",
      model: "sonnet",
      effort: "medium",
    });
    await set({ model: "haiku" });
    await waitFor(async () => ((await switches()).length === 2 ? true : null), 5000);
    expect(await switches()).toEqual([
      { subtype: "set_permission_mode", mode: "plan" },
      { subtype: "set_model", model: "haiku" },
    ]);
    // The same settings again (the extension gives them on every connection) send nothing; a mode the panel
    // doesn't offer is refused.
    await set({ model: "haiku" });
    const kept = prefs;
    await expect(set({ permissionMode: "bypassPermissions" as "plan" })).rejects.toThrow();
    prefs = kept;
    // Nothing is written to the workspace: the extension keeps them.
    await expect(readFile(join(dir, "agent", "settings.json"), "utf8")).rejects.toThrow();

    // ezapply started again: the defaults until the extension gives its settings, which the next process starts with.
    await agent.close();
    events = [];
    make();
    expect(agent.settings()).toEqual({ agent: "claude", permissionMode: "auto", model: "sonnet", effort: "medium" });
    await agent.setPrefs(prefs);
    await agent.send("p1/tailor", "two");
    await after("p1/tailor", 1);
    expect((await starts()).at(-1)?.join(" ")).toContain("--permission-mode plan --model haiku --effort medium");
    expect(await switches()).toHaveLength(2);
  });

  it("restarts the conversation's process for a new effort: at once when idle, after the turn while working", async () => {
    make();
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    await set({ effort: "high" });
    expect(agent.state()).toEqual({ status: "idle", conversations: [] });
    await agent.send("p1/tailor", "two");
    await after("p1/tailor", 2);
    const session = (await starts())[0]?.at(-1) as string;
    expect((await starts()).at(-1)?.join(" ")).toContain(`--effort high`);
    expect((await starts()).at(-1)?.slice(-2)).toEqual(["--resume", session]);

    // While it works, the process stays until the turn ends.
    await agent.send("p1/tailor", "slow");
    await waitFor(async () => (agent.state().status === "working" ? true : null), 5000);
    await set({ effort: "low" });
    expect(agent.state().status).toBe("working");
    agent.stop("p1/tailor");
    await after("p1/tailor", 3);
    await waitFor(async () => (agent.state().conversations.length === 0 ? true : null), 5000);
    await agent.send("p1/tailor", "three");
    await after("p1/tailor", 4);
    expect(await starts()).toHaveLength(3);
    expect((await starts()).at(-1)?.join(" ")).toContain(`--effort low`);
    expect(await switches()).toEqual([]);
  });

  it("answers a settings change without waiting for the process to exit, and starts the next one after it has", async () => {
    // A backend whose processes exit only when the test says so, until it's done.
    let hold = true;
    let exit = () => {};
    let started = 0;
    const slow: AgentBackend = {
      name: "Slow",
      switches: false,
      start: (opts) => {
        started++;
        let alive = true;
        return {
          get alive() {
            return alive;
          },
          send: () => {
            opts.onItem({ type: "taken", text: "" });
            opts.onItem({ type: "turnEnd", event: { kind: "turnEnd", at: AT, ok: true }, queued: 0 });
          },
          interrupt: () => {},
          setPermissionMode: () => "",
          setModel: () => "",
          close: () =>
            new Promise<void>((resolve) => {
              exit = () => {
                alive = false;
                resolve();
              };
              if (!hold) exit();
            }),
          kill: () => exit(),
        };
      },
    };
    agent = new AgentService({ workspace, needs, log, backends: { claude: slow }, env: env() });
    await agent.send("general", "one");
    expect(started).toBe(1);
    await set({ effort: "high" });
    expect(agent.state()).toEqual({ status: "idle", conversations: [] });
    const sent = agent.send("general", "two");
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toBe(1);
    hold = false;
    exit();
    await sent;
    expect(started).toBe(2);
  });

  it("runs the chosen agent with its own settings, or the first installed when the chosen one isn't", async () => {
    const idle = { name: "Idle", start: () => ({}) } as unknown as AgentBackend;
    agent = new AgentService({ workspace, needs, log, backends: { claude: idle, antigravity: idle }, env: env() });
    await set({ effort: "high" });
    expect(await set({ agent: "antigravity" })).toEqual({
      agent: "antigravity",
      permissionMode: "dontAsk",
      effort: "medium",
    });
    await set({ model: "gemini-flash" });
    expect(await set({ agent: "claude" })).toMatchObject({ agent: "claude", model: "sonnet", effort: "high" });
    expect(await set({ agent: "antigravity" })).toMatchObject({ model: "gemini-flash" });
    // Only Claude Code installed: Antigravity's settings wait, kept, for when it is.
    agent = new AgentService({ workspace, needs, log, backends: { claude: idle }, env: env() });
    expect(await agent.setPrefs(prefs)).toMatchObject({ agent: "claude", effort: "high" });
  });

  it("lists an agent's models once, and says the state changed when they're in", async () => {
    let listed = 0;
    const idle = {
      name: "Idle",
      start: () => ({}),
      models: async () => {
        listed++;
        return [{ id: "m1", label: "Model one" }];
      },
    } as unknown as AgentBackend;
    agent = new AgentService({ workspace, needs, log, backends: { claude: idle, antigravity: idle }, env: env() });
    let changed = 0;
    agent.onState(() => changed++);
    expect(agent.models()).toEqual({});
    await waitFor(async () => (changed >= 2 ? true : null), 5000);
    expect(agent.models()).toEqual({
      claude: [{ id: "m1", label: "Model one" }],
      antigravity: [{ id: "m1", label: "Model one" }],
    });
    expect(listed).toBe(2);
  });

  it("says so when Claude Code refuses a switch, and keeps the setting for the next start", async () => {
    make({ STUB_REFUSE_SWITCH: "1" });
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    await set({ permissionMode: "plan" });
    await waitFor(async () => (events.some(([, e]) => e.kind === "notice") ? true : null), 5000);
    expect(events.find(([, e]) => e.kind === "notice")?.[1]).toMatchObject({
      level: "warn",
      text: expect.stringContaining("didn't switch the permission mode to plan: not allowed here"),
    });
    expect(await agent.settings()).toMatchObject({ permissionMode: "plan" });
  });

  it("starts afresh when a session can't be resumed, and says so", async () => {
    make();
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    await agent.close();
    make({ STUB_FAIL_RESUME: "1" });
    await agent.send("p1/tailor", "again");
    await after("p1/tailor", 2);
    expect(events.some(([, e]) => e.kind === "notice" && /couldn't be reopened/.test(e.text))).toBe(true);
    expect(events.some(([, e]) => e.kind === "text" && e.text === "echo: again")).toBe(true);
  });

  it("tells the user when Claude Code stops mid-turn, or runs without ezapply's tools", async () => {
    make({ STUB_MCP_STATUS: "failed" });
    await agent.send("p1/tailor", "hi");
    await after("p1/tailor", 1);
    expect(
      events.some(
        ([, e]) => e.kind === "notice" && e.level === "error" && /tools aren't connected.*failed/.test(e.text),
      ),
    ).toBe(true);
    await agent.send("p1/tailor", "crash");
    await waitFor(
      async () => (events.some(([, e]) => e.kind === "notice" && /stopped unexpectedly/.test(e.text)) ? true : null),
      5000,
    );
    expect(events.find(([, e]) => e.kind === "notice" && /stopped unexpectedly/.test(e.text))?.[1]).toMatchObject({
      text: expect.stringContaining("boom"),
    });
    expect(agent.state()).toEqual({ status: "idle", conversations: [] });
  });

  it("is unavailable without Claude Code, and refuses empty messages and odd conversation names", async () => {
    make({}, false);
    expect(agent.state().status).toBe("unavailable");
    await expect(agent.send("p1/tailor", "hi")).rejects.toThrow(/No coding agent is available/);
    make();
    await expect(agent.send("p1/tailor", "  ")).rejects.toThrow(/empty/);
    await expect(agent.send("../x", "hi")).rejects.toThrow(/Not a conversation/);
  });

  it("answers the open card with a message typed into its conversation, and records cards in the conversation", async () => {
    make();
    await agent.send("p1/tailor", "one");
    await after("p1/tailor", 1);
    const card = needs.ask({ title: "Step 2", questions: [{ id: "q", prompt: "Why us?", type: "text" }] }, "p1/tailor");
    const waiting = needs.waitAsk(card.id, 5000);
    await agent.send("p1/tailor", "I'll say it here instead");
    expect(await waiting).toEqual({ replied: "I'll say it here instead" });
    expect(events.at(-1)?.[1]).toMatchObject({ kind: "card", title: "Step 2", outcome: "replied in the chat" });

    const decision = needs.permission({ toolName: "Bash", input: { command: "winget install x" } }, "p1/tailor");
    await agent.send("p1/tailor", "use the other installer");
    expect(await decision).toEqual({
      behavior: "deny",
      message: "The user denied this in the ezapply panel: use the other installer",
    });
    expect(turns("p1/tailor")).toBe(1); // neither message went to Claude
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
      "p1/tailor",
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

    const open = needs.ask({ title: "Later", questions: [{ id: "q", prompt: "?", type: "text" }] }, "p1/tailor");
    expect(await needs.waitAsk(open.id, 10)).toBeNull();
    const perm = needs.permission({ toolName: "Bash", input: { command: "rm -r x" } }, "p1/tailor");
    needs.withdraw("p1/tailor");
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
          headers: { Authorization: `Bearer ${MCP_TOKEN}`, ...(session ? { "x-ezapply-session": session } : {}) },
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

  /** The conversation's events from now on. */
  function record(key: string): AgentEvent[] {
    const events: AgentEvent[] = [];
    handle.services.agent.onEvent((k, e) => k === key && events.push(e));
    return events;
  }

  it("asks a panel conversation's questions on a card, returns at once, and delivers the answers as a message", async () => {
    const session = await conversation("p1/tailor");
    const c = await client(session);
    const { needs } = handle.services;
    const events = record("p1/tailor");
    const asked = await call(c, "ask_user", {
      title: "Acme, step 3",
      questions: [
        { id: "relocate", prompt: "Will you relocate?", type: "single", options: [{ value: "Yes" }, { value: "No" }] },
      ],
    });
    expect(asked).toMatchObject({
      pending: expect.stringMatching(/^ask-/),
      hint: expect.stringMatching(/End your turn/),
    });
    const card = needs.list()[0];
    expect(card).toMatchObject({ id: asked.pending, kind: "ask", conversation: "p1/tailor" });
    // Waiting again by id doesn't hold the call either.
    expect(await call(c, "ask_user", { askId: asked.pending })).toMatchObject({ pending: asked.pending });

    needs.answer(card?.id as string, { relocate: { value: "No" } });
    // The answers start a turn: the agent (the stub echoes) reads them in an <ezapply-result> block.
    const echoed = await waitFor(
      async () => events.find((e) => e.kind === "text" && e.text.includes("<ezapply-result")) ?? null,
      5000,
    );
    expect(echoed).toMatchObject({ text: expect.stringContaining(`tool="ask_user" id="${asked.pending}"`) });
    expect((echoed as { text: string }).text).toContain('{"done":true,"answers":{"relocate":{"value":"No"}}}');
    // The panel shows a note, not the block.
    expect(events.filter((e) => e.kind === "user")).toEqual([
      expect.objectContaining({ text: "Answers to Acme, step 3", delivery: true, taken: false }),
      expect.objectContaining({ text: "Answers to Acme, step 3", delivery: true, taken: true }),
    ]);
    await c.close();
  });

  it("saves an answer the user chose to remember into the answer bank, and lets it be filled for that posting", async () => {
    const session = await conversation("p1/fill");
    const c = await client(session);
    const { needs, forms } = handle.services;
    const given: string[] = [];
    forms.userAnswered = (postingId, answerId) => {
      given.push(`${postingId}:${answerId}`);
    };
    const events = record("p1/fill");
    await call(c, "ask_user", {
      title: "Acme, step 3",
      questions: [
        {
          id: "notice",
          prompt: "How much notice do you need to give?",
          type: "text",
          remember: { answerId: "notice_period", question: "Notice period (weeks)" },
        },
      ],
    });
    needs.answer(needs.list()[0]?.id as string, { notice: { value: "2", remember: true } });
    const echoed = await waitFor(
      async () => events.find((e) => e.kind === "text" && e.text.includes("<ezapply-result")) ?? null,
      5000,
    );
    expect((echoed as { text: string }).text).toContain('"savedToAnswerBank":["notice_period"]');
    expect(given).toEqual(["p1:notice_period"]);
    const bank = await readFile(join(dir, "ws", "profile", "answers.yaml"), "utf8");
    expect(bank).toMatch(/id: notice_period\n\s+canonical: Notice period \(weeks\)\n\s+answer: "2"/);
    await c.close();
  });

  it("delivers a panel conversation's reply typed in the chat, and drops a result once the conversation is reset", async () => {
    const session = await conversation("p1/tailor");
    const c = await client(session);
    const { needs, agent } = handle.services;
    const events = record("p1/tailor");
    const ask = { title: "T", questions: [{ id: "a", prompt: "?", type: "text" }] };
    const first = await call(c, "ask_user", ask);
    await agent.send("p1/tailor", "use my usual answer");
    await waitFor(
      async () => (events.some((e) => e.kind === "text" && e.text.includes('"replied":true')) ? true : null),
      5000,
    );
    expect(events).toContainEqual(expect.objectContaining({ kind: "user", text: "Your reply to T", delivery: true }));
    expect(needs.list()).toEqual([]);

    expect(first.pending).toEqual(expect.any(String));

    // A review answered after a reset reaches nobody: the new session never asked.
    const folder = join(dir, "ws", "postings", "p1");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "resume.pdf"), "%PDF-1.4 resume v1");
    const opened = await call(c, "review_documents", { files: ["postings/p1/resume.pdf"] });
    await agent.reset("p1/tailor");
    const after = events.length;
    const u = new URL(opened.url);
    await fetch(`${u.origin}${u.pathname}/answer?t=${u.searchParams.get("t")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: u.origin },
      body: JSON.stringify({ documents: [] }),
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(events.slice(after)).toEqual([]);
    await c.close();
  });

  it("opens a panel conversation's review, returns at once, and delivers the answer as a message", async () => {
    const session = await conversation("p1/tailor");
    const folder = join(dir, "ws", "postings", "p1");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "resume.pdf"), "%PDF-1.4 resume v1");
    const c = await client(session);
    const events = record("p1/tailor");
    const opened = await call(c, "review_documents", { files: ["postings/p1/resume.pdf"] });
    expect(opened).toMatchObject({
      pending: opened.reviewId,
      openedIn: "default",
      hint: expect.stringMatching(/End your turn/),
    });
    expect(await call(c, "review_documents", { reviewId: opened.reviewId })).toMatchObject({
      pending: opened.reviewId,
    });

    const u = new URL(opened.url);
    const answered = await fetch(`${u.origin}${u.pathname}/answer?t=${u.searchParams.get("t")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: u.origin },
      body: JSON.stringify({ documents: [{ index: 0, request: "Shorter summary" }] }),
    });
    expect(answered.status).toBe(204);
    const echoed = await waitFor(
      async () => events.find((e) => e.kind === "text" && e.text.includes('tool="review_documents"')) ?? null,
      5000,
    );
    expect((echoed as { text: string }).text).toContain(
      `{"reviewId":"${opened.reviewId}","done":true,"approved":[],"changes":[{"file":"resume.pdf","request":"Shorter summary"}]}`,
    );
    expect(events).toContainEqual(expect.objectContaining({ kind: "user", text: "Your review", delivery: true }));
    await c.close();
  });

  it("delivers nothing for a review the agent replaced with a newer one", async () => {
    const session = await conversation("p1/tailor");
    const folder = join(dir, "ws", "postings", "p1");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "resume.pdf"), "%PDF-1.4 resume v1");
    const c = await client(session);
    const events = record("p1/tailor");
    await call(c, "review_documents", { files: ["postings/p1/resume.pdf"] });
    await writeFile(join(folder, "resume.pdf"), "%PDF-1.4 resume v2");
    await call(c, "review_documents", { files: ["postings/p1/resume.pdf"] });
    await new Promise((r) => setTimeout(r, 300));
    expect(events.filter((e) => e.kind === "user")).toEqual([]);
    await c.close();
  });

  it("asks a terminal chat's questions on a card and returns the answers", async () => {
    const c = await client("terminal-session-0");
    const { needs } = handle.services;
    const stop = needs.watch();
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
    expect(card).toMatchObject({ kind: "ask", spec: { title: "Acme, step 3" } });
    expect(card?.conversation).toBeUndefined();
    needs.answer(card?.id as string, { salary: { value: "Open to discussion" }, relocate: { value: "No" } });
    expect(await asked).toEqual({
      done: true,
      answers: { salary: { value: "Open to discussion" }, relocate: { value: "No" } },
    });
    stop();
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
    const session = await conversation("p1/tailor");
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
      conversation: "p1/tailor",
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
