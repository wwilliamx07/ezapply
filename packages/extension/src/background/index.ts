import { type CapturePayload, detectSite, EzError } from "@ezapply/protocol";
import { z } from "zod";
import { capturePage } from "../capture/capture.js";
import { flashBadge, renderBadge } from "./badge.js";
import { CompanionConnection } from "./connection.js";
import { formHandlers } from "./forms.js";
import { store } from "./settings.js";

// MV3 forbids eval; stop zod from probing for it.
z.config({ jitless: true });

const RECONNECT_ALARM = "ezapply-reconnect";

const connection = new CompanionConnection(
  {
    "browser.status": async () => {
      const tabs = await chrome.tabs.query({});
      return {
        extensionVersion: chrome.runtime.getManifest().version,
        tabs: tabs
          .filter((t) => t.id !== undefined && t.url)
          .map((t) => ({
            tabId: t.id as number,
            windowId: t.windowId,
            url: t.url as string,
            title: t.title ?? "",
            active: t.active,
            site: detectSite(t.url as string),
          })),
      };
    },
    ...formHandlers,
  },
  chrome.runtime.getManifest().version,
);

connection.onState((s) => {
  void renderBadge(s);
  if (s.state === "connected") void flushPendingCapture();
});

// ---- Set posting -----------------------------------------------------------------------------

chrome.action.onClicked.addListener((tab) => {
  void setPosting(tab);
});

async function setPosting(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url)) {
    await flashBadge("error", "This page can't be captured. Open the job posting itself.");
    return;
  }
  let payload: CapturePayload;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
    if (!injection?.result) throw new Error("The page returned nothing");
    payload = { ...injection.result, capturedAt: new Date().toISOString(), tabId: tab.id };
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

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  if (details.reason === "install") await chrome.runtime.openOptionsPage();
  void connection.ensureConnected();
});

chrome.runtime.onStartup.addListener(() => {
  void connection.ensureConnected();
});

// Wakes the worker periodically so it reconnects after the companion starts or Chrome idles it.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connection.ensureConnected();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.port || changes.pairingToken)) void connection.reconnect();
});

void renderBadge();
void connection.ensureConnected();
