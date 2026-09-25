import type { CapturePayload } from "@ezapply/protocol";

export const DEFAULT_PORT = 17373;

export interface Settings {
  port: number;
  pairingToken: string;
}

export type ConnState =
  | { state: "unconfigured" }
  | { state: "connecting" }
  | { state: "connected"; companionVersion: string }
  | { state: "disconnected"; reason: string }
  | { state: "error"; message: string; hint?: string };

/** Typed wrapper over chrome.storage.local. */
export const store = {
  async settings(): Promise<Settings | null> {
    const { port, pairingToken } = await chrome.storage.local.get(["port", "pairingToken"]);
    if (typeof pairingToken !== "string" || !pairingToken) return null;
    return { port: typeof port === "number" ? port : DEFAULT_PORT, pairingToken };
  },
  async setConnState(s: ConnState): Promise<void> {
    await chrome.storage.local.set({ connState: s });
  },
  async connState(): Promise<ConnState> {
    const { connState } = await chrome.storage.local.get("connState");
    return (connState as ConnState | undefined) ?? { state: "unconfigured" };
  },
  /** Only the most recent capture waits for the companion; older ones are superseded. */
  async setPendingCapture(p: CapturePayload | null): Promise<void> {
    if (p) await chrome.storage.local.set({ pendingCapture: p });
    else await chrome.storage.local.remove("pendingCapture");
  },
  async pendingCapture(): Promise<CapturePayload | null> {
    const { pendingCapture } = await chrome.storage.local.get("pendingCapture");
    return (pendingCapture as CapturePayload | undefined) ?? null;
  },
  async setActiveLabel(label: string | null): Promise<void> {
    await chrome.storage.local.set({ activeLabel: label });
  },
  async activeLabel(): Promise<string | null> {
    const { activeLabel } = await chrome.storage.local.get("activeLabel");
    return typeof activeLabel === "string" ? activeLabel : null;
  },
};
