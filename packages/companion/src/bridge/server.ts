import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  type BridgeMessage,
  type BrowserInfo,
  CloseCode,
  CompanionApi,
  ErrorCode,
  ExtensionApi,
  EzError,
  type Handlers,
  type ParamsOf,
  PROTOCOL_VERSION,
  parseBridgeMessage,
  type ResultOf,
  RpcPeer,
} from "@ezapply/protocol";
import { FORM_SITE_IDS } from "@ezapply/sites";
import { type WebSocket, WebSocketServer } from "ws";
import type { Logger } from "../logger.js";

export const BRIDGE_PATH = "/bridge";
const HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
/**
 * How long after `ezapply` starts a paired extension is waited for: it notices the companion within its
 * 30 s reconnect alarm. Only a posting or browser call made in that window waits, and the user typing their
 * first message usually uses most of it up. (A background daemon used to also check when the extension was
 * last seen, since it could start hours after the browser closed; `ezapply` is started by the user, who is
 * at the computer.)
 */
const RECONNECT_GRACE_MS = 40_000;
/** How long to wait for a capture the extension announced in `hello` (made while ezapply wasn't running). */
const PENDING_CAPTURE_WAIT_MS = 15_000;

export interface BridgeOptions {
  companionVersion: string;
  pairingToken: string;
  /** Extension id pinned at first pairing; connections from any other id are refused. */
  pairedExtensionId: string | undefined;
  onPaired: (extensionId: string) => Promise<void>;
  /** Persist a forgotten pin and the new pairing code that replaces the old one. */
  onForgotten: (pairingToken: string) => Promise<void>;
  handlers: Handlers<typeof CompanionApi>;
  log: Logger;
  /** Called when the extension connects or disconnects (the side panel's watch ends with the connection). */
  onConnectionChange?: (connected: boolean) => void;
  /** Override RECONNECT_GRACE_MS (tests). */
  reconnectGraceMs?: number;
}

/** What `settled()` found. */
export interface Settled {
  /** The paired extension hasn't connected since the companion started (the grace period ran out first). */
  extensionReconnecting: boolean;
}

export interface BridgeStatus {
  connected: boolean;
  extensionId?: string;
  extensionVersion?: string;
  connectedAt?: string;
  paired: boolean;
  /** The browser the extension reported at its last handshake (kept after it disconnects). */
  browser?: BrowserInfo;
}

export interface PairingStatus {
  /** Until when an unpaired extension may pair without the code (ISO time), if open. */
  openUntil?: string;
  pairedExtensionId?: string;
  connected: boolean;
}

interface Connection {
  socket: WebSocket;
  extensionId: string;
  extensionVersion: string;
  connectedAt: string;
  peer: RpcPeer<typeof ExtensionApi, typeof CompanionApi>;
}

/**
 * WebSocket endpoint for the browser extension. One live connection at a time; a new
 * authenticated connection replaces the old one (e.g. after the background worker restarts).
 */
