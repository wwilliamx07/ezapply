import { type CapturePayload, EzError, HOST_PERMISSIONS, type SiteId } from "@ezapply/protocol";
import type { CaptureOutcome } from "@ezapply/ui/panel";
import { z } from "zod";
import { capturePage, type PageCapture } from "../capture/capture.js";
import { chooseFrame, type FrameCapture, unreadableBoard } from "../capture/frames.js";
import { ext } from "../ext.js";
import { flashBadge, renderBadge } from "./badge.js";
import { CompanionConnection } from "./connection.js";
import { formHandlers } from "./forms.js";
import { frameSite, tabSites } from "./frames.js";
import { panelUpdate, servePanels } from "./panel.js";
import { store } from "./settings.js";

// MV3 forbids eval; stop zod from probing for it.
z.config({ jitless: true });

export const RECONNECT_ALARM = "ezapply-reconnect";

const connection = new CompanionConnection(
  {
    "browser.status": async () => {
      const [tabs, focused] = await Promise.all([ext.tabs.query({}), ext.windows.getLastFocused().catch(() => null)]);
      const listed = tabs.filter((t) => t.id !== undefined && t.url);
      // Each tab's site, and its embedded applications, by what its pages show (else their URLs).
      const sites = await Promise.all(listed.map(tabSites));
      return {
        extensionVersion: ext.runtime.getManifest().version,
        tabs: listed.map((t, i) => {
          const lastAccessed = (t as { lastAccessed?: number }).lastAccessed;
          const { site, frames: inside } = sites[i] ?? { site: "generic" as SiteId, frames: [] };
          return {
            tabId: t.id as number,
            windowId: t.windowId,
            url: t.url as string,
            title: t.title ?? "",
            active: t.active,
            focused: t.active && t.windowId === focused?.id,
            ...(lastAccessed !== undefined ? { lastAccessed } : {}),
            site,
            ...(inside.length ? { frames: inside } : {}),
          };
        }),
      };
    },
    ...formHandlers,
    "panel.update": panelUpdate,
  },
  ext.runtime.getManifest().version,
);

servePanels(connection, (tab) => setPosting(tab));

connection.onState((s) => {
  void renderBadge(s);
  if (s.state === "connected") void flushPendingCapture();
});

// ---- The panel and Capture ---------------------------------------------------------------

/** The keyboard shortcut's command (the manifest's `commands`). */
export const SET_POSTING_COMMAND = "set-posting";

// The toolbar button opens the side panel, where everything else happens. Chrome opens it by itself; Firefox's
// sidebar is toggled here, inside the click, the only place it may be opened from.
const sidePanel = (
  ext as unknown as { sidePanel?: { setPanelBehavior(o: { openPanelOnActionClick: boolean }): Promise<void> } }
).sidePanel;
void sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
ext.action.onClicked.addListener(() => {
  (ext as unknown as { sidebarAction?: { toggle(): Promise<void> } }).sidebarAction?.toggle().catch(() => undefined);
});

// Alt+Shift+P captures the page without opening the panel.
ext.commands.onCommand.addListener((command, tab) => {
  if (command !== SET_POSTING_COMMAND || !tab) return;
  // The extension holds every site from the install, but Firefox lets the user withhold that and Chrome lets them
  // limit it. Asked here, while the shortcut still counts as the user's gesture: Firefox accepts
  // permissions.request only synchronously inside the handler. Already granted, it resolves without asking.
  // Declined, the capture still reads the page itself (the shortcut grants activeTab), not other sites' frames.
  const access =
    tab.url && /^https?:/i.test(tab.url) ? ext.permissions.request({ origins: [...HOST_PERMISSIONS] }) : undefined;
  void setPosting(
    tab,
    access?.catch(() => false),
  );
});

/**
 * Capture the tab as the posting. `access`: the request for every site the shortcut made, settled before the page
 * is read (the panel asks in its own click before calling this). The outcome goes to the panel; the badge shows it.
 */
