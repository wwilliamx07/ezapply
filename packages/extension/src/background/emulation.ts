import { ext } from "../ext.js";

/**
 * Focus emulation: the application tab runs as a visible, focused page even when it's in the background, its
 * window is minimized, or it's behind another app. Chrome slows a hidden page's timers to about once a second (once
 * a minute after five minutes), stops its animation frames, and may freeze it; and a page whose window is behind
 * another app gets no focus events. Every adapter wait is a timer, and Workday's widgets render on timers and
 * animation frames and track focus.
 *
 * Done with the DevTools protocol through `chrome.debugger`: `Emulation.setFocusEmulationEnabled` makes the page
 * report itself focused, and Chrome counts the tab as being captured, which keeps it visible to the page and
 * rendering. That's the browser's own state, so the page's own timers and animations run at full speed too, which
 * no script in the page could achieve (a page-side timer shim only speeds the code that uses it).
 *
 * The cost: Chrome shows "ezapply started debugging this browser" while any tab is attached. So a tab is attached
 * only while it's being filled: from the first form call, until no call has come for `IDLE_MS` or the companion
 * disconnects. Cancel on Chrome's bar detaches it, and the next form call attaches it again: filling depends on it,
 * and nothing else keeps a hidden tab at full speed.
 *
 * Turned on again before every call: a Chromium fix to keep it across navigations was reverted, so a page that
 * navigated (a step that loads a new document) may have lost it.
 */

/** The DevTools protocol version asked for. */
const PROTOCOL = "1.3";
/** How long a tab stays attached after its last form call. */
const IDLE_MS = 5 * 60_000;

/** Tabs attached by this extension, with their idle timers. */
const attached = new Map<number, ReturnType<typeof setTimeout>>();

function send(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
  return ext.debugger.sendCommand({ tabId }, method, params);
}

/**
 * Attach to the tab (when not yet) and turn focus emulation on; `again` turns it off first, for a page that lost it.
 * False when it can't be done (another debugger holds the tab, a policy forbids the debugger, the page is out of
 * the debugger's reach): the page then runs as the browser leaves it. Never throws.
 */
export async function emulateFocus(tabId: number, again = false): Promise<boolean> {
  try {
    if (!attached.has(tabId)) {
      await ext.debugger.attach({ tabId }, PROTOCOL).catch((err: Error) => {
        // Still attached from before this background lost track (a restart): carry on with it.
        if (!/already attached/i.test(err.message)) throw err;
      });
      attached.set(tabId, idleTimer(tabId));
    }
    if (again) await send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: false });
    await send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true });
    clearTimeout(attached.get(tabId));
    attached.set(tabId, idleTimer(tabId));
    return true;
  } catch {
    await release(tabId);
    return false;
  }
}

/** The tab's page as a PNG (base64) through the debugger, which works on a tab that isn't in front. */
export async function captureAttached(tabId: number): Promise<string | undefined> {
  if (!attached.has(tabId)) return undefined;
  const r = (await send(tabId, "Page.captureScreenshot", { format: "png" }).catch(() => undefined)) as
    | { data?: string }
    | undefined;
  return r?.data;
}

/** Detach from every tab (the companion went away: nothing will fill them). */
export async function releaseAll(): Promise<void> {
  await Promise.all([...attached.keys()].map(release));
}

async function release(tabId: number): Promise<void> {
  clearTimeout(attached.get(tabId));
  if (!attached.delete(tabId)) return;
  await ext.debugger.detach({ tabId }).catch(() => undefined);
}

function idleTimer(tabId: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => void release(tabId), IDLE_MS);
}

// Detached by Chrome (Cancel on its bar, the tab navigating to a page the debugger can't reach): forget it, so the
// next form call attaches again.
ext.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined) return;
  clearTimeout(attached.get(source.tabId));
  attached.delete(source.tabId);
});

ext.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(attached.get(tabId));
  attached.delete(tabId);
});
