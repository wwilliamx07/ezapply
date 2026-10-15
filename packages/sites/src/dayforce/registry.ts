/**
 * Dayforce's candidate portal: `jobs.dayforcehcm.com/<locale>/<client>/<career site>/jobs/<id>` for a posting, and
 * its application under it (`…/jobs/<id>/apply/manualApplication`). The locale segment is optional (`en-US`,
 * `zh-Hans`, `es-419`; the page's own links sometimes leave it out). `<client>` is the employer's namespace on
 * Dayforce and `<id>` its job posting id, numbered per client. The extension knows a Dayforce page by its body (the
 * registry's `signature`); this rule is for where only a URL is known. Dayforce's older portal
 * (`<cluster>.dayforcehcm.com/CandidatePortal/…`) is another app with other markup, and its paths don't match. No
 * zod (the adapter bundle imports it).
 */
import type { SiteInfo } from "@ezapply/protocol/sites";
import { STANDARD_WAITS } from "@ezapply/protocol/timing";

/** Every locale the portal offers has a region or script after a dash (`en-US`, `zh-Hans`, `es-419`). */
const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})+$/i;

const isJob = (parts: string[], at: number) =>
  parts[at + 2]?.toLowerCase() === "jobs" && /^\d+$/.test(parts[at + 3] ?? "");

/**
 * The path's parts from the client on (`[client, site, "jobs", id, …]`), without the locale. Where `jobs` sits says
 * whether there is a locale, since a client namespace can look like one.
 */
function fromClient(pathname: string): string[] | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (isJob(parts, 0)) return parts;
  if (parts[0] && LOCALE.test(parts[0]) && isJob(parts, 1)) return parts.slice(1);
  return undefined;
}

function jobPath(url: string): string[] | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !/(^|\.)dayforcehcm\.com$/i.test(u.hostname)) return undefined;
    return fromClient(u.pathname);
  } catch {
    return undefined;
  }
}

export function isDayforceUrl(url: string): boolean {
  return jobPath(url) !== undefined;
}

/**
 * The employer: its client namespace, lowercased. On a page the extension knows is Dayforce's by its body but whose
 * path isn't a job's (the search page), the first segment after the locale.
 */
export function dayforceTenant(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return undefined;
    const job = fromClient(u.pathname);
    if (job) return job[0]?.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    return (parts[0] && LOCALE.test(parts[0]) ? parts[1] : parts[0])?.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The job: its posting id (`1000`), the same on the posting and on every step of its application. */
export function dayforceJob(url: string): string | undefined {
  return jobPath(url)?.[3];
}

/**
 * The posting's identifying path: without the locale and without what follows the job id, so the posting, its
 * application and every step of it are one posting.
 */
export function dayforceCanonicalPath(pathname: string): string {
  const parts = fromClient(pathname);
  return parts ? `/${parts.slice(0, 4).join("/")}` : pathname;
}

/**
 * Its registry entry (`SITES` in `../registry.ts`). Dayforce's candidate portal: one host (jobs.dayforcehcm.com)
 * for every employer.
 */
export const dayforceInfo = {
  id: "dayforce" as const,
  name: "Dayforce",
  // The portal's own `test-id` hooks (not `data-testid`): on the application, its job header, step bar and Next;
  // on every page of the portal, the header's Search Jobs link and the session-expiry dialog. And its static host.
  signature:
    "[test-id='job-details-header'], [test-id^='application-progress-step-'], [test-id='application-next-step'], [test-id='header-search-jobs'], [test-id='session-expiry-modal'], script[src*='static.dayforcehcm.com']",
  isUrl: isDayforceUrl,
  tenant: dayforceTenant,
  job: dayforceJob,
  canonicalPath: dayforceCanonicalPath,
  // One host for every employer; the client segment is Dayforce's namespace for one, not a name to show.
  providerHosts: /(^|\.)dayforcehcm\.com$/i,
  // Not measured. Each waits on Dayforce's server: an attached resume is uploaded and parsed before the page lists
  // it (and a drop after `uploadMs` would send it again), an Update saves the record to the candidate's profile
  // before its form closes, and Next checks the step there.
  waits: { ...STANDARD_WAITS, uploadMs: 30_000, addRowMs: 15_000, stepMs: 30_000 },
} satisfies SiteInfo;
