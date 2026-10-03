import { z } from "zod";
import { SiteId } from "./postings.js";
import { FORM_SITE_IDS, siteOfUrl } from "./sites.js";

/**
 * Browsers the companion can open pages and files in. The extension reports which one it runs in, so what
 * ezapply opens for the user lands in the browser they apply in (their sign-ins, the extension), not the
 * system default.
 */
export const BROWSER_NAMES = ["chrome", "edge", "brave", "opera", "vivaldi", "chromium", "firefox"] as const;
export type BrowserName = (typeof BROWSER_NAMES)[number];

/** The browser the extension runs in. `name` is a BrowserName, or something newer the companion may not know. */
export const BrowserInfo = z.object({
  name: z.string().max(40),
  version: z.string().max(40).optional(),
});
export type BrowserInfo = z.infer<typeof BrowserInfo>;

export function isBrowserName(name: string): name is BrowserName {
  return (BROWSER_NAMES as readonly string[]).includes(name);
}

export const TabInfo = z.object({
  tabId: z.number().int(),
  windowId: z.number().int(),
  url: z.string(),
  title: z.string(),
  /** The selected tab of its window. */
  active: z.boolean(),
  /** Selected in the window the user last focused, i.e. the tab they're looking at. */
  focused: z.boolean().optional(),
  /** When the tab was last active (epoch ms), for picking the most recent. */
  lastAccessed: z.number().optional(),
  site: SiteId,
});
export type TabInfo = z.infer<typeof TabInfo>;

export const BrowserStatus = z.object({
  extensionVersion: z.string(),
  tabs: z.array(TabInfo),
});
export type BrowserStatus = z.infer<typeof BrowserStatus>;

/** Site detection shared by the extension and the companion: the registry's site for the URL, else generic. */
export function detectSite(url: string): SiteId {
  return siteOfUrl(url)?.id ?? "generic";
}

/** The sites whose application forms ezapply reads and fills, each with its own adapter: the registry. */
export const FORM_SITES: readonly SiteId[] = FORM_SITE_IDS;

export function isFormSite(site: SiteId): boolean {
  return FORM_SITES.includes(site);
}

/** The tenant an application or posting URL belongs to on its site (a Workday tenant, an Oracle career site). */
export function siteTenant(url: string): string | undefined {
  return siteOfUrl(url)?.tenant(url);
}

/**
 * The job an application or posting URL is for, lowercased (a Workday requisition, an Oracle job id), as its
 * site reads it. Undefined when the URL doesn't name one. Two postings at one company share a tenant; this tells
 * their applications apart.
 */
export function siteJob(url: string): string | undefined {
  return siteOfUrl(url)?.job(url);
}

/**
 * Whether two job ids name the same job: equal, or one is the other with Workday's posting suffix (`jr1000001`
 * and `jr1000001-1`: the requisition, and its first posting).
 */
export function sameJob(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
}
