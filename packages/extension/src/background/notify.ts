import type { PanelUpdate } from "@ezapply/protocol";
import { ext } from "../ext.js";

/** One notification per conversation: a newer one replaces it. */
const PREFIX = "ezapply-";
/** Each open panel's window, and whether its page is visible (the panel says on every change). */
const panels = new Map<chrome.runtime.Port, { windowId: number; visible: boolean }>();
/** The notifications that show a card: they go once no card waits. */
const cardNotifications = new Set<string>();

export function panelVisibility(port: chrome.runtime.Port, windowId: number, visible: boolean): void {
  panels.set(port, { windowId, visible });
  // In view: what the notifications pointed at is in front of the user.
  if (visible) void clearNotifications();
}

export function panelClosed(port: chrome.runtime.Port): void {
  panels.delete(port);
}

/**
 * The companion's notification (a turn ended, a card waits), as a system notification. A turn's end isn't shown
 * while a panel is in view, that is visible in the focused window, where the user sees it already. A card's always
 * is: the agent waits on it, and the user may be watching the form beside the panel.
 */
export async function showNotification(n: NonNullable<PanelUpdate["notify"]>): Promise<void> {
  if (!n.card && (await panelInView())) return;
  if (n.card) cardNotifications.add(PREFIX + n.conversation);
  else cardNotifications.delete(PREFIX + n.conversation);
  await ext.notifications.create(PREFIX + n.conversation, {
    type: "basic",
    iconUrl: ext.runtime.getURL("icons/icon-128.png"),
    title: n.title,
    message: n.message,
    priority: 1,
  });
}

/** No card waits any more (answered, here or in the panel): their notifications would point at nothing. */
export async function cardsSettled(): Promise<void> {
  const ids = [...cardNotifications];
  cardNotifications.clear();
  await Promise.all(ids.map((id) => ext.notifications.clear(id)));
}

/** Clicking a notification brings its browser window forward with the panel open. */
export function serveNotifications(): void {
  ext.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(PREFIX)) return;
    void ext.notifications.clear(id);
    void (async () => {
      const win = await ext.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined);
      if (win?.id === undefined) return;
      await ext.windows.update(win.id, { focused: true });
      // Chrome may refuse outside a user's gesture on a page; the window is in front either way.
      await ext.sidePanel.open({ windowId: win.id }).catch(() => undefined);
    })();
  });
}

async function panelInView(): Promise<boolean> {
  for (const { windowId, visible } of panels.values()) {
    if (!visible) continue;
    const win = await ext.windows.get(windowId).catch(() => undefined);
    if (win?.focused) return true;
  }
  return false;
}

async function clearNotifications(): Promise<void> {
  const all = await ext.notifications.getAll().catch(() => ({}));
  await Promise.all(
    Object.keys(all)
      .filter((id) => id.startsWith(PREFIX))
      .map((id) => ext.notifications.clear(id)),
  );
}
