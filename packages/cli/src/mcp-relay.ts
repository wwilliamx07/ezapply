import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface RelayOptions {
  input: Readable;
  output: Writable;
  /** The daemon's MCP endpoint. */
  url: string;
  token: string;
  /** Start the daemon if it isn't running. Called at most once at a time, when a request can't connect. */
  ensureDaemon: () => Promise<void>;
}

/**
 * Claude Code talks MCP over stdio to `ezapply mcp`; this relays each JSON-RPC message to the daemon's
 * stateless Streamable HTTP endpoint and writes the JSON answer back. Messages are handled
 * concurrently so a slow tool call doesn't hold up others. Resolves when the input ends.
 */
export async function runMcpRelay(opts: RelayOptions): Promise<void> {
  let starting: Promise<void> | null = null;
  const ensure = () => {
    starting ??= opts.ensureDaemon().finally(() => {
      starting = null;
    });
    return starting;
  };
  const write = (msg: unknown) => opts.output.write(`${JSON.stringify(msg)}\n`);

  const post = (body: string) =>
    fetch(opts.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body,
    });

  const relay = async (line: string) => {
    let msg: { id?: unknown };
    try {
      msg = JSON.parse(line) as { id?: unknown };
    } catch {
      return;
    }
    const id = msg.id ?? null;
    const isRequest = msg.id !== undefined;
    try {
      let res: Response;
      try {
        res = await post(line);
      } catch {
        await ensure();
        res = await post(line);
      }
      const text = await res.text();
      if (res.ok && text) {
        opts.output.write(`${text.trim()}\n`);
      } else if (!res.ok && isRequest) {
        write({ jsonrpc: "2.0", id, error: { code: -32000, message: `ezapply daemon: HTTP ${res.status} ${text}` } });
      }
    } catch (err) {
      if (isRequest) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: `ezapply daemon unreachable: ${(err as Error).message}` },
        });
      }
    }
  };

  const inFlight = new Set<Promise<void>>();
  for await (const line of createInterface({ input: opts.input, crlfDelay: Number.POSITIVE_INFINITY })) {
    if (!line.trim()) continue;
    const p = relay(line).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
  await Promise.all(inFlight);
}
