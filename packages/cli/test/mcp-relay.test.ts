import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { type CompanionHandle, createLogger, startCompanion } from "@ezapply/companion";
import { afterEach, describe, expect, it } from "vitest";
import { NOT_RUNNING, runMcpRelay } from "../src/mcp-relay.js";

const TOKEN = "t".repeat(43);
let dir: string | undefined;
let handle: CompanionHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function relay(url: string, headers?: Record<string, string>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = createInterface({ input: output })[Symbol.asyncIterator]();
  const done = runMcpRelay({ input, output, url, token: TOKEN, ...(headers ? { headers } : {}) });
  const post = (msg: object) => input.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  const send = async (msg: object) => {
    post(msg);
    return JSON.parse((await lines.next()).value as string);
  };
  const end = async () => {
    input.end();
    await done;
  };
  return { post, send, end };
}

describe("ezapply mcp relay", () => {
  it("relays requests and notifications, and tags them with the chat session, which counts only tool calls", async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-relay-"));
    const port = await freePort();
    handle = await startCompanion({
      config: {
        schemaVersion: 1,
        host: "127.0.0.1",
        port,
        mcpToken: TOKEN,
        pairingToken: "ABCD-EFGH-JKLM-NPQR",
        workspace: join(dir, "ws"),
      },
      log: createLogger({ toFile: false, level: "silent" }),
      appDataDir: join(dir, "app"),
      saveConfig: async () => {},
    });
    const session = "0b7c7f1e-4a52-4b8e-9d0e-6d4f3c2a1b00";
    const r = relay(`http://127.0.0.1:${port}/mcp`, { "x-ezapply-chat-session": session });

    const init = await r.send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    expect(init).toMatchObject({ id: 1, result: { serverInfo: { name: "ezapply" } } });
    r.post({ method: "notifications/initialized" });
    const list = await r.send({ id: 2, method: "tools/list" });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("template_import_example");
    expect(handle.chat.session(session)).toEqual({ used: false, inFlight: 0 });

    const listed = await r.send({ id: 3, method: "tools/call", params: { name: "postings_list", arguments: {} } });
    expect(listed.result.isError).toBeFalsy();
    expect(handle.chat.session(session)).toEqual({ used: true, inFlight: 0 });
    expect(handle.chat.session("another-session-id")).toMatchObject({ used: false });
    await r.end();
  }, 30_000);

  it("answers every request with how to start ezapply when no chat is running, and starts nothing", async () => {
    const port = await freePort();
    const r = relay(`http://127.0.0.1:${port}/mcp`);
    expect(await r.send({ id: 7, method: "tools/list" })).toMatchObject({ id: 7, error: { message: NOT_RUNNING } });
    expect(await r.send({ id: 8, method: "tools/call" })).toMatchObject({ id: 8, error: { message: NOT_RUNNING } });
    expect(NOT_RUNNING).toMatch(/ezapply chat/);
    await r.end();
  });

  /** A stand-in companion: `answer` decides what happens to each request it receives. */
  async function stubCompanion(
    answer: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  ) {
    let received = 0;
    const server: Server = createHttpServer((req, res) => {
      req.resume();
      req.on("end", () => {
        received++;
        answer(req, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as { port: number };
    return {
      url: `http://127.0.0.1:${port}/mcp`,
      received: () => received,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  it("never sends a request twice once the companion received it, even when the connection breaks", async () => {
    const companion = await stubCompanion((_req, res) => res.socket?.destroy()); // e.g. the chat ended mid-call
    const r = relay(companion.url);
    const res = await r.send({ id: 1, method: "tools/call" });
    expect(res).toMatchObject({ id: 1, error: { message: expect.stringMatching(/may or may not have run/) } });
    expect(companion.received()).toBe(1);
    await r.end();
    await companion.close();
  });

  it("waits as long as a tool takes (no client-side timeout)", async () => {
    const companion = await stubCompanion((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }));
      }, 1500);
    });
    const r = relay(companion.url);
    expect(await r.send({ id: 2, method: "tools/call" })).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    expect(companion.received()).toBe(1);
    await r.end();
    await companion.close();
  });
});
