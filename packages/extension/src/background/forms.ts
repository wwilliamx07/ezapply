import {
  detectSite,
  ErrorCode,
  type ExtensionApi,
  EzError,
  type Handlers,
  isFormSite,
  type SiteId,
  siteInfo,
} from "@ezapply/protocol";
import { ext } from "../ext.js";

type FormHandlers = Omit<Handlers<typeof ExtensionApi>, "browser.status">;

/** A site's adapter bundle (`<site>-main.js`, built per registry entry) and the name it defines on the window. */
const adapterOf = (site: SiteId) =>
  siteInfo(site) ? { file: `${site}-main.js`, global: `__ezapply_${site}` } : undefined;

const siteOf = (tab: chrome.tabs.Tab) => (tab.url ? detectSite(tab.url) : "generic");

/**
 * Pick the tab to act on: explicit id, else the focused window's active application tab (Workday or Oracle),
 * else the most recent one. The companion normally passes an explicit id (it prefers the active posting's
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
  if (active && isFormSite(siteOf(active))) return active;
  const forms = (await ext.tabs.query({}))
    .filter((t) => isFormSite(siteOf(t)))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (forms[0]) return forms[0];
  throw new EzError(
    ErrorCode.NotFound,
    "No Workday or Oracle application tab is open.",
    "Ask the user to open the application (click Apply on the posting) in the browser.",
  );
}

function requireFormSite(tab: chrome.tabs.Tab): { tabId: number; site: SiteId } {
  const site = siteOf(tab);
  if (!tab.id || !isFormSite(site)) {
    throw new EzError(
      ErrorCode.BadRequest,
      `Tab ${tab.id} is not a Workday or Oracle application page (${tab.url ?? "unknown"}).`,
      "Autofill supports Workday and Oracle Recruiting Cloud sites.",
    );
  }
  return { tabId: tab.id, site };
}

/**
 * The extension must hold the tab's origin. A site with fixed hosts (Workday) gets them with the install (Firefox
 * lets the user withhold or revoke them); a site granted per origin (Oracle) gets one origin at a time, by Set
 * posting on it or the options page.
 */
async function requireSiteAccess(tabId: number, site: SiteId): Promise<void> {
  const { url } = await ext.tabs.get(tabId);
  if (!url || (await ext.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) return;
  const info = siteInfo(site);
  if (info?.access.kind === "per-origin") {
    throw new EzError(
      ErrorCode.BadRequest,
      `The extension has no access to ${new URL(url).host} yet.`,
      "Ask the user to click the ezapply button (Set posting) on that tab and allow access to the site, or click " +
        "Grant access next to it in the extension's options page.",
    );
  }
  throw new EzError(
    ErrorCode.BadRequest,
    `The extension does not have access to ${info?.name ?? site} sites.`,
    "Ask the user to open the ezapply extension options and click Grant site access.",
  );
}

type Timing = Record<string, number> | undefined;

/**
 * Inject the site's adapter (idempotent) and call one of its methods in the page's MAIN world, with the waits the
 * companion sent (from the workspace's autofill-timing.yaml) set first; none restores the defaults.
 */
async function callAdapter<T>(
  target: { tabId: number; site: SiteId },
  method: string,
  args: unknown[],
  timing?: Timing,
): Promise<T> {
  const { tabId, site } = target;
  const adapter = adapterOf(site);
  if (!adapter) throw new EzError(ErrorCode.BadRequest, `No form adapter for ${site} pages.`);
  await requireSiteAccess(tabId, site);
  await ext.scripting.executeScript({ target: { tabId }, files: [adapter.file], world: "MAIN" });
  const [res] = await ext.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    // executeScript args must be JSON-serializable: null, not undefined.
    args: [adapter.global, method, args, timing ?? null],
    func: async (g: string, m: string, a: unknown[], t: Timing | null) => {
      const api = (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)[g];
      if (!api) return { __error: "adapter not loaded" };
      try {
        api.setTiming?.(t);
        return { __ok: await api[m]?.(...a) };
      } catch (err) {
        return { __error: (err as Error).message };
      }
    },
  });
  const out = res?.result as { __ok?: T; __error?: string } | undefined;
  if (!out) throw new EzError(ErrorCode.Internal, "The page did not respond.", "Reload the tab and try again.");
  if (out.__error) throw new EzError(ErrorCode.BadRequest, out.__error);
  return out.__ok as T;
}

