import { request } from "node:http";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface RelayOptions {
  input: Readable;
  output: Writable;
  /** The daemon's MCP endpoint. */
  url: string;
  token: string;
  /** Extra request headers, e.g. the `ezapply chat` session id. */
  headers?: Record<string, string>;
  /** Start the daemon if it isn't running. Called at most once at a time, when a request can't connect. */
  ensureDaemon: () => Promise<void>;
}

/**
 * Claude Code talks MCP over stdio to `ezapply mcp`; this relays each JSON-RPC message to the daemon's
 * stateless Streamable HTTP endpoint and writes the JSON answer back. Messages are handled
 * concurrently so a slow tool call doesn't hold up others. Resolves when the input ends.
 *
 * Two rules keep tool calls from running twice or being cut off:
 * - A message is re-sent (after starting the daemon) only when the connection was refused, i.e. the daemon
 *   never saw it. A connection that breaks after the request went out (the daemon stopped or crashed
 *   mid-call) is reported, not retried: the tool may already have run (a second upload, a second row).
 * - No timeout. Some tools legitimately take many minutes (extension_pair_wait and github_login_wait up to
 *   15, a large repo_sync up to 10). Node's fetch gives up on response headers after 300 s, so this uses
 *   node:http without an agent, which has no response timeout.
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
      let res: HttpResult;
      try {
        res = await postJson(opts.url, opts.token, line, opts.headers);
      } catch (err) {
        if (!connectionRefused(err)) throw err;
        await ensure();
        res = await postJson(opts.url, opts.token, line, opts.headers);
      }
      if (res.ok && res.text) {
        opts.output.write(`${res.text.trim()}\n`);
      } else if (!res.ok && isRequest) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: `ezapply daemon: HTTP ${res.status} ${res.text}` },
        });
      }
    } catch (err) {
      if (isRequest) {
        const e = err as NodeJS.ErrnoException;
        const message = connectionRefused(err)
          ? `ezapply daemon unreachable: ${e.message}`
          : `The connection to the ezapply daemon broke during this call (${e.code ?? e.message}). The tool may ` +
            "or may not have run: check its effect (e.g. get_form) before calling it again.";
        write({ jsonrpc: "2.0", id, error: { code: -32000, message } });
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

interface HttpResult {
  ok: boolean;
  status: number;
  text: string;
}

/** Nothing listens on the port: the request never reached a daemon, so sending it again is safe. */
function connectionRefused(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ECONNREFUSED";
}

/** POST one JSON-RPC message. No agent (no pooled sockets with idle timeouts) and no timeout of its own. */
function postJson(url: string, token: string, body: string, extra: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          ...extra,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
