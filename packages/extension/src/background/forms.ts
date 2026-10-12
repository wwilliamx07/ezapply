import {
  type DebugRequest,
  ErrorCode,
  type ExtensionApi,
  EzError,
  type Handlers,
  HOST_PERMISSIONS,
  isFormSite,
  SITES,
  type SiteId,
  siteInfo,
  WithDebug,
} from "@ezapply/protocol";
import { ext } from "../ext.js";
import { askForAccess } from "./access.js";
import { captureAttached, emulateFocus } from "./emulation.js";
import { frameSite, frameUrl, tabSite } from "./frames.js";

type FormHandlers = Omit<Handlers<typeof ExtensionApi>, "browser.status" | "panel.update">;

/** The sites the form tools work on, as the user knows them. */
const SUPPORTED = SITES.map((s) => s.name).join(", ");

/** A site's adapter bundle (`<site>-main.js`, built per registry entry) and the name it defines on the window. */
const adapterOf = (site: SiteId) =>
  siteInfo(site) ? { file: `${site}-main.js`, global: `__ezapply_${site}` } : undefined;

/**
 * Pick the tab to act on: explicit id, else the focused window's active application tab (of a registry site, by its
 * page), else the most recent one. The companion normally passes an explicit id (it prefers the active posting's
 * tenant); the fallback serves callers that don't.
 */
async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId !== undefined) {
    const tab = await ext.tabs.get(tabId).catch(() => null);
    if (!tab)
      throw new EzError(ErrorCode.NotFound, `Tab ${tabId} no longer exists.`, "Call browser_status for open tabs.");
    return tab;
  }
  const [active] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && isFormSite(await tabSite(active))) return active;
  const tabs = (await ext.tabs.query({})).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const sites = await Promise.all(tabs.map(tabSite));
  const found = tabs.find((_, i) => isFormSite(sites[i] as SiteId));
  if (found) return found;
  throw new EzError(
    ErrorCode.NotFound,
    `No application tab is open on a supported site (${SUPPORTED}).`,
    "Ask the user to open the application (click Apply on the posting) in the browser.",
  );
}

/** Where a form call acts: a tab's own page, or one frame of it (`frameId`, an embedded application). */
interface FormTarget {
  tabId: number;
  frameId?: number;
  site: SiteId;
  /** The form's page: the tab's, or the frame's. */
  url: string;
}

/** The tab's own page, when it's a form site's: by its body, read once the extension has access to it. */
async function requireFormSite(tab: chrome.tabs.Tab): Promise<FormTarget> {
  if (tab.id && tab.url) await requireAccess(tab.url);
  const site = await tabSite(tab);
  if (!tab.id || !tab.url || !isFormSite(site)) {
    throw new EzError(
      ErrorCode.BadRequest,
      `Tab ${tab.id} is not an application page of a supported site (${tab.url ?? "unknown"}).`,
      `The form tools support ${SUPPORTED}.`,
    );
  }
  return { tabId: tab.id, site, url: tab.url };
}

/**
 * A frame of the tab on a form site. Its id is the one `browser.status` listed: a frame that reloads, or a page that
 * moves on, gives its frames new ids, so a gone frame fails the call as a closed tab does, and the companion finds
 * the form again on the next call.
 */
async function requireFormFrame(tab: chrome.tabs.Tab, frameId: number): Promise<FormTarget> {
  const tabId = tab.id as number;
  const url = await frameUrl(tabId, frameId);
  if (!url) {
    throw new EzError(
      ErrorCode.NotFound,
      `The application's frame in tab ${tabId} is gone (the page reloaded or moved on).`,
      "Call get_form again: it finds the form where it is now.",
    );
  }
  await requireAccess(url);
  const site = await frameSite(tabId, frameId, url);
  if (!isFormSite(site)) {
    throw new EzError(
      ErrorCode.BadRequest,
      `Frame ${frameId} of tab ${tabId} is not an application of a supported site (${url}).`,
      `The form tools support ${SUPPORTED}.`,
    );
  }
  return { tabId, frameId, site, url };
}

/**
 * The extension must hold the form page's origin (the frame's, for an embedded form) before it can read which site
 * the page is, let alone fill it. It's granted every site at install (`HOST_PERMISSIONS`), but Chrome lets the
 * user limit that to some sites. Missing, the call asks for every site
 * again: a small window with an Allow access button (`askForAccess`), which the call waits on for a while before
 * failing with a hint to call again once the user has allowed it. A page that isn't on the web is never readable,
 * and its URL decides.
 */
async function requireAccess(url: string): Promise<void> {
  if (!/^https?:/i.test(url)) return;
  const { host, origin } = new URL(url);
  if (await ext.permissions.contains({ origins: [`${origin}/*`] })) return;
  if (await askForAccess([...HOST_PERMISSIONS], { host })) return;
  throw new EzError(
    ErrorCode.BadRequest,
    `The extension has no access to ${host} yet.`,
    `A small ezapply window is asking the user to allow access to websites: ask them to click Allow access there ` +
      "and confirm in the browser's prompt, then call again.",
  );
}

