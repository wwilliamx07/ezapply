/**
 * Oracle Recruiting Cloud facts shared by the companion, the extension and the in-page adapter: which pages
 * are Oracle career sites and how to read the tenant from a URL. No zod and no other imports, so the adapter
 * bundle stays small (import it as `@ezapply/protocol/oracle`).
 *
 * Oracle's Candidate Experience runs on the customer's Oracle Cloud host
 * (`<pod>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123`) or, just as often, on the
 * employer's own domain (`jobs.umbrella.example/en/sites/CX_1/job/123`). The host alone can't say which, so the path
 * does: a language, `sites/<site number>`, then one of the Candidate Experience's own routes.
 */

/** `/hcmUI/CandidateExperience`? `/<lang>` `/sites/<site>` `/job|jobs|requisitions|my-profile`. */
const ORACLE_PATH =
  /^\/(?:hcmUI\/CandidateExperience\/)?[a-z]{2}(?:-[A-Za-z]{2,4})?\/sites\/([^/]+)\/(?:job|jobs|requisitions|my-profile)(?:\/|$)/i;

/** The language segment after the optional `hcmUI/CandidateExperience` prefix, which the same job's links vary. */
export const ORACLE_LOCALE_SEGMENT = /^(\/hcmUI\/CandidateExperience)?\/[a-z]{2}(?:-[A-Za-z]{2,4})?(?=\/sites\/)/i;

/**
 * Oracle pages may be on any https host (employers' vanity domains), so the extension can't list them in its
 * manifest: it asks for access to one origin at a time, and the manifest's optional host permissions must
 * cover these patterns.
 */
export const ORACLE_OPTIONAL_HOST_PERMISSIONS = ["https://*/*"] as const;

export function isOracleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ORACLE_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * The Oracle career site a URL belongs to, lowercased: host and site number (`jobs.umbrella.example/cx_1`). One
 * employer's postings and applications share it. Undefined for other pages.
 */
export function oracleTenant(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:") return undefined;
  const site = ORACLE_PATH.exec(u.pathname)?.[1];
  return site ? `${u.hostname.toLowerCase()}/${site.toLowerCase()}` : undefined;
}

/**
 * The path that identifies an Oracle job: without the language segment and without what follows the job id
 * (`/apply/section/1`), so a capture on the application pages is the same posting as one on the job page.
 */
export function oracleJobPath(pathname: string): string {
  return pathname.replace(ORACLE_LOCALE_SEGMENT, "$1").replace(/(\/job\/[^/]+)\/.*$/i, "$1");
}

/** The job id an Oracle URL is for (`…/job/42/apply/section/1` → `42`), lowercased. */
export function oracleJob(url: string): string | undefined {
  if (!oracleTenant(url)) return undefined;
  return /\/job\/([^/]+)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
}
