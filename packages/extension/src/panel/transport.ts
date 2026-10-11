import { HOST_PERMISSIONS } from "@ezapply/protocol/sites";
import type { CaptureOutcome, ConnectionState, PanelPush, PanelTransport } from "@ezapply/ui/panel";
import { ext } from "../ext.js";

/** Messages on the panel's port, both ways (background/panel.ts serves them). */
export type PanelRequest =
  | { type: "call"; id: number; method: string; params: unknown }
  | { type: "capture"; id: number; windowId: number }
  | { type: "tab"; id: number; windowId: number }
  | { type: "openTab"; id: number; windowId: number; url: string }
  | { type: "connection"; id: number };
export type PanelMessage =
  | { type: "response"; id: number; ok: true; result: unknown }
  | { type: "response"; id: number; ok: false; error: string }
  | { type: "push"; push: PanelPush };

/** A request before its id is given. */
type Unsent = PanelRequest extends infer R ? (R extends PanelRequest ? Omit<R, "id"> : never) : never;

export const PANEL_PORT = "ezapply-panel";
/** How often the open panel asks the background to connect while it isn't connected. */
const CHECK_MS = 5_000;

/**
 * The panel's way to ezapply: a runtime port to the extension's background, which relays `panel.*` to the companion
 * over the paired bridge and does what only it can (capture a tab, tell a tab's site). The port is opened again
 * when the background restarts (Chrome ends an idle service worker), and calls made meanwhile fail with a message.
 */
export function portTransport(): PanelTransport {
  let port: chrome.runtime.Port | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(p: PanelPush) => void>();
  const windowId = ext.windows.getCurrent().then((w) => w.id as number);

  const open = (): chrome.runtime.Port => {
    if (port) return port;
    const p = ext.runtime.connect({ name: PANEL_PORT });
    p.onMessage.addListener((m: PanelMessage) => {
      if (m.type === "push") {
        for (const fn of [...listeners]) fn(m.push);
        return;
      }
      const w = pending.get(m.id);
      if (!w) return;
      pending.delete(m.id);
      if (m.ok) w.resolve(m.result);
      else w.reject(new Error(m.error));
    });
    p.onDisconnect.addListener(() => {
      port = null;
      for (const w of pending.values()) w.reject(new Error("The extension restarted. Try again."));
      pending.clear();
      // Open it again: the background tells the new port where the connection stands.
      setTimeout(() => {
        open();
        void ask({ type: "connection" }).then((state) => {
          for (const fn of [...listeners]) fn({ type: "connection", state: state as ConnectionState });
        });
      }, 500);
    });
    port = p;
    return p;
  };
  const ask = <T>(req: Unsent): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        open().postMessage({ ...req, id });
      } catch (err) {
        pending.delete(id);
        reject(err as Error);
      }
    });

  open();
  // Chrome fires alarms at most every 30 s. While the panel is open and not connected, it asks the background every
  // 5 s instead: each ask tries to connect, and the message keeps Chrome's service worker awake for it. A change
  // reaches the panel as the background's push.
  let connected = false;
  const seen = (state: ConnectionState) => {
    connected = state.state === "connected";
    return state;
  };
  listeners.add((p) => {
    if (p.type === "connection") seen(p.state);
  });
  setInterval(() => {
    if (!connected) void ask<ConnectionState>({ type: "connection" }).then(seen, () => undefined);
  }, CHECK_MS);
  return {
    call: (method, params) => ask({ type: "call", method, params }),
    capture() {
      // Synchronously in the click: Firefox grants access to websites only during the user's gesture. Already
      // granted, it resolves without asking.
      const access = ext.permissions.request({ origins: [...HOST_PERMISSIONS] }).catch(() => false);
      return access.then(async () => ask<CaptureOutcome>({ type: "capture", windowId: await windowId }));
    },
    tab: async () => ask({ type: "tab", windowId: await windowId }),
    openTab: async (url) => {
      await ask({ type: "openTab", windowId: await windowId, url });
    },
    // An extension page may open the options page itself: nothing to relay.
    openSettings: () => ext.runtime.openOptionsPage(),
    connection: () => ask<ConnectionState>({ type: "connection" }).then(seen),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