async function setPosting(tab: chrome.tabs.Tab, access?: Promise<boolean>): Promise<CaptureOutcome> {
  const failed = async (error: string): Promise<CaptureOutcome> => {
    await flashBadge("error", error);
    return { ok: false, error };
  };
  if (tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url)) {
    return failed("This page can't be captured. Open the job posting itself.");
  }
  await access;
  let payload: CapturePayload;
  try {
    const frames = await captureFrames(tab.id);
    const chosen = chooseFrame(frames);
    if (!chosen) throw new Error("The page returned nothing");
    const board = unreadableBoard(chosen, frames);
    if (board) {
      // The job sits in a frame from another site that the extension may not read (access to websites withheld):
      // open it on its own.
      await ext.tabs.create({ url: board, index: tab.index + 1, openerTabId: tab.id });
      return failed("This job is embedded from a job board. It opened in a new tab: Capture there.");
    }
    const top = frames.find((f) => f.frameId === 0)?.page ?? chosen.page;
    const site = await frameSite(tab.id, chosen.frameId, chosen.page.url);
    payload = toPayload(top, chosen, tab.id, site);
  } catch (err) {
    return failed(`Capture failed: ${(err as Error).message}`);
  }

  await connection.ensureConnected();
  if (!connection.connected) {
    await store.setPendingCapture(payload);
    await renderBadge();
    return { ok: false, error: "ezapply isn't running: the posting is saved and goes to ezapply when it starts." };
  }
  return sendCapture(payload);
}

/**
 * Capture every frame the extension may read (every site's; with access to websites withheld, the tab's own origin
 * by the click's activeTab grant, other sites' frames skipped), falling back to the top frame alone if that fails.
 */
async function captureFrames(tabId: number): Promise<FrameCapture[]> {
  const run = (allFrames: boolean) =>
    ext.scripting
      .executeScript({ target: { tabId, allFrames }, func: capturePage })
      .then((results) =>
        results.filter((r) => r.result).map((r) => ({ frameId: r.frameId ?? 0, page: r.result as PageCapture })),
      );
  const all = await run(true).catch(() => [] as FrameCapture[]);
  return all.some((f) => f.frameId === 0) ? all : run(false);
}

/**
 * The posting's page is the tab's (its URL and title); its content comes from the frame that holds it, and so does
 * its site (by that frame's body, else its URL).
 */
function toPayload(top: PageCapture, chosen: FrameCapture, tabId: number, site: SiteId): CapturePayload {
  const { frames: _, url, pageTitle, ...content } = chosen.page;
  return {
    ...content,
    url: top.url,
    pageTitle: top.pageTitle || pageTitle,
    ...(chosen.frameId !== 0 ? { frameUrl: url } : {}),
    ...(site !== "generic" ? { site } : {}),
    capturedAt: new Date().toISOString(),
    tabId,
  };
}

async function sendCapture(payload: CapturePayload): Promise<CaptureOutcome> {
  try {
    const res = await connection.request("posting.capture", payload, 60_000);
    await store.setPendingCapture(null);
    const label = [res.company, res.role].filter(Boolean).join(": ") || res.postingId;
    await store.setActiveLabel(label);
    await flashBadge("ok", `Active posting: ${label}`);
    return { ok: true, postingId: res.postingId, label };
  } catch (err) {
    const e = EzError.from(err);
    await flashBadge("error", `Capture not saved: ${e.message}`);
    return { ok: false, error: `Capture not saved: ${e.message}` };
  }
}

async function flushPendingCapture(): Promise<void> {
  const pending = await store.pendingCapture();
  if (pending) await sendCapture(pending);
}

// ---- Lifecycle -------------------------------------------------------------------------------

/**
 * The reconnect alarm, created on every background start and not only at install: Firefox doesn't keep
 * alarms across browser sessions and Chrome may clear them on restart, and without it the extension stays
 * disconnected once `ezapply chat` (started later) brings the companion up. Created only when missing, so a
 * wake-up doesn't push the next firing back.
 */
export async function ensureReconnectAlarm(): Promise<void> {
  if (!(await ext.alarms.get(RECONNECT_ALARM))) await ext.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
}

ext.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") await ext.runtime.openOptionsPage();
  void connection.ensureConnected();
});

ext.runtime.onStartup.addListener(() => {
  void connection.ensureConnected();
});

// Wakes the background periodically so it reconnects after the companion starts or the browser idles it.
ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connection.ensureConnected();
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.port || changes.pairingToken)) void connection.settingsChanged();
});

void ensureReconnectAlarm();
void renderBadge();
void connection.ensureConnected();
