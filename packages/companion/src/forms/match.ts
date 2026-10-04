import { type PostingApplication, type PostingMeta, sameJob, siteOfUrl } from "@ezapply/protocol";

/**
 * Which posting an application tab belongs to. Everything here works on facts, never on site names: what a URL
 * says (site, tenant, job) comes from the site registry, and what a page says (`FormSchema.job`) from the
 * site's definition, so a new site is matched by its registry entry and, where its pages show it, its title.
 *
 * The evidence, strongest first:
 * - `site`: the posting's application is on another site than the tab;
 * - `job`: the tab's URL names a job, and so does the posting (its application's, else its URL's, else `reqId`);
 * - `binding`: the tab was bound to a posting by an earlier call that changed its page (or by the user);
 * - `page-reqid`: the requisition the page shows, against the posting's job;
 * - `tenant`: the employer's space on the site, as before;
 * - `title`: the job title the page shows, against the posting's role, only where no job id is known.
 * With none of it, the tab is `unconfirmed`: credited, and bound by the first call that changes it.
 */

export type Evidence = "site" | "job" | "binding" | "page-reqid" | "tenant" | "title";

export interface PostingMatch {
  verdict: "same" | "other" | "unconfirmed";
  /** What decided it: the one piece of evidence, or none for `unconfirmed`. */
  by: Evidence[];
}

/** What's known of the posting's job. */
export interface PostingFacts {
  id: string;
  site?: string;
  tenant?: string;
  job?: string;
  role?: string;
}

/** What's known of the tab: its URL, and what its page says when it was read. */
export interface TabFacts {
  url: string;
  title?: string;
  reqId?: string;
}

/** A tab bound to a posting, with the tenant it was on then (a tab that moved to another employer is free). */
export interface Binding {
  postingId: string;
  tenant?: string;
  byUser?: boolean;
}

export function postingFacts(meta: PostingMeta, application: PostingApplication | undefined): PostingFacts {
  const own = siteOfUrl(meta.url);
  const req = meta.reqId?.trim().toLowerCase();
  // A requisition counts as a job id only when it looks like one (a title in reqId compares with nothing).
  const reqJob = req && !/\s/.test(req) ? req : undefined;
  const site = application?.site ?? own?.id;
  const tenant = application?.tenant ?? own?.tenant(meta.url) ?? meta.tenant;
  const job = application?.job ?? own?.job(meta.url) ?? reqJob;
  return {
    id: meta.id,
    ...(site ? { site } : {}),
    ...(tenant ? { tenant } : {}),
    ...(job ? { job } : {}),
    ...(meta.role ? { role: meta.role } : {}),
  };
}

export function tabSite(url: string): { site?: string; tenant?: string; job?: string } {
  const site = siteOfUrl(url);
  if (!site) return {};
  const tenant = site.tenant(url);
  const job = site.job(url);
  return { site: site.id, ...(tenant ? { tenant } : {}), ...(job ? { job } : {}) };
}

export function matchPosting(p: PostingFacts, tab: TabFacts, binding?: Binding): PostingMatch {
  const t = tabSite(tab.url);
  const same = (by: Evidence): PostingMatch => ({ verdict: "same", by: [by] });
  const other = (by: Evidence): PostingMatch => ({ verdict: "other", by: [by] });

  if (p.site && t.site && p.site !== t.site && (p.tenant || p.job)) return other("site");
  if (p.job && t.job) return sameJob(p.job, t.job) ? same("job") : other("job");
  // A binding holds while the tab stays on the employer it was bound on.
  if (binding && (!binding.tenant || !t.tenant || binding.tenant === t.tenant)) {
    return binding.postingId === p.id ? same("binding") : other("binding");
  }
  const pageReq = tab.reqId?.trim().toLowerCase();
  if (p.job && pageReq) return sameJob(p.job, pageReq) ? same("page-reqid") : other("page-reqid");
  if (p.tenant && t.tenant) return p.tenant === t.tenant ? same("tenant") : other("tenant");
  if (!p.job && p.role && tab.title) {
    const titles = compareTitles(p.role, tab.title);
    if (titles !== "unsure") return titles === "same" ? same("title") : other("title");
  }
  return { verdict: "unconfirmed", by: [] };
}

/** Words that say nothing about which job it is. */
const FILLER = new Set(["and", "the", "for", "with", "of", "in", "at", "to", "a", "an", "or", "on", "job", "position"]);

/** Significant words of a title: lowercased, split on anything but letters and digits, fillers dropped. */
function words(title: string): Set<string> {
  return new Set(
    title
      .normalize("NFKD")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !FILLER.has(w)),
  );
}

/**
 * Two titles of one job, as a posting and its application page word them: `same` when one's significant words are
 * all in the other ("Intern, Software Developer" and "Software Developer Intern"); `other`
 * when they share none; else `unsure`, left to the binding.
 */
export function compareTitles(a: string, b: string): "same" | "other" | "unsure" {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return "unsure";
  const shared = [...x].filter((w) => y.has(w)).length;
  if (shared === 0) return "other";
  return shared === Math.min(x.size, y.size) ? "same" : "unsure";
}
