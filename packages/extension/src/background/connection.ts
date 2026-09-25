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
import { ext, isFirefox } from "../ext.js";
import { type ConnState, store } from "./settings.js";

// Chrome keeps the MV3 service worker alive while WebSocket traffic flows at least every 30s.
// Firefox's event page ignores socket traffic and idles out after 30s without an extension event.
const KEEPALIVE_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Owns the single WebSocket to the companion: handshake, keepalive, reconnect with backoff,
 * and typed RPC in both directions.
 */
export class CompanionConnection {
  private socket: WebSocket | null = null;
  private peer: RpcPeer<typeof CompanionApi, typeof ExtensionApi> | null = null;
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private backoff = 1_000;
  private connecting = false;
  private readonly listeners = new Set<(s: ConnState) => void>();

  constructor(
    private readonly handlers: Handlers<typeof ExtensionApi>,
    private readonly extensionVersion: string,
  ) {}

  get connected(): boolean {
    return this.peer !== null;
  }

  onState(fn: (s: ConnState) => void): void {
    this.listeners.add(fn);
  }

  request<K extends keyof typeof CompanionApi & string>(
    method: K,
    params: ParamsOf<typeof CompanionApi, K>,
    timeoutMs?: number,
  ): Promise<ResultOf<typeof CompanionApi, K>> {
    if (!this.peer) {
      return Promise.reject(new EzError(ErrorCode.ExtensionDisconnected, "Not connected to the companion"));
    }
    return this.peer.request(method, params, timeoutMs);
  }

  /** Connect if not already connected or connecting. Safe to call often (alarms, startup, clicks). */
  async ensureConnected(): Promise<void> {
    if (this.socket || this.connecting) return;
    const settings = await store.settings();
    if (!settings) {
      await this.setState({ state: "unconfigured" });
      return;
    }
    this.connecting = true;
    clearTimeout(this.retry);
    await this.setState({ state: "connecting" });

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${settings.port}/bridge`);
    } catch (err) {
      this.connecting = false;
      await this.fail(`Invalid companion address: ${(err as Error).message}`);
      return;
    }
    this.socket = ws;
    let welcomed = false;
    let rejected: EzError | null = null;
    const send = (msg: BridgeMessage) => ws.send(JSON.stringify(msg));

    ws.onopen = () => {
      send({
        kind: "hello",
        protocolVersion: PROTOCOL_VERSION,
        extensionVersion: this.extensionVersion,
        pairingToken: settings.pairingToken,
      });
    };

    ws.onmessage = async (ev) => {
      const msg = parseBridgeMessage(String(ev.data));
      if (!msg) return;
      switch (msg.kind) {
        case "welcome":
          welcomed = true;
          this.connecting = false;
          this.backoff = 1_000;
          this.peer = new RpcPeer({
            send,
            remote: CompanionApi,
            local: ExtensionApi,
            handlers: this.handlers,
            idPrefix: "e",
          });
          this.keepalive = setInterval(() => {
            send({ kind: "ping", t: Date.now() });
            // The write fires storage.onChanged back into this page, which resets Firefox's idle timer.
            if (isFirefox) void ext.storage.session.set({ keepalive: Date.now() });
          }, KEEPALIVE_MS);
          await this.setState({ state: "connected", companionVersion: msg.companionVersion });
          return;
        case "reject":
          rejected = EzError.fromPayload(msg.error);
          return;
        case "request":
        case "response":
          await this.peer?.handle(msg);
          return;
        default:
          return;
      }
    };

    ws.onclose = async (ev) => {
      clearInterval(this.keepalive);
      this.peer?.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Connection closed"));
      this.peer = null;
      this.socket = null;
      this.connecting = false;

      // Auth and version problems won't fix themselves; wait for the user instead of hammering.
      if (ev.code === CloseCode.Unauthorized || ev.code === CloseCode.ProtocolMismatch) {
        const e = rejected ?? new EzError(ErrorCode.Unauthorized, "Rejected by companion");
        await this.setState({ state: "error", message: e.message, ...(e.hint ? { hint: e.hint } : {}) });
        return;
      }
      if (ev.code === CloseCode.Replaced) return;
      await this.setState({
        state: "disconnected",
        reason: welcomed ? "companion closed the connection" : "companion not reachable",
      });
      this.scheduleRetry();
    };
  }

  /** Drop the connection and reconnect, e.g. after the user changes settings. */
  async reconnect(): Promise<void> {
    clearTimeout(this.retry);
    this.backoff = 1_000;
    const ws = this.socket;
    if (ws) {
      ws.onclose = null;
      ws.close();
      clearInterval(this.keepalive);
      this.peer?.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Reconnecting"));
      this.peer = null;
      this.socket = null;
      this.connecting = false;
    }
    await this.ensureConnected();
  }

  private scheduleRetry(): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.ensureConnected(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private async fail(message: string): Promise<void> {
    await this.setState({ state: "error", message });
  }

  private async setState(s: ConnState): Promise<void> {
    await store.setConnState(s);
    for (const fn of this.listeners) fn(s);
  }
}
