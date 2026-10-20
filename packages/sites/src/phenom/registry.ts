/**
 * Phenom People career sites: an employer's own careers domain (`jobs.example.com`) run by Phenom, whose application
 * is Phenom's own multi-step form on that domain, `…/<region>/<lang>/apply?jobSeqNo=<job>&step=<n>&stepname=<id>`
 * (the posting's Apply button goes to `…/hvhapply?jobSeqNo=…`, which redirects there). Phenom sends what's entered on
 * to the employer's ATS (often Workday), but the page is Phenom's. The extension knows a Phenom page by its body (the
 * registry's `signature`); this URL rule is for where only a URL is known (a captured page's links, a tab the
 * extension can't read). It goes by the last path segment and `jobSeqNo`, since the host is the employer's and the
 * segments before it vary (`/ca/en/`, `/global/en/`, none); the posting pages (`…/job/<id>/<slug>`) are too generic
 * a shape to count. No zod (the adapter bundle imports it).
 */
import type { SiteInfo } from "@ezapply/protocol/sites";
import { STANDARD_WAITS } from "@ezapply/protocol/timing";

const APPLY_PATH = /^(?:\/[^/]+)*\/(?:hvh)?apply\/?$/i;

function isPhenomUrl(url: string): boolean {
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
function phenomTenant(url: string): string | undefined {
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
function phenomJob(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("jobSeqNo")?.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** The application's identifying path: the apply page whatever its step (`hvhapply` is the same application). */
function phenomCanonicalPath(pathname: string): string {
  return pathname.replace(/\/hvhapply\/?$/i, "/apply");
}

/**
 * Whether two job ids name one job on a Phenom site: `jobSeqNo` embeds the requisition the posting page and the
 * application show (`EXAMGLOBAL1000001EXTERNALENGLOBAL` holds `1000001`, `GLOBA0001R0000000001EXTERNALENCA` holds
 * `R-0000000001`), and a posting captured off its apply page knows only that requisition. Compared on letters and
 * digits; the shorter must hold a digit and four characters, and a digit at either end of it must not run on into
 * a digit of the longer (`1000001` is not in `…11000001…`).
 */
export function phenomSameJob(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (x === y) return x.length > 0;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  if (short.length < 4 || !/\d/.test(short)) return false;
  const digit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
  for (let i = long.indexOf(short); i >= 0; i = long.indexOf(short, i + 1)) {
    const before = digit(short[0]) && digit(long[i - 1]);
    const after = digit(short[short.length - 1]) && digit(long[i + short.length]);
    if (!before && !after) return true;
  }
  return false;
}

/**
 * Its registry entry (`SITES` in `../registry.ts`). On the employer's own careers domain, like an Oracle career
 * site.
 */
export const phenomInfo = {
  id: "phenom" as const,
  name: "Phenom",
  // Its apply flow's containers, the `data-ph-at-id` hooks on every page of a Phenom site, and its CDN.
  signature:
    ".phenom-form-container, .ph-apply-box, [data-ph-at-id], script[src*='phenompeople.com'], link[href*='phenompeople.com']",
  isUrl: isPhenomUrl,
  tenant: phenomTenant,
  job: phenomJob,
  sameJob: phenomSameJob,
  canonicalPath: phenomCanonicalPath,
  // `jobseqno` is all that names the job in its apply page's URL.
  jobParams: ["jobseqno"],
  // Its Next saves the step to the employer's system before the next one shows: 5 to 15 s live.
  waits: { ...STANDARD_WAITS, stepMs: 30_000 },
} satisfies SiteInfo;
