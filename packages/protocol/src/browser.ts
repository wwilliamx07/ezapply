import { z } from "zod";
import { SiteId } from "./postings.js";

/**
 * Browsers the companion can open pages and files in. The extension reports which one it runs in, so what
 * ezapply opens for the user lands in the browser they apply in (their sign-ins, the extension), not the
 * system default.
 */
const BROWSER_NAMES = ["chrome", "edge", "brave", "opera", "vivaldi", "chromium"] as const;
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

/** A frame of a tab on a form site: an application embedded in another site's page (a careers page's Greenhouse). */
export const FrameInfo = z.object({
  frameId: z.number().int(),
  url: z.string(),
  site: SiteId,
});
export type FrameInfo = z.infer<typeof FrameInfo>;

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
  /** Frames inside the page that are on a form site (never the top frame); absent when there are none. */
  frames: z.array(FrameInfo).optional(),
});
export type TabInfo = z.infer<typeof TabInfo>;

export const BrowserStatus = z.object({
  extensionVersion: z.string(),
  tabs: z.array(TabInfo),
});
export type BrowserStatus = z.infer<typeof BrowserStatus>;
