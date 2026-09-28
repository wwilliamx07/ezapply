/**
 * Workday facts shared by the companion and the in-page adapter: which hosts serve applications, how to
 * read the tenant from a URL, and the posting page's data-automation-id hooks. No zod and no other imports,
 * so the adapter bundle that is injected into Workday pages stays small (import it as
 * `@ezapply/protocol/workday`).
 */

/**
 * Hosts that serve Workday job postings and applications to candidates: `<tenant>.wd5.myworkdayjobs.com`
 * and `wd5.myworkdaysite.com/recruiting/<tenant>/…`. Not `www.workday.com` (marketing) and not
 * `*.myworkday.com` (employee tenants), which are no application sites.
 */
export const WORKDAY_HOST = /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/i;

/** Host permission patterns for the same hosts (the extension manifest must list exactly these). */
export const WORKDAY_HOST_PERMISSIONS = ["*://*.myworkdayjobs.com/*", "*://*.myworkdaysite.com/*"] as const;

/** A leading locale segment such as `/en-US/`, which Workday adds or leaves out for the same page. */
export const WORKDAY_LOCALE_SEGMENT = /^\/[a-z]{2}-[A-Z]{2}(?=\/|$)/;

export function isWorkdayUrl(url: string): boolean {
  try {
    return WORKDAY_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The Workday tenant a URL belongs to, lowercased: the first host label on myworkdayjobs.com
 * (`acme.wd5.myworkdayjobs.com`), the segment after `recruiting` on myworkdaysite.com
 * (`wd5.myworkdaysite.com/en-US/recruiting/acme/External/…`). Undefined for other sites.
 */
export function workdayTenant(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)myworkdayjobs\.com$/.test(host)) {
    const first = host.split(".")[0];
    return first && !/^wd\d+$/.test(first) ? first : undefined;
  }
  if (/(^|\.)myworkdaysite\.com$/.test(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => p.toLowerCase() === "recruiting");
    return i >= 0 && parts[i + 1] ? parts[i + 1]?.toLowerCase() : undefined;
  }
  return undefined;
}

/** data-automation-id hooks on a Workday job posting page (verified against live tenants). */
export const WORKDAY_POSTING = {
  description: "jobPostingDescription",
  header: "jobPostingHeader",
  locations: "locations",
  requisitionId: "requisitionId",
} as const;
