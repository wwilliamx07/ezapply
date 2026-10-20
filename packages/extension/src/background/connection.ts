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
import { FORM_SITE_IDS } from "@ezapply/sites";
import { detectBrowser } from "./browser-id.js";
import { type ConnState, DEFAULT_PORT, type Settings, store } from "./settings.js";

// Chrome keeps the MV3 service worker alive while WebSocket traffic flows at least every 30s.
const KEEPALIVE_MS = 20_000;
// Retries after a drop wait 1, 2, 4, then 5 s each: ezapply is noticed within 5 s of starting.
const MAX_BACKOFF_MS = 5_000;

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
  /** Settings the current socket was opened with; an empty token means "asking to pair". */
  private active: Settings | null = null;
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

  /**
   * Connect if not already connected or connecting. Safe to call often (alarms, startup, clicks).
   * Without a pairing code it asks the companion on the default port to pair; that only succeeds
   * while pairing is open (extension_pair), and the alarm retries meanwhile.
   */
  async ensureConnected(): Promise<void> {
    if (this.socket || this.connecting) return;
    // Before the first await: callers at once (the panel's check, a panel call, the alarm) would each open a
    // socket, and the companion keeps only the newest.
    this.connecting = true;
    let settings: Settings;
    let pairing: boolean;
    let pendingCapture: boolean;
    let browser: Awaited<ReturnType<typeof detectBrowser>>;
    try {
      const stored = await store.settings();
      pairing = !stored;
      settings = stored ?? { port: DEFAULT_PORT, pairingToken: "" };
      // Tells a freshly started companion to wait for this capture before answering posting_get.
      pendingCapture = (await store.pendingCapture()) !== null;
      // So the companion opens pages and files in this browser rather than the system default.
      browser = await detectBrowser().catch(() => undefined);
    } catch (err) {
      this.connecting = false;
      throw err;
    }
    this.active = settings;
    clearTimeout(this.retry);
    if (!pairing) await this.setState({ state: "connecting" });

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${settings.port}/bridge`);
    } catch (err) {
      this.connecting = false;
      await this.fail(`Invalid companion address: ${(err as Error).message}`);
      return;
    }
    this.socket = ws;
    /** Still the live socket: one dropped by `reconnect` or replaced leaves the connection's state alone. */
    const current = () => this.socket === ws;
    let peer: RpcPeer<typeof CompanionApi, typeof ExtensionApi> | null = null;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let welcomed = false;
    let rejected: EzError | null = null;
    const send = (msg: BridgeMessage) => ws.send(JSON.stringify(msg));

    ws.onopen = () => {
      send({
        kind: "hello",
        protocolVersion: PROTOCOL_VERSION,
        extensionVersion: this.extensionVersion,
        pairingToken: settings.pairingToken,
        sites: [...FORM_SITE_IDS],
        ...(pendingCapture ? { pendingCapture } : {}),
        ...(browser ? { browser } : {}),
      });
    };

    ws.onmessage = async (ev) => {
      const msg = parseBridgeMessage(String(ev.data));
      if (!msg) return;
      switch (msg.kind) {
        case "welcome":
          if (!current()) return;
          welcomed = true;
          this.connecting = false;
          this.backoff = 1_000;
          peer = new RpcPeer({
            send,
            remote: CompanionApi,
            local: ExtensionApi,
            handlers: this.handlers,
            idPrefix: "e",
          });
          this.peer = peer;
          keepalive = setInterval(() => send({ kind: "ping", t: Date.now() }), KEEPALIVE_MS);
          this.keepalive = keepalive;
          if (msg.pairingToken) {
            this.active = { port: settings.port, pairingToken: msg.pairingToken };
            await store.saveSettings(this.active);
          }
          await this.setState({ state: "connected", companionVersion: msg.companionVersion });
          return;
        case "reject":
          rejected = EzError.fromPayload(msg.error);
          return;
        case "request":
        case "response":
          await peer?.handle(msg);
          return;
        default:
          return;
      }
    };

    ws.onclose = async (ev) => {
      clearInterval(keepalive);
      // This socket's own calls fail now, rather than waiting out their timeout.
      peer?.failAll(new EzError(ErrorCode.ExtensionDisconnected, "Connection closed"));
      if (!current()) return;
      this.peer = null;
      this.socket = null;
      this.connecting = false;

      // Not paired and pairing isn't open (or no companion yet): stay quiet; the alarm asks again.
      if (pairing && !welcomed) {
        await this.setState({ state: "unconfigured" });
        return;
      }
      // Auth and version problems won't fix themselves; wait for the user instead of hammering.
      if (ev.code === CloseCode.Unauthorized || ev.code === CloseCode.ProtocolMismatch) {
        const e = rejected ?? new EzError(ErrorCode.Unauthorized, "Rejected by companion");
        await this.setState({ state: "error", message: e.message, ...(e.hint ? { hint: e.hint } : {}) });
        return;
      }
      if (ev.code === CloseCode.Replaced) return;
      // The companion runs inside `ezapply`: not reachable, or closed, means it isn't running.
      await this.setState({
        state: "disconnected",
        reason: "ezapply isn't running: start it with ./ezapply in your workspace (Capture still works)",
      });
      this.scheduleRetry();
    };
  }

  /** Reconnect when the stored settings differ from the live connection's (not after our own pairing save). */
  async settingsChanged(): Promise<void> {
    const s = await store.settings();
    const a = this.active;
    if (this.socket && a && s && a.port === s.port && a.pairingToken === s.pairingToken) return;
    await this.reconnect();
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
