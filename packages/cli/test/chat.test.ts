import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AppConfig,
  type ChatHost,
  type ChatSessionState,
  type CompanionHandle,
  createLogger,
  type PostingRef,
  startCompanion,
  waitFor,
} from "@ezapply/companion";
import { afterEach, describe, expect, it } from "vitest";
import { findClaude, hostChat, runChat } from "../src/chat.js";
import { fetchHealth } from "../src/health.js";

const STUB = join(import.meta.dirname, "claude-stub.mjs");
const TOKEN = "t".repeat(43);
const LONG = "Design and operate payment services in Go and Postgres. ".repeat(15);
let dir: string | undefined;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

interface Start {
  pid: number;
  session: string;
  args: string[];
}

const settle = () => new Promise((r) => setTimeout(r, 150));

/** The stub stands in for Claude and appends a line for every start to the log. */
async function stubClaude(exitOn = 0) {
  dir ??= await mkdtemp(join(tmpdir(), "ezapply-chat-"));
  const log = join(dir, "starts.jsonl");
  await writeFile(log, "");
  let n = 0;
  const said: string[] = [];
  const starts = async (): Promise<Start[]> =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Start);
  return {
    claude: { file: process.execPath, args: [STUB], shell: false },
    chat: {
      say: (line: string) => void said.push(line),
      newSession: () => `session-${++n}-abcdef`,
      resetTerminal: () => {},
      env: { ...process.env, STUB_LOG: log, STUB_EXIT_ON: String(exitOn) },
      stdio: "ignore" as const,
    },
    said,
    starts,
    waitStarts: (count: number) => waitFor(async () => ((await starts()).length >= count ? true : null), 10_000),
  };
}

