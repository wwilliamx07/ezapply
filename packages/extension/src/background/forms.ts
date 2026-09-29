import { detectSite, ErrorCode, type ExtensionApi, EzError, type Handlers } from "@ezapply/protocol";
import { ext } from "../ext.js";

type FormHandlers = Omit<Handlers<typeof ExtensionApi>, "browser.status">;

const ADAPTER_FILE = "workday-main.js";

/**
 * Pick the tab to act on: explicit id, else the focused window's active Workday tab, else the most recent one.
 * The companion normally passes an explicit id (it prefers the active posting's tenant); the fallback serves
 * callers that don't.
 */
async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId !== undefined) {
    const tab = await ext.tabs.get(tabId).catch(() => null);
    if (!tab)
      throw new EzError(ErrorCode.NotFound, `Tab ${tabId} no longer exists.`, "Call browser_status for open tabs.");
    return tab;
  }
  const [active] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.url && detectSite(active.url) === "workday") return active;
  const workday = (await ext.tabs.query({}))
    .filter((t) => t.url && detectSite(t.url) === "workday")
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (workday[0]) return workday[0];
  throw new EzError(
    ErrorCode.NotFound,
    "No Workday tab is open.",
    "Ask the user to open the application (click Apply on the posting) in the browser.",
  );
}

function requireWorkday(tab: chrome.tabs.Tab): number {
  if (!tab.id || !tab.url || detectSite(tab.url) !== "workday") {
    throw new EzError(
      ErrorCode.BadRequest,
      `Tab ${tab.id} is not a Workday page (${tab.url ?? "unknown"}).`,
      "Autofill currently supports Workday only.",
    );
  }
  return tab.id;
}

/** Firefox lets the user withhold or revoke host permissions, which would make injection fail. */
async function requireSiteAccess(tabId: number): Promise<void> {
  const { url } = await ext.tabs.get(tabId);
  if (!url || (await ext.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) return;
  throw new EzError(
    ErrorCode.BadRequest,
    "The extension does not have access to Workday sites.",
    "Ask the user to open the ezapply extension options and click Grant site access.",
  );
}

type Timing = Record<string, number> | undefined;

/**
 * Inject the adapter (idempotent) and call one of its methods in the page's MAIN world, with the waits the
 * companion sent (from the workspace's autofill-timing.yaml) set first; none restores the defaults.
 */
async function callAdapter<T>(tabId: number, method: string, args: unknown[], timing?: Timing): Promise<T> {
  await requireSiteAccess(tabId);
  await ext.scripting.executeScript({ target: { tabId }, files: [ADAPTER_FILE], world: "MAIN" });
  const [res] = await ext.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    // executeScript args must be JSON-serializable: null, not undefined.
    args: [method, args, timing ?? null],
    func: async (m: string, a: unknown[], t: Timing | null) => {
      const api = (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).__ezapplyWorkday;
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

export const formHandlers: FormHandlers = {
  "form.get": async ({ tabId, timing }) => {
    const tab = await resolveTab(tabId);
    const id = requireWorkday(tab);
    const schema = await callAdapter<Record<string, unknown>>(id, "getForm", [], timing);
    return { ...schema, tabId: id } as never;
  },
  "form.listOptions": async ({ tabId, fieldId, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "listOptions", [fieldId], timing),
  "form.searchOptions": async ({ tabId, fieldId, query, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "searchOptions", [fieldId, query], timing),
  "form.fill": async ({ tabId, fills, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "fill", [fills], timing),
  "form.upload": async ({ tabId, fieldId, file, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "upload", [fieldId, file], timing),
  // executeScript args must be JSON-serializable: send null rather than undefined for "all values".
  "form.remove": async ({ tabId, fieldId, values, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "remove", [fieldId, values ?? null], timing),
  "form.removeRepeatable": async ({ tabId, sectionId, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "removeRepeatable", [sectionId], timing),
  "form.addRepeatable": async ({ tabId, addButtonId, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "addRepeatable", [addButtonId], timing),
  "form.next": async ({ tabId, timing }) => callAdapter(requireWorkday(await resolveTab(tabId)), "next", [], timing),
  "form.back": async ({ tabId, timing }) => callAdapter(requireWorkday(await resolveTab(tabId)), "back", [], timing),
  "form.pageAction": async ({ tabId, action, timing }) =>
    callAdapter(requireWorkday(await resolveTab(tabId)), "pageAction", [action], timing),
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
};
