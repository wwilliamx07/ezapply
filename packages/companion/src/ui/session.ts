import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody } from "../util/body.js";

/**
 * How a page of the UI package proves it's the one the companion opened. The link carries a random token
 * (`?t=`); the first load trades it for a cookie (`HttpOnly`, `SameSite=Strict`, scoped to the page's own path),
 * and the page drops the token from the address bar. Every later request under that path carries the cookie.
 * A request that changes something must also come from the companion's own origin, so no other site can act,
 * even one that learned the token.
 */
const PAGE_COOKIE = "ezapply_page";

/** The token the request presents: `?t=`, else the page's cookie. */
export function presentedToken(req: IncomingMessage, url: URL): string | null {
  const q = url.searchParams.get("t");
  if (q) return q;
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PAGE_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export function tokenOk(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The cookie that stands for the token from now on, under `path` only. */
export function pageCookie(token: string, path: string): string {
  return `${PAGE_COOKIE}=${token}; Path=${path}; HttpOnly; SameSite=Strict`;
}

/**
 * Whether a request that changes something comes from a page of the companion: browsers send `Origin` with every
 * POST, and it must be the address the request was sent to (the `Host` the server already checked).
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  return !!origin && !!host && origin.toLowerCase() === `http://${host.toLowerCase()}`;
}

/** A JSON request body (at most `maxBytes`), or null when it's too large or not JSON. */
export async function readJsonBody(req: AsyncIterable<Buffer | string>, maxBytes = 256 * 1024): Promise<unknown> {
  const raw = await readBody(req, maxBytes);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Server-Sent Events to the pages open on one thing (a review, onboarding): the companion says something changed,
 * and the page reads its state again. A comment line every 25 s keeps the connection from idling out.
 */
export class EventStreams {
  private readonly open = new Set<ServerResponse>();
  private keepalive: NodeJS.Timeout | null = null;

  add(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    this.open.add(res);
    req.on("close", () => {
      this.open.delete(res);
      if (this.open.size === 0) this.stopKeepalive();
    });
    this.keepalive ??= setInterval(() => {
      for (const r of this.open) r.write(": keepalive\n\n");
    }, 25_000).unref();
  }

  /** How many pages are listening. */
  count(): number {
    return this.open.size;
  }

  send(event: string, data: unknown = {}): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const r of this.open) r.write(frame);
  }

  /** End every stream (the thing they watch is gone). */
  close(): void {
    for (const r of this.open) r.end();
    this.open.clear();
    this.stopKeepalive();
  }

  private stopKeepalive(): void {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }
}
