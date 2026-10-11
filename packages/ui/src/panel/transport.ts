import type { PanelMethods, PanelTab, PanelUpdate, ParamsOf, ResultOf } from "@ezapply/protocol";

type Methods = typeof PanelMethods;
export type PanelMethod = keyof Methods & string;
export type PanelParams<K extends PanelMethod> = ParamsOf<Methods, K>;
export type PanelResult<K extends PanelMethod> = ResultOf<Methods, K>;

/** The extension's connection to ezapply, as its background last saw it. */
export type ConnectionState =
  | { state: "connected" }
  | { state: "connecting" }
  | { state: "unconfigured" }
  | { state: "disconnected"; reason?: string }
  | { state: "error"; message: string; hint?: string };

/** What the background pushes to the panel. */
export type PanelPush =
  | { type: "update"; update: PanelUpdate }
  | { type: "connection"; state: ConnectionState }
  /** The window's current tab changed (switched, navigated): read "this tab" again. */
  | { type: "tab" };

export type CaptureOutcome = { ok: true; postingId: string; label: string } | { ok: false; error: string };

/**
 * How the panel reaches ezapply: the extension implements it over a runtime port to its background, which relays
 * the `panel.*` methods to the companion over the paired bridge (`extension/src/panel/`). Tests pass a fake.
 */
export interface PanelTransport {
  call<K extends PanelMethod>(method: K, params: PanelParams<K>): Promise<PanelResult<K>>;
  /**
   * Capture the window's current tab as the posting (Capture). Called inside the click, since Firefox asks
   * for the extension's access to websites only during the user's gesture.
   */
  capture(): Promise<CaptureOutcome>;
  /** What the window's current tab is to the active posting, with its id; null when there's no web page. */
  tab(): Promise<(PanelTab & { tabId: number }) | null>;
  /** Open an address in a new tab beside the current one. */
  openTab(url: string): Promise<void>;
  /** The extension's own settings (its options page: the port, pairing). */
  openSettings(): Promise<void>;
  connection(): Promise<ConnectionState>;
  subscribe(fn: (push: PanelPush) => void): () => void;
}
