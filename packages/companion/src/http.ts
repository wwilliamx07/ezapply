import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PROTOCOL_VERSION } from "@ezapply/protocol";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ExtensionBridge } from "./bridge/server.js";
import { CHAT_SESSION_HEADER, type ChatSessions, chatSessionId, toolCallCount } from "./chat.js";
import type { Logger } from "./logger.js";
import { createMcpServer } from "./mcp/server.js";
import type { Services } from "./services.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";
/** What /health answers as `mode`. Builds before it ran a background daemon, whose /health had no mode. */
export const HEALTH_MODE = "chat";
/** The MCP SDK's own limit for a message body. */
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpOptions {
  services: Services;
  bridge: ExtensionBridge;
  mcpToken: string;
  log: Logger;
  /** Tool calls per `ezapply chat` session, read by the wrapper that hosts this server. */
  chat: ChatSessions;
}

/**
 * One loopback HTTP server, living as long as `ezapply chat`, hosts:
 *   GET  /health            — unauthenticated liveness probe (no user data)
 *   POST /mcp               — MCP Streamable HTTP, stateless, bearer-token protected
 *   /review/*, /github/*    — pages for the user's browser, each guarded by its own one-time value
 *   WS   /bridge            — extension connection (see bridge/server.ts)
 */
export function createHttpServer(opts: HttpOptions): Server {
  const server = createServer((req, res) => {
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
      mode: HEALTH_MODE,
      version: opts.services.version,
      protocolVersion: PROTOCOL_VERSION,
      extensionConnected: opts.bridge.status().connected,
    });
  }

  // The document review page (token-guarded; see documents/review.ts).
  if (path.startsWith("/review/")) {
    await opts.services.reviews.handleHttp(req, res);
    return;
  }

  // Browser-facing GitHub setup/login pages (state-guarded; see github/service.ts).
  if (path.startsWith("/github/")) {
    await opts.services.github.handleHttp(req, res);
    return;
  }

  if (path !== MCP_PATH) return sendJson(res, 404, { error: "not found" });

  // Browsers always send Origin on cross-site requests; MCP clients do not. Refuse browser traffic.
  if (req.headers.origin) return sendJson(res, 403, { error: "browser requests are not allowed" });
  if (!bearerOk(req.headers.authorization, opts.mcpToken)) {
    return sendJson(res, 401, { error: "unauthorized", hint: "The token is mcpToken in ~/.ezapply/config.json" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  }

  // The relay names its Claude session: count its tool calls, so the wrapper knows whether the session has
  // done anything and never restarts Claude while a call is running (clients without the header aren't
  // counted). That needs the body here, so it's parsed once and handed to the transport.
  let parsed: unknown;
  const chatId = chatSessionId(req.headers[CHAT_SESSION_HEADER]);
  if (chatId) {
    const raw = await readRawBody(req, MAX_MCP_BODY_BYTES);
    if (raw === null)
      return sendJson(res, 413, { jsonrpc: "2.0", error: { code: -32000, message: "Too large." }, id: null });
    try {
      parsed = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    }
    for (let n = toolCallCount(parsed); n > 0; n--) res.on("close", opts.chat.beginToolCall(chatId));
  }

  const mcp = createMcpServer(opts.services, chatId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, parsed);
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

/** The whole body as text, or null when it passes `max` bytes. */
async function readRawBody(req: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