export class ExtensionBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private conn: Connection | null = null;
  private pairedExtensionId: string | undefined;
  private pairingToken: string;
  private pairingOpenUntil = 0;
  private readonly startedAt = Date.now();
  /** An extension has completed the handshake since the companion started. */
  private connectedOnce = false;
  /** From the last handshake that reported one. */
  private lastBrowser: BrowserInfo | undefined;
  /** Resolved whenever an extension completes the handshake. */
  private readonly connectWaiters = new Set<() => void>();
  /** Set while a capture announced in `hello` hasn't arrived and been saved yet. */
  private pendingCapture: { done: Promise<void>; resolve: () => void } | null = null;

  constructor(private readonly opts: BridgeOptions) {
    this.pairedExtensionId = opts.pairedExtensionId;
    this.pairingToken = opts.pairingToken;
  }

  /**
   * Wait until the extension's view of things has reached the companion: right after a start, give the paired
   * extension time to reconnect, then let a capture it queued while ezapply wasn't running be saved. Returns
   * at once in the steady state. When the grace period ran out first, `extensionReconnecting` says it may
   * still turn up (with a capture it queued). Posting tools call this so the active posting isn't stale.
   */
  async settled(): Promise<Settled> {
    await this.awaitReconnect();
    await this.pendingCapture?.done;
    return { extensionReconnecting: !this.connectedOnce && this.pairedExtensionId !== undefined };
  }

  /** Paired, not connected yet, and still inside the reconnect window after a start. */
  private inGrace(): boolean {
    return !this.conn && this.pairedExtensionId !== undefined && this.graceLeft() > 0;
  }

  private graceLeft(): number {
    return this.startedAt + (this.opts.reconnectGraceMs ?? RECONNECT_GRACE_MS) - Date.now();
  }

  private async awaitReconnect(): Promise<void> {
    if (!this.inGrace()) return;
    const remaining = this.graceLeft();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.connectWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, remaining);
      this.connectWaiters.add(done);
    });
  }

  private expectCapture(): void {
    let resolve = () => {};
    const done = new Promise<void>((r) => {
      resolve = r;
    });
    const timer = setTimeout(() => settle(), PENDING_CAPTURE_WAIT_MS);
    const settle = () => {
      clearTimeout(timer);
      if (this.pendingCapture?.done === done) this.pendingCapture = null;
      resolve();
    };
    this.pendingCapture = { done, resolve: settle };
  }

  /** The browser the extension runs in, as last reported; the companion opens pages and files there. */
  browser(): BrowserInfo | undefined {
    return this.lastBrowser;
  }

  status(): BridgeStatus {
    const paired = this.pairedExtensionId !== undefined;
    const browser = this.lastBrowser ? { browser: this.lastBrowser } : {};
    if (!this.conn) return { connected: false, paired, ...browser };
    return {
      connected: true,
      paired,
      ...browser,
      extensionId: this.conn.extensionId,
      extensionVersion: this.conn.extensionVersion,
      connectedAt: this.conn.connectedAt,
    };
  }

  /**
   * Let the next extension that connects without a code pair and receive it. Opened by extension_pair;
   * closes after one pairing or when the time runs out. Pinning still applies.
   */
  openPairing(ms: number): PairingStatus {
    this.pairingOpenUntil = Date.now() + ms;
    this.opts.log.info({ seconds: Math.round(ms / 1000) }, "bridge: pairing window open");
    return this.pairingStatus();
  }

  /**
   * Unpin the paired extension (e.g. switching browsers) and replace the pairing code, so the old
   * extension can't simply reconnect with the code it holds. The next one pairs through the window.
   */
  async forgetPaired(newPairingToken: string): Promise<void> {
    this.pairedExtensionId = undefined;
    this.pairingToken = newPairingToken;
    await this.opts.onForgotten(newPairingToken);
    // Drop it now rather than on the close event, so callers immediately see no connection.
    const old = this.conn;
    this.conn = null;
    old?.peer.failAll(new EzError(ErrorCode.ExtensionDisconnected, "The extension was unpaired."));
    old?.socket.close(CloseCode.Unauthorized, "unpaired");
    this.opts.log.info("bridge: paired extension forgotten");
  }

  pairingStatus(): PairingStatus {
    const open = this.pairingOpenUntil > Date.now();
    return {
      ...(open ? { openUntil: new Date(this.pairingOpenUntil).toISOString() } : {}),
      ...(this.pairedExtensionId ? { pairedExtensionId: this.pairedExtensionId } : {}),
      connected: this.conn !== null,
    };
  }

  async call<K extends keyof typeof ExtensionApi & string>(
    method: K,
    params: ParamsOf<typeof ExtensionApi, K>,
    timeoutMs?: number,
    /** Gets the debug trace the extension sends beside the result (debug mode), when it sends one. */
    onDebug?: (debug: unknown) => void,
  ): Promise<ResultOf<typeof ExtensionApi, K>> {
    await this.awaitReconnect();
    if (!this.conn) {
      return Promise.reject(
        new EzError(
          ErrorCode.ExtensionDisconnected,
          "The browser extension is not connected.",
          this.pairedExtensionId
            ? "Ask the user to open their browser (the extension reconnects automatically). If it stays grey, reload the extension."
            : "The extension has not been paired yet. Call extension_pair.",
        ),
      );
    }
    return this.conn.peer.request(method, params, timeoutMs, onDebug);
  }

  /** Attach to the HTTP server's `upgrade` event. Returns true when the request was handled. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== BRIDGE_PATH) return false;

    const extensionId = extensionIdFromOrigin(req.headers.origin);
    if (!extensionId || (this.pairedExtensionId && extensionId !== this.pairedExtensionId)) {
      this.opts.log.warn({ origin: req.headers.origin }, "bridge: rejected upgrade from unexpected origin");
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws, extensionId));
    return true;
  }

  /** Close every socket with 1001 (going away): `ezapply` is stopping. */
  close(): void {
    this.conn?.peer.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Companion shutting down"));
    for (const client of this.wss.clients) client.close(1001, "shutting down");
    this.wss.close();
    this.pendingCapture?.resolve();
    for (const done of [...this.connectWaiters]) done();
  }

  private onSocket(socket: WebSocket, extensionId: string): void {
    const log = this.opts.log.child({ extensionId });
    const send = (msg: BridgeMessage) => socket.send(JSON.stringify(msg));
    const reject = (code: number, error: EzError) => {
      send({ kind: "reject", error: error.toPayload() });
      socket.close(code, error.code);
    };

    let conn: Connection | null = null;
    const handshakeTimer = setTimeout(() => {
      reject(CloseCode.HandshakeTimeout, new EzError(ErrorCode.Unauthorized, "No hello received"));
    }, HANDSHAKE_TIMEOUT_MS);

    socket.on("message", async (data, isBinary) => {
      if (isBinary) return;
      const msg = parseBridgeMessage(data.toString());
      if (!msg) {
        log.warn("bridge: dropped malformed message");
        return;
      }

      if (!conn) {
        if (msg.kind !== "hello") return;
        clearTimeout(handshakeTimer);
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          const newer = msg.protocolVersion > PROTOCOL_VERSION ? "companion" : "extension";
          reject(
            CloseCode.ProtocolMismatch,
            new EzError(
              ErrorCode.ProtocolMismatch,
              `Protocol mismatch: extension v${msg.protocolVersion}, companion v${PROTOCOL_VERSION}.`,
              `Rebuild and reload the ${newer} so both sides match.`,
            ),
          );
          return;
        }
        const theirs = [...(msg.sites ?? [])].sort();
        const ours = [...FORM_SITE_IDS].sort();
        if (theirs.join() !== ours.join()) {
          reject(
            CloseCode.ProtocolMismatch,
            new EzError(
              ErrorCode.ProtocolMismatch,
              `Site mismatch: the extension knows ${theirs.join(", ") || "no sites"}, the companion ${ours.join(", ")}.`,
              "Rebuild and reload the extension so both sides come from the same version.",
            ),
          );
          return;
        }
        const viaWindow = msg.pairingToken === "" && this.pairingOpenUntil > Date.now();
        if (!viaWindow && !tokensEqual(msg.pairingToken, this.pairingToken)) {
          reject(
            CloseCode.Unauthorized,
            msg.pairingToken === ""
              ? new EzError(
                  ErrorCode.Unauthorized,
                  "Not paired yet.",
                  "Ask Claude in your ezapply workspace to pair the extension.",
                )
              : new EzError(
                  ErrorCode.Unauthorized,
                  "This extension is no longer paired.",
                  "Ask Claude in your ezapply workspace to pair the extension again.",
                ),
          );
          return;
        }
        if (viaWindow) this.pairingOpenUntil = 0;
        if (!this.pairedExtensionId) {
          await this.opts.onPaired(extensionId);
          this.pairedExtensionId = extensionId;
          log.info("bridge: extension paired");
        }
        conn = this.adopt(socket, extensionId, msg.extensionVersion, send);
        this.connectedOnce = true;
        if (msg.browser) this.lastBrowser = msg.browser;
        if (msg.pendingCapture) this.expectCapture();
        for (const done of [...this.connectWaiters]) done();
        send({
          kind: "welcome",
          protocolVersion: PROTOCOL_VERSION,
          companionVersion: this.opts.companionVersion,
          ...(viaWindow ? { pairingToken: this.pairingToken } : {}),
        });
        log.info({ extensionVersion: msg.extensionVersion }, "bridge: extension connected");
        return;
      }

      switch (msg.kind) {
        case "ping":
          send({ kind: "pong", t: msg.t });
          return;
        case "request":
          try {
            await conn.peer.handle(msg);
          } finally {
            if (msg.method === "posting.capture") this.pendingCapture?.resolve();
          }
          return;
        case "response":
          await conn.peer.handle(msg);
          return;
        default:
          return;
      }
    });

    socket.on("close", () => {
      clearTimeout(handshakeTimer);
      if (conn && this.conn === conn) {
        this.conn = null;
        conn.peer.failAll(new EzError(ErrorCode.ExtensionDisconnected, "The extension disconnected."));
        log.info("bridge: extension disconnected");
        this.opts.onConnectionChange?.(false);
      }
    });
    socket.on("error", (err) => log.warn({ err: err.message }, "bridge: socket error"));
  }

  private adopt(
    socket: WebSocket,
    extensionId: string,
    extensionVersion: string,
    send: (msg: BridgeMessage) => void,
  ): Connection {
    const previous = this.conn;
    const conn: Connection = {
      socket,
      extensionId,
      extensionVersion,
      connectedAt: new Date().toISOString(),
      peer: new RpcPeer({
        send,
        remote: ExtensionApi,
        local: CompanionApi,
        handlers: this.opts.handlers,
        idPrefix: "c",
      }),
    };
    this.conn = conn;
    this.opts.onConnectionChange?.(true);
    if (previous) {
      // Its close isn't logged (it's no longer the connection): a run of these shows reconnects that replace each other.
      this.opts.log.info({ extensionId: previous.extensionId }, "bridge: previous connection replaced");
      previous.peer.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Replaced by a newer connection."));
      previous.socket.close(CloseCode.Replaced, "replaced");
    }
    return conn;
  }
}

/** `chrome-extension://<32 a–p>`: the extension id. */
function extensionIdFromOrigin(origin: string | undefined): string | null {
  return origin?.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1] ?? null;
}

function tokensEqual(a: string, b: string): boolean {
  const norm = (s: string) => Buffer.from(s.trim().toUpperCase());
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