type Timing = Record<string, number> | undefined;

/** What a form call brings besides its arguments: the waits, and debug mode when it's on. */
interface CallOptions {
  timing?: Timing;
  debug?: DebugRequest;
}

/** A debugged call's trace, as the adapter returns it (adapters/engine/trace.ts), and the screenshot added here. */
type Trace = { failedFields?: string[]; screenshot?: string } & Record<string, unknown>;

/**
 * Inject the site's adapter (idempotent) and call one of its methods in the page's MAIN world, with the waits the
 * companion sent (from the workspace's autofill-timing.yaml) set first; none restores the defaults. An embedded
 * form's frame gets its own adapter, and its own submit guard, as any page does: only that frame is injected.
 *
 * With `debug` (debug mode) the adapter records its trace for this call (`setDebug`, set in the same
 * script as the waits) and hands it back (`takeDebug`); it goes to the companion beside the result
 * (`WithDebug`), or on the error, never in the result itself. After a call where a field failed, a screenshot of the
 * tab joins it when the tab is on screen: the page can't reach the extension mid-call, and the browser allows only a
 * couple of captures a second, so it's one per call, after it, not one per failure.
 */
async function callAdapter<T>(
  target: FormTarget,
  method: string,
  args: unknown[],
  { timing, debug }: CallOptions,
): Promise<T | WithDebug<T>> {
  const { tabId, frameId, site } = target;
  const adapter = adapterOf(site);
  if (!adapter) throw new EzError(ErrorCode.BadRequest, `No form adapter for ${site} pages.`);
  const where = frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
  await ext.scripting.executeScript({ target: where, files: [adapter.file], world: "MAIN" });
  const [res] = await ext.scripting.executeScript({
    target: where,
    world: "MAIN",
    // executeScript args must be JSON-serializable: null, not undefined.
    args: [adapter.global, method, args, timing ?? null, debug ?? null],
    func: async (g: string, m: string, a: unknown[], t: Timing | null, d: DebugRequest | null) => {
      const api = (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)[g];
      if (!api) return { __error: "adapter not loaded" };
      const trace = () => (d ? api.takeDebug?.() : undefined);
      try {
        api.setTiming?.(t);
        api.setDebug?.(d);
        const ok = await api[m]?.(...a);
        return { __ok: ok, __debug: trace() };
      } catch (err) {
        return { __error: (err as Error).message, __debug: trace() };
      }
    },
  });
  const out = res?.result as { __ok?: T; __error?: string; __debug?: Trace } | undefined;
  if (!out) throw new EzError(ErrorCode.Internal, "The page did not respond.", "Reload the tab and try again.");
  const trace = out.__debug;
  if (trace && debug?.failures && trace.failedFields?.length) {
    const png = await screenshotIfShown(tabId);
    if (png) trace.screenshot = png;
  }
  if (out.__error) throw Object.assign(new EzError(ErrorCode.BadRequest, out.__error), trace ? { debug: trace } : {});
  return trace ? new WithDebug(out.__ok as T, trace) : (out.__ok as T);
}

/**
 * The tab's page as a PNG (base64): through the debugger while focus emulation holds the tab (it renders even in
 * the background), else the visible area when it's the active tab of its window. Never fails the call.
 */
