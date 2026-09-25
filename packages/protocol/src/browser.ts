import { z } from "zod";
import { SiteId } from "./postings.js";

export const TabInfo = z.object({
  tabId: z.number().int(),
  windowId: z.number().int(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  site: SiteId,
});
export type TabInfo = z.infer<typeof TabInfo>;

export const BrowserStatus = z.object({
  extensionVersion: z.string(),
  tabs: z.array(TabInfo),
});
export type BrowserStatus = z.infer<typeof BrowserStatus>;

const WORKDAY_HOST = /(^|\.)(myworkdayjobs|myworkdaysite|workday)\.com$/i;

/** Site detection shared by the extension and the companion. */
export function detectSite(url: string): SiteId {
  try {
    return WORKDAY_HOST.test(new URL(url).hostname) ? "workday" : "generic";
  } catch {
    return "generic";
  }
}
