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

/**
 * The job a Workday URL is for, lowercased: the requisition at the end of the job's path segment
 * (`…/job/Toronto/Engineer_JR1000001-1/apply` or `…/details/Engineer_JR1000001-1` → `jr1000001-1`). Undefined when
 * the URL names none.
 */
export function workdayJob(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (!workdayTenant(url)) return undefined;
  const parts = u.pathname.split("/").filter(Boolean);
  const start = parts.findIndex((p) => /^(job|details)$/i.test(p));
  if (start < 0) return undefined;
  const apply = parts.findIndex((p, i) => i > start && /^apply$/i.test(p));
  const slug = parts.slice(start + 1, apply < 0 ? undefined : apply).at(-1);
  const req = slug ? /_([^_]+)$/.exec(decodeURIComponent(slug))?.[1] : undefined;
  return req?.toLowerCase();
}

/** A posting's identifying path: without the locale segment, which the same job's links have or lack. */
export function workdayCanonicalPath(pathname: string): string {
  return pathname.replace(WORKDAY_LOCALE_SEGMENT, "");
}