/** What the companion reports, controlled by the test; every change notifies like the companion does. */
function fakeHost() {
  let posting: PostingRef | null = { id: "acme" };
  let state: ChatSessionState = { used: false, inFlight: 0 };
  let restart = true;
  const listeners = new Set<() => void>();
  const host: ChatHost = {
    activePosting: async () => posting,
    session: () => state,
    restartOnCapture: async () => restart,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const set = (patch: { posting?: PostingRef | null; used?: boolean; inFlight?: number; restart?: boolean }) => {
    if (patch.posting !== undefined) posting = patch.posting;
    state = { used: patch.used ?? state.used, inFlight: patch.inFlight ?? state.inFlight };
    restart = patch.restart ?? restart;
    for (const fn of [...listeners]) fn();
  };
  return { host, set };
}

describe("ezapply chat restarts", () => {
  it("restarts Claude with a fresh session once another posting is captured and the running call ends", async () => {
    const stub = await stubClaude(2);
    const { host, set } = fakeHost();
    const done = runChat({ ...stub.chat, claude: stub.claude, args: ["--model", "opus"], cwd: dir as string, host });
    expect(await stub.waitStarts(1)).toBe(true);

    set({ posting: { id: "globex", company: "Globex", role: "Data Engineer" }, used: true, inFlight: 1 });
    await settle();
    expect(await stub.starts()).toHaveLength(1); // a tool call is running: wait

    set({ inFlight: 0 }); // the call ended
    expect(await done).toBe(3); // the second Claude exits by itself
    const [first, second] = await stub.starts();
    expect(first).toMatchObject({ session: "session-1-abcdef", args: ["--model", "opus"] });
    expect(second).toMatchObject({ session: "session-2-abcdef", args: [] });
    expect(stub.said.join("")).toMatch(/new posting \(Globex: Data Engineer\)/);
  }, 20_000);

  it("keeps the session for an untouched session, the same posting, or when turned off", async () => {
    const stub = await stubClaude();
    const { host, set } = fakeHost();
    const done = runChat({ ...stub.chat, claude: stub.claude, args: [], cwd: dir as string, host });
    expect(await stub.waitStarts(1)).toBe(true);

    set({ posting: { id: "globex" } }); // nothing done yet: nothing to drop
    await settle();
    set({ used: true }); // the same posting, re-captured or worked on
    await settle();
    set({ posting: { id: "initech" }, restart: false });
    await settle();

    const starts = await stub.starts();
    expect(starts).toHaveLength(1);
    process.kill((starts[0] as Start).pid);
    await done;
    expect(await stub.starts()).toHaveLength(1);
    expect(stub.said).toEqual([]);
  }, 20_000);
});

describe("ezapply chat hosts the companion", () => {
  function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const srv = createServer().listen(0, "127.0.0.1", () => {
        const { port } = srv.address() as { port: number };
        srv.close(() => resolve(port));
      });
    });
  }

  async function setup(exitOn = 0) {
    const stub = await stubClaude(exitOn);
    const config: AppConfig = {
      schemaVersion: 1,
      host: "127.0.0.1",
      port: await freePort(),
      mcpToken: TOKEN,
      pairingToken: "ABCD-EFGH-JKLM-NPQR",
      workspace: join(dir as string, "ws"),
    };
    const failed: string[] = [];
    let handle: CompanionHandle | undefined;
    const run = () =>
      hostChat({
        config,
        claude: stub.claude,
        args: [],
        log: createLogger({ toFile: false, level: "silent" }),
        fail: (line) => void failed.push(line),
        onStarted: (h) => {
          handle = h;
        },
        chat: stub.chat,
        companion: { appDataDir: join(dir as string, "app"), saveConfig: async () => {} },
      });
    return { stub, config, failed, run, handle: () => handle as CompanionHandle };
  }

  /** A tool call as the relay under `ezapply chat` sends it. */
  const toolCall = (config: AppConfig, session: string, name: string) =>
    fetch(`http://127.0.0.1:${config.port}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-ezapply-chat-session": session,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
    });

  it("serves MCP while Claude runs, restarts Claude at once on a capture, and closes when Claude exits", async () => {
    const s = await setup();
    const done = s.run();
    expect(await s.stub.waitStarts(1)).toBe(true);
    const [first] = await s.stub.starts();
    expect(await fetchHealth(s.config)).toMatchObject({ mode: "chat" });

    const res = await toolCall(s.config, (first as Start).session, "postings_list");
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/"isError":true/);

    // What the side panel's Capture delivers over the bridge.
    const html = `<div data-automation-id="jobPostingHeader">Data Engineer</div><p>${LONG}</p>`;
    await s.handle().services.postings.capture({
      url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Data-Engineer_R-2",
      pageTitle: "Data Engineer",
      html,
      visibleHtml: html,
      visibleText: `Data Engineer\n${LONG}`,
      jsonLd: [],
      capturedAt: "2026-09-26T12:00:00.000Z",
      tabId: 7,
    });
    expect(await s.stub.waitStarts(2)).toBe(true);
    expect(s.stub.said.join("")).toMatch(/new posting \(.*Data Engineer\)/);

    const second = (await s.stub.starts())[1] as Start;
    process.kill(second.pid);
    await done;
    expect(await fetchHealth(s.config)).toBeNull();
  }, 30_000);

  it("refuses to start a second instance, and starts no Claude", async () => {
    const s = await setup();
    const other = await startCompanion({
      config: s.config,
      log: createLogger({ toFile: false, level: "silent" }),
      appDataDir: join(dir as string, "other"),
      saveConfig: async () => {},
    });
    cleanups.push(() => other.close());
    expect(await s.run()).toBe(1);
    expect(s.failed.join("")).toMatch(/already running in another terminal/);
    expect(await s.stub.starts()).toHaveLength(0);
  }, 20_000);

  it("stops a background daemon from an earlier build and takes its port", async () => {
    const s = await setup(1);
    let shutdowns = 0;
    const legacy = createHttpServer((req, res) => {
      if (req.url === "/health") {
        res.end(
          JSON.stringify({
            ok: true,
            name: "ezapply",
            version: "0.0.1",
            protocolVersion: 2,
            extensionConnected: false,
          }),
        );
        return;
      }
      if (req.url === "/control/shutdown" && req.headers.authorization === `Bearer ${TOKEN}`) {
        shutdowns++;
        res.end("{}", () => {
          legacy.closeAllConnections();
          legacy.close();
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => legacy.listen(s.config.port, "127.0.0.1", () => r()));
    expect(await s.run()).toBe(3); // the stub Claude exits by itself
    expect(shutdowns).toBe(1);
    expect(await s.stub.starts()).toHaveLength(1);
  }, 20_000);

  it("says so when another program holds the port", async () => {
    const s = await setup();
    const squatter = createServer((socket) => socket.destroy()).listen(s.config.port, "127.0.0.1");
    await new Promise((r) => squatter.once("listening", r));
    cleanups.push(() => new Promise<void>((r) => squatter.close(() => r())));
    expect(await s.run()).toBe(1);
    expect(s.failed.join("")).toMatch(/in use by another program.*ezapply init --port/);
    expect(await s.stub.starts()).toHaveLength(0);
  });
});

describe("findClaude", () => {
  it("finds the native binary or the npm launcher on PATH, and honours EZAPPLY_CLAUDE", async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-claude-"));
    await writeFile(join(dir, "claude.cmd"), "");
    expect(findClaude({ PATH: dir }, "win32")).toEqual({ file: join(dir, "claude.cmd"), args: [], shell: true });
    await writeFile(join(dir, "claude.exe"), "");
    expect(findClaude({ PATH: dir }, "win32")).toEqual({ file: join(dir, "claude.exe"), args: [], shell: false });
    await writeFile(join(dir, "claude"), "");
    expect(findClaude({ PATH: dir }, "linux")).toEqual({ file: join(dir, "claude"), args: [], shell: false });
    expect(findClaude({ PATH: join(dir, "nowhere") }, "linux")).toBeNull();
    expect(findClaude({ EZAPPLY_CLAUDE: "/opt/claude" }, "linux")).toEqual({
      file: "/opt/claude",
      args: [],
      shell: false,
    });
  });
});
