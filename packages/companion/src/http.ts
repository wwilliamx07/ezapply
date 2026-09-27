import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PROTOCOL_VERSION } from "@ezapply/protocol";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ExtensionBridge } from "./bridge/server.js";
import type { ActivityTracker } from "./idle.js";
import type { Logger } from "./logger.js";
import { createMcpServer } from "./mcp/server.js";
import type { Services } from "./services.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";
export const PAIR_PATH = "/control/pair";
export const SHUTDOWN_PATH = "/control/shutdown";

const MAX_PAIRING_WINDOW_MS = 30 * 60_000;

export interface HttpOptions {
  services: Services;
  bridge: ExtensionBridge;
  mcpToken: string;
  log: Logger;
  /** Called after answering POST /control/shutdown. */
  onShutdown?: () => void;
  /** Counts every request except /health (probes must not keep an idle daemon up) as work. */
  activity?: ActivityTracker;
}

/**
 * One loopback HTTP server hosts three things:
 *   GET  /health  — unauthenticated liveness probe (no user data)
 *   POST /mcp     — MCP Streamable HTTP, stateless, bearer-token protected
 *   /control/*    — CLI controls (pairing window, shutdown), bearer-token protected
 *   WS   /bridge  — extension connection (see bridge/server.ts)
 */
export function createHttpServer(opts: HttpOptions): Server {
  const server = createServer((req, res) => {
    const end = req.url?.startsWith(HEALTH_PATH) ? undefined : opts.activity?.begin();
    if (end) res.on("close", end);
    void route(req, res, server, opts).catch((err: unknown) => {
      opts.log.error({ err: (err as Error).message }, "http: unhandled error");
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else res.end();
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (!hostAllowed(req, server) || !opts.bridge.handleUpgrade(req, socket, head)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
  return server;
}

async function route(req: IncomingMessage, res: ServerResponse, server: Server, opts: HttpOptions): Promise<void> {
  // DNS-rebinding protection: only accept requests addressed to the loopback host we bound.
  if (!hostAllowed(req, server)) return sendJson(res, 403, { error: "forbidden host" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (path === HEALTH_PATH && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      name: "ezapply",
      version: opts.services.version,
      protocolVersion: PROTOCOL_VERSION,
      extensionConnected: opts.bridge.status().connected,
    });
  }

  // Browser-facing GitHub setup/login pages (state-guarded; see github/service.ts).
  if (path.startsWith("/github/")) {
    await opts.services.github.handleHttp(req, res);
    return;
  }

  if (path !== MCP_PATH && path !== PAIR_PATH && path !== SHUTDOWN_PATH) {
    return sendJson(res, 404, { error: "not found" });
  }

  // Browsers always send Origin on cross-site requests; MCP clients do not. Refuse browser traffic.
  if (req.headers.origin) return sendJson(res, 403, { error: "browser requests are not allowed" });
  if (!bearerOk(req.headers.authorization, opts.mcpToken)) {
    return sendJson(res, 401, { error: "unauthorized", hint: "The token is mcpToken in ~/.ezapply/daemon.json" });
  }

  if (path === PAIR_PATH) {
    if (req.method === "GET") return sendJson(res, 200, opts.bridge.pairingStatus());
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    const body = (await readJsonBody(req)) as { seconds?: unknown } | null;
    const seconds = typeof body?.seconds === "number" && body.seconds > 0 ? body.seconds : 600;
    return sendJson(res, 200, opts.bridge.openPairing(Math.min(seconds * 1000, MAX_PAIRING_WINDOW_MS)));
  }
  if (path === SHUTDOWN_PATH) {
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    opts.log.info("http: shutdown requested");
    sendJson(res, 200, { ok: true });
    res.on("finish", () => opts.onShutdown?.());
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  }

  const mcp = createMcpServer(opts.services);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}

function hostAllowed(req: IncomingMessage, server: Server): boolean {
  const addr = server.address();
  if (!addr || typeof addr === "string") return false;
  const host = req.headers.host?.toLowerCase();
  return host === `127.0.0.1:${addr.port}` || host === `localhost:${addr.port}`;
}

function bearerOk(header: string | undefined, token: string): boolean {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) return null;
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
