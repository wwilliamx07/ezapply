import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "@ezapply/companion";
import { afterEach, describe, expect, it } from "vitest";
import { type ChatState, findClaude, runChat } from "../src/chat.js";

const STUB = join(import.meta.dirname, "claude-stub.mjs");
let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

interface Start {
  pid: number;
  session: string;
  args: string[];
}

/** runChat with the stub as Claude and a daemon state the test controls. */
async function chat(opts: { exitOn?: number; args?: string[] } = {}) {
  dir = await mkdtemp(join(tmpdir(), "ezapply-chat-"));
  const log = join(dir, "starts.jsonl");
  await writeFile(log, "");
  let state: ChatState = { activePosting: { id: "acme" }, used: false, inFlight: 0, restartOnCapture: true };
  const said: string[] = [];
  let n = 0;
  const done = runChat({
    claude: { file: process.execPath, args: [STUB], shell: false },
    args: opts.args ?? [],
    cwd: dir,
    state: async () => state,
    pollMs: 10,
    say: (line) => said.push(line),
    newSession: () => `session-${++n}-abcdef`,
    resetTerminal: () => {},
    env: { ...process.env, STUB_LOG: log, STUB_EXIT_ON: String(opts.exitOn ?? 0) },
    stdio: "ignore",
  });
  const starts = async (): Promise<Start[]> =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Start);
  const waitStarts = (count: number) => waitFor(async () => ((await starts()).length >= count ? true : null), 10_000);
  const set = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
  };
  const settle = () => new Promise((r) => setTimeout(r, 150));
  return { done, starts, waitStarts, set, settle, said };
}

describe("ezapply chat", () => {
  it("restarts Claude with a fresh session once another posting is captured and no tool call is running", async () => {
    const c = await chat({ exitOn: 2, args: ["--model", "opus"] });
    expect(await c.waitStarts(1)).toBe(true);
    await c.settle(); // the daemon's first answer sets the session's own posting

    c.set({ activePosting: { id: "globex", company: "Globex", role: "Data Engineer" }, used: true, inFlight: 1 });
    await c.settle();
    expect(await c.starts()).toHaveLength(1); // a tool call is running: wait

    c.set({ inFlight: 0 });
    expect(await c.done).toBe(3); // the second Claude exits by itself
    const [first, second] = await c.starts();
    expect(first).toMatchObject({ session: "session-1-abcdef", args: ["--model", "opus"] });
    expect(second).toMatchObject({ session: "session-2-abcdef", args: [] });
    expect(c.said.join("")).toMatch(/new posting \(Globex: Data Engineer\)/);
  }, 20_000);

  it("keeps the session for an untouched session, the same posting, or when turned off", async () => {
    const c = await chat();
    expect(await c.waitStarts(1)).toBe(true);
    await c.settle();

    c.set({ activePosting: { id: "globex" } }); // nothing done yet: nothing to drop
    await c.settle();
    c.set({ used: true }); // the same posting, re-captured or worked on
    await c.settle();
    c.set({ activePosting: { id: "initech" }, restartOnCapture: false });
    await c.settle();

    const starts = await c.starts();
    expect(starts).toHaveLength(1);
    process.kill((starts[0] as Start).pid);
    await c.done;
    expect(await c.starts()).toHaveLength(1);
    expect(c.said).toEqual([]);
  }, 20_000);
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
