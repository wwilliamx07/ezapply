import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@ezapply/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_PROMPT,
  AntigravityReader,
  antigravityArgs,
  antigravityBackend,
  firstMessage,
} from "../src/agent/antigravity.js";
import type { AgentCommand } from "../src/agent/child.js";
import { NeedsYou } from "../src/agent/needs.js";
import { claudeBackend, PART_PROMPTS } from "../src/agent/process.js";
import { AgentService } from "../src/agent/service.js";
import { createLogger } from "../src/logger.js";
import { waitFor } from "../src/util/wait.js";
import { Workspace } from "../src/workspace/workspace.js";

const AGY: AgentCommand = {
  file: process.execPath,
  args: [join(import.meta.dirname, "agy-stream-stub.mjs")],
  shell: false,
};
const CLAUDE: AgentCommand = {
  file: process.execPath,
  args: [join(import.meta.dirname, "claude-stream-stub.mjs")],
  shell: false,
};
const log = createLogger({ toFile: false, level: "silent" });
const AT = "2026-01-01T00:00:00.000Z";

describe("reading the Antigravity CLI's stream-json", () => {
  const line = (event: string, o: object) => JSON.stringify({ event, [event]: o });
  const step = (o: object) => line("step_update", { conversation_id: "c1", ...o });
  const reader = () => {
    let ms = 0;
    const r = new AntigravityReader(
      () => AT,
      () => ms,
    );
    return { r, advance: (by: number) => (ms += by) };
  };

  it("starts without saying whether ezapply's tools connected, and reports the conversation's id once", () => {
    const { r } = reader();
    const init = JSON.stringify({ event: "init", conversation_id: "c1", init: { tools: ["call_mcp_tool"] } });
    expect(r.read(init)).toEqual([
      { type: "agentSession", id: "c1" },
      { type: "init", sessionId: "c1" },
    ]);
    expect(r.read(step({ step_index: 1, state: "DONE", step_type: "user_input" }))).toEqual([
      { type: "taken", text: "" },
    ]);
    expect(r.read(step({ step_index: 1, state: "DONE", step_type: "user_input" }))).toEqual([]);
  });

  it("joins a response's deltas into one text, and folds a tool step into a call and its end", () => {
    const { r } = reader();
    expect(r.read(step({ step_index: 0, step_type: "checkpoint" }))).toEqual([{ type: "agentSession", id: "c1" }]);
    expect(r.read(step({ step_index: 2, state: "ACTIVE", step_type: "agent_response", text_delta: "Hel" }))).toEqual(
      [],
    );
    expect(r.read(step({ step_index: 2, state: "DONE", step_type: "agent_response", text_delta: "lo" }))).toEqual([
      { type: "event", event: { kind: "text", at: AT, text: "Hello" } },
    ]);
    const call = {
      name: "call_mcp_tool",
      parameters: { ServerName: "ezapply", ToolName: "ask_user", Arguments: { title: "Work history" } },
    };
    expect(r.read(step({ step_index: 3, state: "ACTIVE", step_type: "tool", tool_info: call }))).toEqual([
      {
        type: "event",
        event: { kind: "tool", at: AT, id: "step-3", name: "mcp__ezapply__ask_user", summary: "Work history" },
      },
    ]);
    expect(r.read(step({ step_index: 3, state: "DONE", step_type: "tool", tool_info: call }))).toEqual([
      { type: "event", event: { kind: "toolDone", at: AT, id: "step-3", ok: true } },
    ]);
    const other = { name: "call_mcp_tool", parameters: { ServerName: "docs", ToolName: "search", Arguments: {} } };
    expect(r.read(step({ step_index: 4, state: "ACTIVE", step_type: "tool", tool_info: other }))).toMatchObject([
      { event: { name: "docs/search", summary: "" } },
    ]);
    const command = { name: "run_command", parameters: { CommandLine: "git   status" } };
    expect(
      r.read(
        step({ step_index: 5, state: "ERROR", step_type: "tool", tool_info: { ...command, error: { message: "no" } } }),
      ),
    ).toEqual([
      { type: "event", event: { kind: "tool", at: AT, id: "step-5", name: "run_command", summary: "git status" } },
      { type: "event", event: { kind: "toolDone", at: AT, id: "step-5", ok: false, error: "no" } },
    ]);
  });

  it("times a turn itself, takes its message even when no step said so, and reports its error", () => {
    const { r, advance } = reader();
    const result = (o: object) => line("result", { conversation_id: "c1", ...o });
    expect(r.read(result({ status: "SUCCESS", duration_seconds: 300 }))).toEqual([
      { type: "agentSession", id: "c1" },
      { type: "taken", text: "" },
      { type: "turnEnd", event: { kind: "turnEnd", at: AT, ok: true }, queued: 0 },
    ]);
    r.read(step({ step_index: 1, state: "DONE", step_type: "user_input" }));
    advance(1500);
    expect(r.read(result({ status: "ERROR", error: "quota", duration_seconds: 304 }))).toEqual([
      { type: "turnEnd", event: { kind: "turnEnd", at: AT, ok: false, durationMs: 1500, error: "quota" }, queued: 0 },
    ]);
    expect(r.read(result({ status: "INTERRUPTED" })).at(-1)).toEqual({
      type: "turnEnd",
      event: { kind: "turnEnd", at: AT, ok: false, interrupted: true },
      queued: 0,
    });
    expect(r.read("not json")).toEqual([]);
    expect(r.read(JSON.stringify({ type: "result", status: "SUCCESS" }))).toEqual([]);
  });

  it("says why a turn its rules denied a call in stopped", () => {
    const { r } = reader();
    const denied = [
      { action: "command", display_name: "git status" },
      { action: "command", display_name: "ls" },
    ];
    const items = r.read(line("result", { status: "SUCCESS", response: "", denied_actions: denied }));
    expect(items).toContainEqual({
      type: "event",
      event: expect.objectContaining({
        kind: "notice",
        level: "warn",
        text: expect.stringMatching(/this command call/),
      }),
    });
    expect(items.at(-1)).toMatchObject({ type: "turnEnd", event: { ok: true } });
  });

  it("runs agy with stream-json both ways, the panel's effort, Plan only, and the conversation to continue", () => {
    expect(antigravityArgs("medium", "dontAsk")).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--effort",
      "medium",
    ]);
    expect(antigravityArgs("max", "plan", "c1").slice(5)).toEqual(["max", "--mode", "plan", "--conversation", "c1"]);
    expect(firstMessage("hi", "fill")).toBe(
      `<ezapply-panel>\n${ANTIGRAVITY_PROMPT} ${PART_PROMPTS.fill}\n</ezapply-panel>\n\nhi`,
    );
  });
});

