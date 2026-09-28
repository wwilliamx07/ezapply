import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { type CompanionHandle, createLogger, startCompanion } from "@ezapply/companion";
import { afterEach, describe, expect, it } from "vitest";
import { runMcpRelay } from "../src/mcp-relay.js";

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

describe("ezapply mcp relay", () => {
  it("starts the daemon on first use and relays requests and notifications", async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-relay-"));
    const port = await freePort();
    let starts = 0;
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output })[Symbol.asyncIterator]();

    const done = runMcpRelay({
      input,
      output,
      url: `http://127.0.0.1:${port}/mcp`,
      token: TOKEN,
      ensureDaemon: async () => {
        starts++;
        handle = await startCompanion({
          config: {
            schemaVersion: 1,
            host: "127.0.0.1",
            port,
            mcpToken: TOKEN,
            pairingToken: "ABCD-EFGH-JKLM-NPQR",
            workspace: join(dir as string, "ws"),
          },
          log: createLogger({ toFile: false, level: "silent" }),
          appDataDir: join(dir as string, "app"),
          saveConfig: async () => {},
        });
      },
    });

    const send = (msg: unknown) => input.write(`${JSON.stringify(msg)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    const init = JSON.parse((await lines.next()).value as string);
    expect(init).toMatchObject({ id: 1, result: { serverInfo: { name: "ezapply" } } });
    expect(starts).toBe(1);

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = JSON.parse((await lines.next()).value as string);
    expect(list.id).toBe(2);
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("template_import_example");

    input.end();
    await done;
    expect(starts).toBe(1);
  }, 30_000);

  it("tags requests with the chat session, and the daemon counts only its tool calls", async () => {
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
    const state = async (id = session) =>
      (
        await fetch(`http://127.0.0.1:${port}/control/chat?session=${id}`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json();
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output })[Symbol.asyncIterator]();
    const done = runMcpRelay({
      input,
      output,
      url: `http://127.0.0.1:${port}/mcp`,
      token: TOKEN,
      headers: { "x-ezapply-chat-session": session },
      ensureDaemon: async () => {},
    });
    const send = async (msg: object) => {
      input.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
      return JSON.parse((await lines.next()).value as string);
    };

    await send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    await send({ id: 2, method: "tools/list" });
    expect(await state()).toEqual({ activePosting: null, used: false, inFlight: 0, restartOnCapture: true });

    const listed = await send({ id: 3, method: "tools/call", params: { name: "postings_list", arguments: {} } });
    expect(listed.result.isError).toBeFalsy();
    expect(await state()).toMatchObject({ used: true, inFlight: 0 });
    expect(await state("another-session-id")).toMatchObject({ used: false });

    input.end();
    await done;
  }, 30_000);

  it("answers requests with an error when the daemon can't be reached", async () => {
    const port = await freePort();
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output })[Symbol.asyncIterator]();
    const done = runMcpRelay({
      input,
      output,
      url: `http://127.0.0.1:${port}/mcp`,
      token: TOKEN,
      ensureDaemon: async () => {
        throw new Error("could not start");
      },
    });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
    const res = JSON.parse((await lines.next()).value as string);
    expect(res).toMatchObject({ id: 7, error: { message: expect.stringMatching(/could not start/) } });
    input.end();
    await done;
  });

  /** A stand-in daemon: `answer` decides what happens to each request it receives. */
  async function stubDaemon(
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

  function relayTo(url: string, ensureDaemon: () => Promise<void>) {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output })[Symbol.asyncIterator]();
    const done = runMcpRelay({ input, output, url, token: TOKEN, ensureDaemon });
    const call = async (id: number) => {
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call" })}\n`);
      return JSON.parse((await lines.next()).value as string);
    };
    const end = async () => {
      input.end();
      await done;
    };
    return { call, end };
  }

  it("never sends a request twice once the daemon received it, even when the connection breaks", async () => {
    const daemon = await stubDaemon((_req, res) => res.socket?.destroy()); // e.g. an idle stop mid-call
    let starts = 0;
    const relay = relayTo(daemon.url, async () => {
      starts++;
    });
    const res = await relay.call(1);
    expect(res).toMatchObject({ id: 1, error: { message: expect.stringMatching(/may or may not have run/) } });
    expect(daemon.received()).toBe(1);
    expect(starts).toBe(0);
    await relay.end();
    await daemon.close();
  });

  it("waits as long as a tool takes (no client-side timeout)", async () => {
    const daemon = await stubDaemon((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }));
      }, 1500);
    });
    const relay = relayTo(daemon.url, async () => {});
    expect(await relay.call(2)).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    expect(daemon.received()).toBe(1);
    await relay.end();
    await daemon.close();
  });
});
