import { type PostingApplication, type PostingMeta, SITES, sameJob, siteOfUrl } from "@ezapply/protocol";

/**
 * Which application a posting is tied to, found from what was captured. Everything a URL says comes from the
 * site registry (`isUrl`, `tenant`, `job`, `hostPageJob`), so a new site is covered by its registry entry alone.
 *
 * Why: the form tools credit a tab to the active posting by comparing tenants and jobs, and most postings are
 * captured off the form sites (a school's job board, the employer's own careers page) with neither. Their
 * captured page usually links to the application (careers.cyberdyne.example links to
 * `cyberdyne.wd5.myworkdayjobs.com/…_Req100012/apply`), or names an embedded board's job in its URL
 * (`?gh_jid=`), and that settles it.
 */

/** The application the posting's own URL (or the frame it was captured from) is, when that's a form site's page. */
export function applicationFromUrl(meta: Pick<PostingMeta, "url" | "frameUrl" | "capturedAt">) {
  for (const url of [meta.frameUrl, meta.url]) {
    if (!url) continue;
    const site = siteOfUrl(url);
    if (!site) continue;
    const tenant = site.tenant(url);
    const job = site.job(url);
    return app(url, site.id, tenant, job, "posting-url", meta.capturedAt);
  }
  return undefined;
}

/**
 * The application a captured page leads to, for a posting not on a form site:
 * - its links: those on a form site whose URL names a job. One job → it. Several → the one matching `reqId`
 *   (a careers page often lists other jobs), else none. Links without a job (a sign-in page) never count;
 * - else a job its URL names for an embedded board (`hostPageJob`: Greenhouse's `gh_jid`).
 */
export function findApplication(input: {
  html: string;
  url: string;
  frameUrl?: string;
  reqId?: string;
  at: string;
}): PostingApplication | undefined {
  const found = new Map<string, PostingApplication>();
  for (const href of links(input.html, input.frameUrl ?? input.url)) {
    const site = siteOfUrl(href);
    const job = site?.job(href);
    if (!site || !job) continue;
    const tenant = site.tenant(href);
    const key = `${site.id}|${tenant ?? ""}|${job}`;
    if (!found.has(key)) found.set(key, app(href, site.id, tenant, job, "apply-link", input.at));
  }
  const all = [...found.values()];
  if (all.length === 1) return all[0];
  const req = input.reqId?.trim().toLowerCase();
  if (all.length > 1 && req) {
    const matching = all.filter((a) => a.job && sameJob(a.job, req));
    if (matching.length === 1) return matching[0];
  }
  if (all.length > 0) return undefined;
  for (const url of [input.url, input.frameUrl]) {
    if (!url) continue;
    for (const site of SITES) {
      const job = site.hostPageJob?.(url);
      if (job) return app(url, site.id, undefined, job, "host-page-job", input.at);
    }
  }
  return undefined;
}

/** Every `href` in the HTML, absolute, entities in the URL decoded. */
function links(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
    try {
      out.push(new URL(raw, base).href);
    } catch {
      // Not a URL: skip it.
    }
  }
  return out;
}

function app(
  url: string,
  site: string,
  tenant: string | undefined,
  job: string | undefined,
  from: PostingApplication["from"],
  at: string,
): PostingApplication {
  return { url, site, ...(tenant ? { tenant } : {}), ...(job ? { job } : {}), from, at };
}

/**
 * A requisition as given, trimmed, or why it isn't one. A job title in `reqId` (seen: "Evergreen - Software
 * Engineer, Intern, 2027, CAN") would be compared with application URLs' job ids and never match them.
 */
export function checkReqId(reqId: string): { ok: true; value: string } | { ok: false; reason: string } {
  const value = reqId.trim();
  if (value.split(/\s+/).length > 3) {
    return {
      ok: false,
      reason: `"${value}" looks like a title, not a requisition id.`,
    };
  }
  return { ok: true, value };
}
