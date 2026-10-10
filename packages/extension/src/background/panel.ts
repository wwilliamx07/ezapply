import { CompanionApi, EzError, type PanelUpdate } from "@ezapply/protocol";
import type { CaptureOutcome, ConnectionState } from "@ezapply/ui/panel";
import { ext } from "../ext.js";
import { PANEL_PORT, type PanelMessage, type PanelRequest } from "../panel/transport.js";
import { setCardsWaiting } from "./badge.js";
import type { CompanionConnection } from "./connection.js";
import { tabSites } from "./frames.js";
import type { ConnState } from "./settings.js";
import { store } from "./settings.js";

const ports = new Set<chrome.runtime.Port>();

/**
 * The background's side of the side panel: each open panel holds a port; its `panel.*` calls are relayed to the
 * companion over the paired bridge, and what only the extension can do (capture a tab, tell a tab's site, open a
 * tab) is done here. The companion hears how many panels are open (`panel.watch`) on every change and on every
 * connection, and its updates (`panel.update`) go to every open panel.
 */
export function servePanels(
  connection: CompanionConnection,
  capture: (tab: chrome.tabs.Tab) => Promise<CaptureOutcome>,
): void {
  const watch = () => {
    if (connection.connected) void connection.request("panel.watch", { open: ports.size }).catch(() => undefined);
  };
  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    ports.add(port);
    watch();
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      watch();
    });
    port.onMessage.addListener((req: PanelRequest) => {
      void handle(req).then(
        (result) => reply(port, { type: "response", id: req.id, ok: true, result }),
        (err) => reply(port, { type: "response", id: req.id, ok: false, error: EzError.from(err).message }),
      );
    });
  });
  connection.onState((s) => {
    broadcast({ type: "push", push: { type: "connection", state: panelConnection(s) } });
    if (s.state === "connected") watch();
  });
  // "This tab" follows the window's current tab.
  const tabChanged = () => broadcast({ type: "push", push: { type: "tab" } });
  ext.tabs.onActivated.addListener(tabChanged);
  ext.tabs.onUpdated.addListener((_, info) => {
    if (info.url || info.status === "complete") tabChanged();
  });

  async function handle(req: PanelRequest): Promise<unknown> {
    switch (req.type) {
      case "call": {
        // Only the panel's own methods: a panel can't capture or fill through this.
        if (!req.method.startsWith("panel.") || !(req.method in CompanionApi))
          throw new Error(`Not a panel method: ${req.method}`);
        await connection.ensureConnected();
        return connection.request(req.method as "panel.state", req.params as Record<string, never>, 60_000);
      }
      case "capture": {
        const tab = await currentTab(req.windowId);
        if (!tab) return { ok: false, error: "There's no page in this window to capture." } satisfies CaptureOutcome;
        return capture(tab);
      }
      case "tab": {
        const tab = await currentTab(req.windowId);
        if (!tab?.id || !tab.url || !connection.connected) return null;
        const { site } = await tabSites(tab);
        const what = await connection.request("panel.tab", {
          tabId: tab.id,
          url: tab.url,
          title: tab.title ?? "",
          site,
        });
        return { ...what, tabId: tab.id };
      }
      case "openTab": {
        if (!/^https?:\/\//i.test(req.url)) throw new Error("Only web addresses open from the panel.");
        await ext.tabs.create({ url: req.url, windowId: req.windowId, active: true });
        return {};
      }
      case "connection":
        return panelConnection(await store.connState());
    }
  }
}

/** The companion's push: the badge's count, and the rest to every open panel. */
export async function panelUpdate(update: PanelUpdate): Promise<Record<string, never>> {
  if (update.cards !== undefined) await setCardsWaiting(update.cards);
  if (update.event || update.changed) broadcast({ type: "push", push: { type: "update", update } });
  return {};
}

async function currentTab(windowId: number): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await ext.tabs.query({ active: true, windowId });
  return tab;
}

function panelConnection(s: ConnState): ConnectionState {
  switch (s.state) {
    case "connected":
      return { state: "connected" };
    case "disconnected":
      return { state: "disconnected", reason: s.reason };
    case "error":
      return { state: "error", message: s.message, ...(s.hint ? { hint: s.hint } : {}) };
    default:
      return { state: s.state };
  }
}

function reply(port: chrome.runtime.Port, m: PanelMessage): void {
  try {
    port.postMessage(m);
  } catch {
    // The panel closed meanwhile.
  }
}

function broadcast(m: PanelMessage): void {
  for (const port of [...ports]) reply(port, m);
}
