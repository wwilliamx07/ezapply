import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  type BridgeMessage,
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
import { type WebSocket, WebSocketServer } from "ws";
import type { Logger } from "../logger.js";

export const BRIDGE_PATH = "/bridge";
const HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;

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
}

export interface BridgeStatus {
  connected: boolean;
  extensionId?: string;
  extensionVersion?: string;
  connectedAt?: string;
  paired: boolean;
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
 * WebSocket endpoint for the browser extension (Chrome or Firefox). One live connection at a time; a new
 * authenticated connection replaces the old one (e.g. after the background worker restarts).
 */
export class ExtensionBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private conn: Connection | null = null;
  private pairedExtensionId: string | undefined;
  private pairingToken: string;
  private pairingOpenUntil = 0;

  constructor(private readonly opts: BridgeOptions) {
    this.pairedExtensionId = opts.pairedExtensionId;
    this.pairingToken = opts.pairingToken;
  }

  status(): BridgeStatus {
    const paired = this.pairedExtensionId !== undefined;
    if (!this.conn) return { connected: false, paired };
    return {
      connected: true,
      paired,
      extensionId: this.conn.extensionId,
      extensionVersion: this.conn.extensionVersion,
      connectedAt: this.conn.connectedAt,
    };
  }

  /**
   * Let the next extension that connects without a code pair and receive it. Opened by the CLI with the
   * MCP token (setup, pair); closes after one pairing or when the time runs out. Pinning still applies.
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

  call<K extends keyof typeof ExtensionApi & string>(
    method: K,
    params: ParamsOf<typeof ExtensionApi, K>,
    timeoutMs?: number,
  ): Promise<ResultOf<typeof ExtensionApi, K>> {
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
    return this.conn.peer.request(method, params, timeoutMs);
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

  close(): void {
    this.conn?.peer.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Companion shutting down"));
    for (const client of this.wss.clients) client.close(1001, "shutting down");
    this.wss.close();
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
    if (previous) {
      previous.peer.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Replaced by a newer connection."));
      previous.socket.close(CloseCode.Replaced, "replaced");
    }
    return conn;
  }
}

/**
 * Chrome: `chrome-extension://<32 a–p>` (the extension id). Firefox: `moz-extension://<uuid>`, a
 * per-profile install UUID that stays fixed across reloads because the manifest pins a gecko id.
 */
function extensionIdFromOrigin(origin: string | undefined): string | null {
  const m =
    origin?.match(/^chrome-extension:\/\/([a-p]{32})$/) ??
    origin?.match(/^moz-extension:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
  return m?.[1] ?? null;
}

function tokensEqual(a: string, b: string): boolean {
  const norm = (s: string) => Buffer.from(s.trim().toUpperCase());
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
