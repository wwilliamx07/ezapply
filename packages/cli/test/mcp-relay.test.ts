import { mkdtemp, rm } from "node:fs/promises";
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
});