const target = async (tabId?: number) => requireFormSite(await resolveTab(tabId));

export const formHandlers: FormHandlers = {
  "form.get": async ({ tabId, timing }) => {
    const t = await target(tabId);
    const schema = await callAdapter<Record<string, unknown>>(t, "getForm", [], timing);
    return { ...schema, tabId: t.tabId } as never;
  },
  "form.listOptions": async ({ tabId, fieldId, timing }) =>
    callAdapter(await target(tabId), "listOptions", [fieldId], timing),
  "form.searchOptions": async ({ tabId, fieldId, query, timing }) =>
    callAdapter(await target(tabId), "searchOptions", [fieldId, query], timing),
  "form.fill": async ({ tabId, fills, timing }) => callAdapter(await target(tabId), "fill", [fills], timing),
  "form.upload": async ({ tabId, fieldId, file, timing }) =>
    callAdapter(await target(tabId), "upload", [fieldId, file], timing),
  // executeScript args must be JSON-serializable: send null rather than undefined for "all values".
  "form.remove": async ({ tabId, fieldId, values, timing }) =>
    callAdapter(await target(tabId), "remove", [fieldId, values ?? null], timing),
  "form.removeRepeatable": async ({ tabId, sectionId, timing }) =>
    callAdapter(await target(tabId), "removeRepeatable", [sectionId], timing),
  "form.addRepeatable": async ({ tabId, addButtonId, timing }) =>
    callAdapter(await target(tabId), "addRepeatable", [addButtonId], timing),
  "form.next": async ({ tabId, timing }) => callAdapter(await target(tabId), "next", [], timing),
  "form.back": async ({ tabId, timing }) => callAdapter(await target(tabId), "back", [], timing),
  "form.pageAction": async ({ tabId, action, timing }) =>
    callAdapter(await target(tabId), "pageAction", [action], timing),
  "tab.screenshot": async ({ tabId }) => {
    const tab = await resolveTab(tabId);
    if (!tab.id) throw new EzError(ErrorCode.NotFound, "Tab has no id.");
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
  "tab.show": async ({ tabId, activate }) => {
    const tab = await resolveTab(tabId);
    if (!tab.id) throw new EzError(ErrorCode.NotFound, "Tab has no id.");
    // Switching the tab within its window is enough. windows.update({ focused: true }) would also pull the
    // browser in front of the terminal the user is typing in, and take keyboard focus, on every form call.
    const activated = activate && !tab.active;
    if (activated) await ext.tabs.update(tab.id, { active: true });
    return { tabId: tab.id, activated, hidden: await pageHidden(tab.id, activated, tab.active ?? false) };
  },
};

/**
 * Whether the page reports itself hidden. A minimized window, or on Windows one fully covered by others (Chrome
 * tracks occlusion), keeps its tabs hidden even when active: that's reported, not forced. The page learns of a
 * switch asynchronously, so after one it's asked a few times. Polled from here, not from the page: the
 * background's timers aren't throttled. Without access to the page (it's never an application tab then), the
 * tab's active state stands in.
 */
async function pageHidden(tabId: number, activated: boolean, wasActive: boolean): Promise<boolean> {
  const tries = activated ? 10 : 1;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50));
    const [res] = await ext.scripting
      .executeScript({ target: { tabId }, func: () => document.visibilityState === "hidden" })
      .catch(() => [undefined]);
    if (typeof res?.result !== "boolean") return !(activated || wasActive);
    if (!res.result) return false;
  }
  return true;
}