async function screenshotIfShown(tabId: number): Promise<string | undefined> {
  try {
    const attached = await captureAttached(tabId);
    if (attached) return attached;
    const tab = await ext.tabs.get(tabId);
    if (!tab.active) return undefined;
    const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch {
    return undefined;
  }
}

/** A call's result changed by `fn`, keeping the trace beside it. */
function mapResult<T, R>(out: T | WithDebug<T>, fn: (r: T) => R): R | WithDebug<R> {
  return out instanceof WithDebug ? new WithDebug(fn(out.result), out.debug) : fn(out);
}

/** The tab's own page, or the frame asked for (`frameId` 0 is the tab's own page), with access to it checked. */
const target = async ({ tabId, frameId }: { tabId?: number; frameId?: number }) => {
  const tab = await resolveTab(tabId);
  return frameId ? requireFormFrame(tab, frameId) : requireFormSite(tab);
};

export const formHandlers: FormHandlers = {
  "form.get": async ({ timing, debug, ...at }) => {
    const t = await target(at);
    const out = await callAdapter<Record<string, unknown>>(t, "getForm", [], { timing, debug });
    return mapResult(
      out,
      (schema) => ({ ...schema, tabId: t.tabId, ...(t.frameId !== undefined ? { frameId: t.frameId } : {}) }) as never,
    );
  },
  "form.listOptions": async ({ fieldId, timing, debug, ...at }) =>
    callAdapter(await target(at), "listOptions", [fieldId], { timing, debug }),
  "form.searchOptions": async ({ fieldId, query, timing, debug, ...at }) =>
    callAdapter(await target(at), "searchOptions", [fieldId, query], { timing, debug }),
  "form.fill": async ({ fills, timing, debug, ...at }) =>
    callAdapter(await target(at), "fill", [fills], { timing, debug }),
  "form.upload": async ({ fieldId, file, timing, debug, ...at }) =>
    callAdapter(await target(at), "upload", [fieldId, file], { timing, debug }),
  // executeScript args must be JSON-serializable: send null rather than undefined for "all values".
  "form.remove": async ({ fieldId, values, timing, debug, ...at }) =>
    callAdapter(await target(at), "remove", [fieldId, values ?? null], { timing, debug }),
  "form.removeRepeatable": async ({ sectionId, timing, debug, ...at }) =>
    callAdapter(await target(at), "removeRepeatable", [sectionId], { timing, debug }),
  "form.addRepeatable": async ({ addButtonId, timing, debug, ...at }) =>
    callAdapter(await target(at), "addRepeatable", [addButtonId], { timing, debug }),
  "form.next": async ({ timing, debug, ...at }) => callAdapter(await target(at), "next", [], { timing, debug }),
  "form.back": async ({ timing, debug, ...at }) => callAdapter(await target(at), "back", [], { timing, debug }),
  "form.pageAction": async ({ action, timing, debug, ...at }) =>
    callAdapter(await target(at), "pageAction", [action], { timing, debug }),
  "tab.screenshot": async ({ tabId }) => {
    const tab = await resolveTab(tabId);
    if (!tab.id) throw new EzError(ErrorCode.NotFound, "Tab has no id.");
    const attached = await captureAttached(tab.id);
    if (attached) return { tabId: tab.id, pngBase64: attached };
    if (!tab.active) {
      throw new EzError(
        ErrorCode.BadRequest,
        "Only the visible tab can be captured.",
        "Ask the user to switch to that tab.",
      );
    }
    const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { tabId: tab.id, pngBase64: dataUrl.replace(/^data:image\/png;base64,/, "") };
  },
  "tab.show": async ({ tabId, frameId }) => {
    const tab = await resolveTab(tabId);
    if (!tab.id) throw new EzError(ErrorCode.NotFound, "Tab has no id.");
    const at = { tabId: tab.id, windowId: tab.windowId, ...(frameId ? { frameId } : {}) };
    const wasActive = tab.active ?? false;
    // Focus emulation: the tab runs visible and focused where it is, so nothing is switched or raised and the
    // user keeps the tab and app they're on. Turned on again once if the page doesn't report it (a page that
    // navigated may have lost it).
    if (!(await emulateFocus(tab.id)))
      return { tabId: tab.id, emulated: false, ...(await pageState(at, { wasActive })) };
    let state = await pageState(at, { emulated: true, wasActive });
    if (state.hidden || state.focused === false) {
      await emulateFocus(tab.id, true);
      state = await pageState(at, { emulated: true, wasActive });
    }
    return { tabId: tab.id, emulated: true, ...state };
  },
};

/**
 * Whether the page reports itself hidden, and whether it has focus. The page learns of focus emulation
 * asynchronously, so after it's turned on the page is asked a few times (until it's visible and focused). Polled
 * from here, not from the page: the background's timers aren't throttled. Without access to the page (it's never
 * an application tab then), the tab's active state stands in, and focus isn't known.
 *
 * An embedded form is read in its frame (the page around it is usually out of reach). Its `focused` is the top
 * page's under focus emulation, else the browser window's: a frame's own `document.hasFocus()` is false whenever
 * focus is in the page around it.
 */
async function pageState(
  at: { tabId: number; windowId: number; frameId?: number },
  { emulated = false, wasActive }: { emulated?: boolean; wasActive: boolean },
): Promise<{ hidden: boolean; focused?: boolean }> {
  const { tabId, frameId } = at;
  const windowFocused = async () => (await ext.windows.get(at.windowId).catch(() => null))?.focused === true;
  const read = () => ({ hidden: document.visibilityState === "hidden", focused: document.hasFocus() });
  const topFocused = async () => {
    const [top] = await ext.scripting.executeScript({ target: { tabId }, func: read }).catch(() => [undefined]);
    return (top?.result as { focused?: unknown } | undefined)?.focused === true;
  };
  const tries = emulated ? 10 : 1;
  let state = { hidden: true, focused: false };
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50));
    const [res] = await ext.scripting
      .executeScript({ target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] }, func: read })
      .catch(() => [undefined]);
    const r = res?.result as { hidden?: unknown; focused?: unknown } | undefined;
    if (typeof r?.hidden !== "boolean") return { hidden: !wasActive };
    const focused = frameId === undefined ? r.focused === true : emulated ? await topFocused() : await windowFocused();
    state = { hidden: r.hidden, focused };
    if (!r.hidden && focused) break;
  }
  return state;
}
