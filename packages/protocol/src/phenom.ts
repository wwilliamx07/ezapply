/**
 * Phenom People career sites: an employer's own careers domain (`jobs.example.com`) run by Phenom, whose application
 * is Phenom's own multi-step form on that domain, `…/<region>/<lang>/apply?jobSeqNo=<job>&step=<n>&stepname=<id>`
 * (the posting's Apply button goes to `…/hvhapply?jobSeqNo=…`, which redirects there). Phenom sends what's entered on
 * to the employer's ATS (often Workday), but the page is Phenom's. The extension knows a Phenom page by its body (the
 * registry's `signature`); this URL rule is for where only a URL is known (a captured page's links, a tab the
 * extension can't read). It goes by the last path segment and `jobSeqNo`, since the host is the employer's and the
 * segments before it vary (`/ca/en/`, `/global/en/`, none); the posting pages (`…/job/<id>/<slug>`) are too generic
 * a shape to count. No imports (the adapter bundle imports it).
 */
const APPLY_PATH = /^(?:\/[^/]+)*\/(?:hvh)?apply\/?$/i;

export function isPhenomUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && APPLY_PATH.test(u.pathname) && Boolean(u.searchParams.get("jobSeqNo")?.trim());
  } catch {
    return false;
  }
}

/**
 * The employer's space: the careers site's host, lowercased, for any https page of a Phenom site (the extension may
 * know a page is Phenom's by its body when its URL is no apply page's).
 */
export function phenomTenant(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The job: `jobSeqNo`, lowercased (Phenom's id for the job on that site, which embeds the requisition). Only the apply
 * pages name it: the posting page's `…/job/<id>/` is another id (`R-0000000001` for `GLOBA0001R0000000001EXTERNALENCA`).
 */
export function phenomJob(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("jobSeqNo")?.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** The application's identifying path: the apply page whatever its step (`hvhapply` is the same application). */
export function phenomCanonicalPath(pathname: string): string {
  return pathname.replace(/\/hvhapply\/?$/i, "/apply");
}