describe("the agent service with Antigravity", () => {
  let dir: string;
  let agent: AgentService;
  let events: [string, AgentEvent][];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-agy-"));
    events = [];
  });
  afterEach(async () => {
    await agent?.close();
    await rm(dir, { recursive: true, force: true });
  });

  function make(backends: "agy" | "both" = "agy") {
    agent = new AgentService({
      workspace: new Workspace(dir),
      needs: new NeedsYou(),
      log,
      backends: {
        antigravity: antigravityBackend(AGY),
        ...(backends === "both" ? { claude: claudeBackend(CLAUDE) } : {}),
      },
      env: { ...process.env, STUB_LOG: join(dir, "starts.log") },
    });
    agent.onEvent((k, e) => events.push([k, e]));
    return agent;
  }
  const turns = (k: string) => events.filter(([key, e]) => key === k && e.kind === "turnEnd").length;
  const after = async (k: string, n: number) => {
    await waitFor(async () => (turns(k) >= n ? true : null), 10_000);
    expect(turns(k)).toBeGreaterThanOrEqual(n);
  };
  const logged = async () =>
    (await readFile(join(dir, "starts.log"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as unknown);
  const starts = async () => (await logged()).filter((l): l is string[] => Array.isArray(l));
  const messages = async () =>
    (await logged())
      .filter((l): l is { message: { message: { content: string } } } => !Array.isArray(l))
      .map((l) => l.message.message.content);
  const conversations = async () =>
    JSON.parse(await readFile(join(dir, "agent", "conversations.json"), "utf8")) as {
      conversations: Record<string, { agent: string; agentSessionId?: string; sessionId: string }>;
    };

  it("relays a turn, introduces the panel in the first message only, and continues Antigravity's conversation later", async () => {
    make();
    expect(agent.agents()).toEqual(["antigravity"]);
    expect((await agent.settings()).agent).toBe("antigravity");
    await agent.send("p1/fill", "hello");
    await after("p1/fill", 1);
    expect(events.map(([, e]) => e.kind)).toEqual(["user", "user", "tool", "toolDone", "text", "turnEnd"]);
    expect(events[2]?.[1]).toMatchObject({ kind: "tool", name: "mcp__ezapply__ask_user" });
    expect(events[4]?.[1]).toMatchObject({ kind: "text", text: "echo: hello" });
    const end = events[5]?.[1];
    expect(end).toMatchObject({ kind: "turnEnd", ok: true });
    // Timed here, not from agy's running total (100 seconds and more in the stub).
    expect(end?.kind === "turnEnd" && (end.durationMs ?? 0) < 50_000).toBe(true);
    await agent.send("p1/fill", "again");
    await after("p1/fill", 2);
    const [first, second] = await messages();
    expect(first).toBe(firstMessage("hello", "fill"));
    expect(second).toBe("again");

    await waitFor(async () => ((await conversations()).conversations["p1/fill"]?.agentSessionId ? true : null), 5000);
    const record = (await conversations()).conversations["p1/fill"];
    expect(record).toMatchObject({ agent: "antigravity", agentSessionId: expect.stringMatching(/^agy-\d+$/) });
    await agent.close();

    make();
    await agent.send("p1/fill", "later");
    await after("p1/fill", 3);
    expect((await starts()).at(-1)?.slice(-2)).toEqual(["--conversation", record?.agentSessionId]);
    expect((await messages()).at(-1)).toBe("later");
  });

  it("stops a turn by ending the process, without a notice, and the next message continues the conversation", async () => {
    make();
    await agent.send("general", "slow");
    await waitFor(async () => (events.some(([, e]) => e.kind === "tool") ? true : null), 10_000);
    expect(agent.stop()).toBe(true);
    await after("general", 1);
    expect(events.at(-1)?.[1]).toMatchObject({ kind: "turnEnd", interrupted: true });
    expect(events.some(([, e]) => e.kind === "notice")).toBe(false);
    await waitFor(async () => (agent.state().status === "idle" ? true : null), 5000);
    await agent.send("general", "next");
    await after("general", 2);
    expect((await starts()).length).toBe(2);
    expect((await starts())[1]).toContain("--conversation");
  });

  it("ends a denied turn with a notice, and keeps the process for the next message", async () => {
    make();
    await agent.send("general", "deny");
    await after("general", 1);
    expect(events.map(([, e]) => e.kind)).toEqual(["user", "user", "tool", "toolDone", "notice", "turnEnd"]);
    await agent.send("general", "next");
    await after("general", 2);
    expect((await starts()).length).toBe(1);
  });

  it("starts the next message in a new process when the mode changes, with Plan only's flag", async () => {
    make();
    await agent.send("general", "one");
    await after("general", 1);
    await agent.setSettings({ permissionMode: "plan" });
    await agent.send("general", "two");
    await after("general", 2);
    const all = await starts();
    expect(all.length).toBe(2);
    expect(all[1]).toEqual(expect.arrayContaining(["--mode", "plan", "--conversation"]));
    expect(events.some(([, e]) => e.kind === "notice")).toBe(false);
  });

  it("starts a conversation anew when the agent changes, keeping the earlier session", async () => {
    make("both");
    expect(agent.agents()).toEqual(["claude", "antigravity"]);
    await agent.setSettings({ agent: "claude" });
    await agent.send("general", "one");
    await after("general", 1);
    const before = (await conversations()).conversations.general?.sessionId;
    await agent.setSettings({ agent: "antigravity" });
    await agent.send("general", "two");
    await after("general", 2);
    const after2 = (await conversations()).conversations.general;
    expect(after2?.agent).toBe("antigravity");
    expect(after2?.sessionId).not.toBe(before);
    expect(events.some(([, e]) => e.kind === "notice" && /A new conversation with Antigravity/.test(e.text))).toBe(
      true,
    );
  });
});
