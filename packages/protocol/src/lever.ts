/**
 * Lever's hosted postings: `jobs.lever.co/<company>/<posting id>` and its application, `…/apply` (`jobs.eu.lever.co`
 * in Europe). No imports (the adapter bundle imports it).
 */
const LEVER_HOST = /^jobs(\.eu)?\.lever\.co$/i;

export function isLeverUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && LEVER_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

const segments = (url: string) => new URL(url).pathname.split("/").filter(Boolean);

/** The company, lowercased: the path's first segment. */
export function leverTenant(url: string): string | undefined {
  return isLeverUrl(url) ? segments(url)[0]?.toLowerCase() : undefined;
}

/** The posting id: the path's second segment. */
export function leverJob(url: string): string | undefined {
  return isLeverUrl(url) ? segments(url)[1]?.toLowerCase() : undefined;
}

/** A posting's identifying path: without `/apply` and what follows, so the application is the posting's. */
export function leverCanonicalPath(pathname: string): string {
  return pathname.replace(/\/apply(\/.*)?$/i, "");
}
