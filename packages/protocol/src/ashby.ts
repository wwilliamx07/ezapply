/**
 * Ashby's hosted job boards: `jobs.ashbyhq.com/<organization>/<job id>`, with the application on the same page under
 * an Application tab (`…/application`). No imports (the adapter bundle imports it).
 */
export function isAshbyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^jobs\.ashbyhq\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

const segments = (url: string) => new URL(url).pathname.split("/").filter(Boolean).map(decodeURIComponent);

/** The organization, lowercased: the path's first segment. */
export function ashbyTenant(url: string): string | undefined {
  return isAshbyUrl(url) ? segments(url)[0]?.toLowerCase() : undefined;
}

/** The job id: the path's second segment. */
export function ashbyJob(url: string): string | undefined {
  return isAshbyUrl(url) ? segments(url)[1]?.toLowerCase() : undefined;
}

/** A posting's identifying path: without the `/application` tab, so the application is the posting's. */
export function ashbyCanonicalPath(pathname: string): string {
  return pathname.replace(/\/application\/?$/i, "");
}
