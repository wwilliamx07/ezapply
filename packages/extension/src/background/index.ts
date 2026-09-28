import { type CapturePayload, detectSite, EzError } from "@ezapply/protocol";
import { z } from "zod";
import { capturePage, type PageCapture } from "../capture/capture.js";
import { chooseFrame, type FrameCapture, unreadableBoard } from "../capture/frames.js";
import { ext } from "../ext.js";
import { flashBadge, renderBadge } from "./badge.js";
import { CompanionConnection } from "./connection.js";
import { formHandlers } from "./forms.js";
import { store } from "./settings.js";

// MV3 forbids eval; stop zod from probing for it.
z.config({ jitless: true });

export const RECONNECT_ALARM = "ezapply-reconnect";

const connection = new CompanionConnection(
  {
    "browser.status": async () => {
      const [tabs, focused] = await Promise.all([ext.tabs.query({}), ext.windows.getLastFocused().catch(() => null)]);
      return {
        extensionVersion: ext.runtime.getManifest().version,
        tabs: tabs
          .filter((t) => t.id !== undefined && t.url)
          .map((t) => {
            const lastAccessed = (t as { lastAccessed?: number }).lastAccessed;
            return {
              tabId: t.id as number,
              windowId: t.windowId,
              url: t.url as string,
              title: t.title ?? "",
              active: t.active,
              focused: t.active && t.windowId === focused?.id,
              ...(lastAccessed !== undefined ? { lastAccessed } : {}),
              site: detectSite(t.url as string),
            };
          }),
      };
    },
    ...formHandlers,
  },
  ext.runtime.getManifest().version,
);

connection.onState((s) => {
  void renderBadge(s);
  if (s.state === "connected") void flushPendingCapture();
});

// ---- Set posting -----------------------------------------------------------------------------

ext.action.onClicked.addListener((tab) => {
  void setPosting(tab);
});

async function setPosting(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url)) {
    await flashBadge("error", "This page can't be captured. Open the job posting itself.");
    return;
  }
  let payload: CapturePayload;
  try {
    const frames = await captureFrames(tab.id);
    const chosen = chooseFrame(frames);
    if (!chosen) throw new Error("The page returned nothing");
    const board = unreadableBoard(chosen, frames);
    if (board) {
      // The job sits in a frame from another site that the extension may not read: open it on its own.
      await ext.tabs.create({ url: board, index: tab.index + 1, openerTabId: tab.id });
      await flashBadge(
        "error",
        "This job is embedded from a job board. It opened in a new tab: click Set posting there.",
      );
      return;
    }
    const top = frames.find((f) => f.frameId === 0)?.page ?? chosen.page;
    payload = toPayload(top, chosen, tab.id);
  } catch (err) {
    await flashBadge("error", `Capture failed: ${(err as Error).message}`);
    return;
  }

  await connection.ensureConnected();
  if (!connection.connected) {
    await store.setPendingCapture(payload);
    await renderBadge();
    return;
  }
  await sendCapture(payload);
}

/**
 * Capture every frame the extension may read (the click's activeTab grant covers the tab's own origin;
 * frames from other sites are skipped), falling back to the top frame alone if that fails.
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

/** The posting's page is the tab's (its URL and title); its content comes from the frame that holds it. */
function toPayload(top: PageCapture, chosen: FrameCapture, tabId: number): CapturePayload {
  const { frames: _, url, pageTitle, ...content } = chosen.page;
  return {
    ...content,
    url: top.url,
    pageTitle: top.pageTitle || pageTitle,
    ...(chosen.frameId !== 0 ? { frameUrl: url } : {}),
    capturedAt: new Date().toISOString(),
    tabId,
  };
}

async function sendCapture(payload: CapturePayload): Promise<void> {
  try {
    const res = await connection.request("posting.capture", payload, 60_000);
    await store.setPendingCapture(null);
    const label = [res.company, res.role].filter(Boolean).join(": ") || res.postingId;
    await store.setActiveLabel(label);
    await flashBadge("ok", `Active posting: ${label}`);
  } catch (err) {
    const e = EzError.from(err);
    await flashBadge("error", `Capture not saved: ${e.message}`);
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
