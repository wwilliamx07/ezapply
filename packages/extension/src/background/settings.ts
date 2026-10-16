import { type AgentPrefs, type CapturePayload, readAgentPrefs } from "@ezapply/protocol";
import { ext } from "../ext.js";

export const DEFAULT_PORT = 17373;
/** The storage key of the panel's agent settings (`AgentPrefs`). */
export const AGENT_PREFS = "agentPrefs";

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

/** Typed wrapper over ext.storage.local. */
export const store = {
  async settings(): Promise<Settings | null> {
    const { port, pairingToken } = await ext.storage.local.get(["port", "pairingToken"]);
    if (typeof pairingToken !== "string" || !pairingToken) return null;
    return { port: typeof port === "number" ? port : DEFAULT_PORT, pairingToken };
  },
  async saveSettings(s: Settings): Promise<void> {
    await ext.storage.local.set({ port: s.port, pairingToken: s.pairingToken });
  },
  async setConnState(s: ConnState): Promise<void> {
    await ext.storage.local.set({ connState: s });
  },
  async connState(): Promise<ConnState> {
    const { connState } = await ext.storage.local.get("connState");
    return (connState as ConnState | undefined) ?? { state: "unconfigured" };
  },
  /** Only the most recent capture waits for the companion; older ones are superseded. */
  async setPendingCapture(p: CapturePayload | null): Promise<void> {
    if (p) await ext.storage.local.set({ pendingCapture: p });
    else await ext.storage.local.remove("pendingCapture");
  },
  async pendingCapture(): Promise<CapturePayload | null> {
    const { pendingCapture } = await ext.storage.local.get("pendingCapture");
    return (pendingCapture as CapturePayload | undefined) ?? null;
  },
  async setActiveLabel(label: string | null): Promise<void> {
    await ext.storage.local.set({ activeLabel: label });
  },
  async activeLabel(): Promise<string | null> {
    const { activeLabel } = await ext.storage.local.get("activeLabel");
    return typeof activeLabel === "string" ? activeLabel : null;
  },
  /** The panel's agent settings: the extension keeps them, and gives them to the companion (`servePanels`). */
  async agentPrefs(): Promise<AgentPrefs> {
    const { agentPrefs } = await ext.storage.local.get(AGENT_PREFS);
    return readAgentPrefs(agentPrefs);
  },
  async saveAgentPrefs(p: AgentPrefs): Promise<void> {
    await ext.storage.local.set({ [AGENT_PREFS]: p });
  },
};
