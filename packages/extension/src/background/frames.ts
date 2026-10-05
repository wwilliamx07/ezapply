import { detectSite, type FrameInfo, isFormSite, type SiteId, siteSignatures } from "@ezapply/protocol";
import { ext } from "../ext.js";

/**
 * Which site a page is, and the application forms embedded in other sites' pages (a company's careers page showing
 * its Greenhouse application in an iframe, which the form tools act on by its `frameId`).
 *
 * A page is a site's when its body shows it: each site's `signature` (protocol `sites.ts`), matched in the page.
 * That's what tells a Phenom or Oracle site on an employer's own domain, whose URLs vary from one employer to the
 * next. The URL (`detectSite`) is the fallback, where the page can't be read: a discarded tab, a browser page, a
 * page that didn't answer in time, an origin the user withheld. Read on every call, never cached: the same URL shows
 * another page once a single-page site renders.
 *
 * Frames are listed with `webNavigation.getAllFrames`, which gives every frame's URL whether or not its page answers.
 */

/** How long a page may take to answer before its URL decides. A page still loading answers at once. */
const READ_MS = 1_500;

/**
 * Runs in the page (isolated world): its URL, and the first site whose signature its document matches. Self-contained,
 * since `executeScript` sends it as source.
 */
export function pageSite(signatures: [string, string][]): { url: string; site: string | null } {
  for (const [site, selector] of signatures) {
    try {
      if (document.querySelector(selector)) return { url: location.href, site };
    } catch {
      // A selector this browser can't parse: try the next site's.
    }
  }
  return { url: location.href, site: null };
}

/** The sites the target's frames show, by frame id: only frames that answered and matched a signature. */
async function readSites(target: chrome.scripting.InjectionTarget): Promise<Map<number, SiteId>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READ_MS);
  });
  const read = ext.scripting
    .executeScript({ target, injectImmediately: true, func: pageSite, args: [siteSignatures()] })
    .catch(() => undefined);
  const results = await Promise.race([read, late]);
  clearTimeout(timer);
  const found = new Map<number, SiteId>();
  for (const r of results ?? []) {
    const site = (r.result as { site?: unknown } | undefined)?.site;
    if (typeof site === "string" && isFormSite(site as SiteId)) found.set(r.frameId ?? 0, site as SiteId);
  }
  return found;
}

/** Whether a tab's pages can be read at all: a page on the web, not discarded. */
const readable = (tab: chrome.tabs.Tab) => Boolean(tab.url && /^https?:/i.test(tab.url) && !tab.discarded);

/** A tab's own page's site: by its body, else its URL. */
export async function tabSite(tab: chrome.tabs.Tab): Promise<SiteId> {
  if (tab.id === undefined || !tab.url) return "generic";
  if (!readable(tab)) return detectSite(tab.url);
  return (await readSites({ tabId: tab.id })).get(0) ?? detectSite(tab.url);
}

/** A tab's site, and its frames on a form site (never the top frame), each by its body, else its URL. */
export async function tabSites(tab: chrome.tabs.Tab): Promise<{ site: SiteId; frames: FrameInfo[] }> {
  if (tab.id === undefined || !tab.url) return { site: "generic", frames: [] };
  if (!readable(tab)) return { site: detectSite(tab.url), frames: [] };
  const [read, all] = await Promise.all([
    readSites({ tabId: tab.id, allFrames: true }),
    ext.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null),
  ]);
  const frames: FrameInfo[] = [];
  for (const f of all ?? []) {
    if (f.frameId === 0 || !/^https:/i.test(f.url)) continue;
    const site = read.get(f.frameId) ?? detectSite(f.url);
    if (isFormSite(site)) frames.push({ frameId: f.frameId, url: f.url, site });
  }
  return { site: read.get(0) ?? detectSite(tab.url), frames };
}

/** One frame's site (`frameId` 0 is the tab's own page): by its body, else its URL. */
export async function frameSite(tabId: number, frameId: number, url: string): Promise<SiteId> {
  return (await readSites({ tabId, frameIds: [frameId] })).get(frameId) ?? detectSite(url);
}

/** One frame of the tab, or undefined once it's gone (the page reloaded or moved on, which gives frames new ids). */
export async function frameUrl(tabId: number, frameId: number): Promise<string | undefined> {
  const frame = await ext.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
  return frame?.url || undefined;
}
