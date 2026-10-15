/**
 * What a site is, as both the companion and the extension use it: the shape of a registry entry. The sites
 * themselves, their list and everything that asks it (detecting a URL's site, its tenant, its job) are in
 * `@ezapply/sites`; the protocol knows no site. No zod: the adapters import it (`@ezapply/protocol/sites`).
 */
import type { Timing } from "./timing.js";

/**
 * The extension's host permissions, granted at install: every site. Some sites run on employers' own domains, so no
 * list of hosts covers them, and the extension tells a site by its pages' bodies (`signature`), which it can read
 * only where it has access. Asked for one origin at a time, the tab of an unknown host stays unreadable until a form
 * call knows its site, which it could then only guess from the URL.
 */
export const HOST_PERMISSIONS = ["<all_urls>"] as const;

export interface SiteInfo<Id extends string = string> {
  id: Id;
  /** As the user knows it: "Workday", "Oracle Recruiting Cloud". */
  name: string;
  /**
   * What the site's own pages render, as a CSS selector list: the page (or frame) is this site's when its document
   * matches any of it. How the extension tells a site, before the URL: the site's provider renders it on every page
   * of the site, on whatever host. Each part must be the provider's own markup (its widgets' attributes, its class
   * names, its script host), never a link to it, which an employer's careers page has too. Checked against the
   * saved pages of every site (`sites/test/conformance.test.ts`).
   */
  signature: string;
  /** A posting or application page of this site, by its URL alone: where no page can be read (a captured page's
   * links, a tab the extension can't read). */
  isUrl(url: string): boolean;
  /**
   * The employer's space on the site, lowercased: a Workday tenant, an Oracle career site (`host/site`). Called on
   * a URL of this site's (by `isUrl`, or a tab the extension found the site's by its body).
   */
  tenant(url: string): string | undefined;
  /** The job a URL of this site's is for, lowercased: a Workday requisition, an Oracle job id. */
  job(url: string): string | undefined;
  /**
   * The job of this site's that a page on another host names in its URL: a company's careers page embedding the
   * site's board (Greenhouse's `?gh_jid=`). Lets a posting captured there be tied to its application.
   */
  hostPageJob?(url: string): string | undefined;
  /**
   * Whether two of this site's job ids name one job, where its ids differ by page beyond Workday's posting suffix
   * (Phenom's `jobSeqNo` embeds the requisition the posting shows). Used through `sameJob` with the site.
   */
  sameJob?(a: string, b: string): boolean;
  /** A posting's identifying path, when the site varies it for the same job (a locale segment). */
  canonicalPath?(pathname: string): string;
  /**
   * Query parameters, lowercased, that name a job on this site's pages or on pages embedding it (Greenhouse's
   * `gh_jid`): a posting's canonical URL keeps them, where it drops every other parameter.
   */
  jobParams?: readonly string[];
  /**
   * Hosts that serve this site for every employer, so they name the provider, not the employer: a job board's
   * (`jobs.lever.co`) or a data centre's (`career17.sapsf.com`). A posting's company never comes from such a host's
   * name, and a page that frames one embeds a job board.
   */
  providerHosts?: RegExp;
  /** The employer a URL on one of its `providerHosts` names (a Workday tenant, a board's first segment), if any. */
  company?(url: string): string | undefined;
  /** The site's waits: how long its adapter waits for each thing (see timing.ts). */
  waits: Timing;
}
