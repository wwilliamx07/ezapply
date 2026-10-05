/**
 * The site registry: every job site whose application forms ezapply reads and fills, with what both the companion
 * and the extension need to know about it. Adding a site means adding an entry here (and its definition in the
 * extension's `adapters/sites/`); detection, tenants, jobs, the extension's build and its adapter bundles all come
 * from this list. No zod: the adapters import it (`@ezapply/protocol/sites`).
 */
import { ashbyCanonicalPath, ashbyJob, ashbyTenant, isAshbyUrl } from "./ashby.js";
import { greenhouseHostPageJob, greenhouseJob, greenhouseTenant, isGreenhouseUrl } from "./greenhouse.js";
import { isLeverUrl, leverCanonicalPath, leverJob, leverTenant } from "./lever.js";
import { isOracleUrl, oracleJob, oracleJobPath, oracleTenant } from "./oracle.js";
import { isPhenomUrl, phenomCanonicalPath, phenomJob, phenomTenant } from "./phenom.js";
import { STANDARD_WAITS, type Timing } from "./timing.js";
import { isWorkdayUrl, workdayCanonicalPath, workdayJob, workdayTenant } from "./workday.js";

export type FormSiteId = "workday" | "oracle" | "greenhouse" | "lever" | "ashby" | "phenom";

/**
 * The extension's host permissions, granted at install: every site. Phenom and Oracle run on employers' own domains,
 * so no list of hosts covers them, and the extension tells a site by its pages' bodies (`signature`), which it can
 * read only where it has access. Asked for one origin at a time, the tab of an unknown host stays unreadable until a
 * form call knows its site, which it could then only guess from the URL.
 */
export const HOST_PERMISSIONS = ["<all_urls>"] as const;

export interface SiteInfo {
  id: FormSiteId;
  /** As the user knows it: "Workday", "Oracle Recruiting Cloud". */
  name: string;
  /**
   * What the site's own pages render, as a CSS selector list: the page (or frame) is this site's when its document
   * matches any of it. How the extension tells a site, before the URL: the site's provider renders it on every page
   * of the site, on whatever host. Each part must be the provider's own markup (its widgets' attributes, its class
   * names, its script host), never a link to it, which an employer's careers page has too. Checked against the
   * fixtures of every site (`extension/test/sites.test.ts`).
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
  /** A posting's identifying path, when the site varies it for the same job (a locale segment). */
  canonicalPath?(pathname: string): string;
  /** The site's waits: how long its adapter waits for each thing (see timing.ts). */
  waits: Timing;
}

export const SITES: readonly SiteInfo[] = [
  {
    id: "workday",
    name: "Workday",
    // Workday's UI widgets, and the page chrome every candidate page has (its skip link, its utility bar).
    signature:
      "[data-uxi-widget-type], [data-automation-id='utilityButtonBar'], [data-automation-id='accessibilitySkipToMainContent']",
    isUrl: isWorkdayUrl,
    tenant: workdayTenant,
    job: workdayJob,
    canonicalPath: workdayCanonicalPath,
    // The standard waits were measured on Workday.
    waits: { ...STANDARD_WAITS },
  },
  {
    id: "oracle",
    name: "Oracle Recruiting Cloud",
    // The Candidate Experience's own components (its apply flow, its dialogs) and its scripts' path.
    signature:
      "apply-flow, apply-flow-block, apply-flow-header, .app-dialog__wrapper.oj-dialog-body, script[src*='/hcmUI/CandidateExperience/']",
    isUrl: isOracleUrl,
    tenant: oracleTenant,
    job: oracleJob,
    canonicalPath: oracleJobPath,
    waits: { ...STANDARD_WAITS },
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    // Its job board's posting and application markup (not its embed script, which a careers page around the board
    // loads too).
    signature: ".job-post-container, form#application-form .application--questions",
    isUrl: isGreenhouseUrl,
    tenant: greenhouseTenant,
    job: greenhouseJob,
    hostPageJob: greenhouseHostPageJob,
    waits: { ...STANDARD_WAITS },
  },
  {
    id: "lever",
    name: "Lever",
    signature: ".posting-categories .posting-category, form#application-form .application-question, a.postings-btn",
    isUrl: isLeverUrl,
    tenant: leverTenant,
    job: leverJob,
    canonicalPath: leverCanonicalPath,
    waits: { ...STANDARD_WAITS },
  },
  {
    id: "ashby",
    name: "Ashby",
    signature: "[class*='ashby-application-form'], [class*='ashby-job-posting']",
    isUrl: isAshbyUrl,
    tenant: ashbyTenant,
    job: ashbyJob,
    canonicalPath: ashbyCanonicalPath,
    waits: { ...STANDARD_WAITS },
  },
  // On the employer's own careers domain, like an Oracle career site.
  {
    id: "phenom",
    name: "Phenom",
    // Its apply flow's containers, the `data-ph-at-id` hooks on every page of a Phenom site, and its CDN.
    signature:
      ".phenom-form-container, .ph-apply-box, [data-ph-at-id], script[src*='phenompeople.com'], link[href*='phenompeople.com']",
    isUrl: isPhenomUrl,
    tenant: phenomTenant,
    job: phenomJob,
    canonicalPath: phenomCanonicalPath,
    // Its Next saves the step to the employer's system before the next one shows: 5 to 15 s live.
    waits: { ...STANDARD_WAITS, stepMs: 30_000 },
  },
];

/** Every form site's id, in registry order. */
export const FORM_SITE_IDS: readonly FormSiteId[] = SITES.map((s) => s.id);

export function siteInfo(id: string): SiteInfo | undefined {
  return SITES.find((s) => s.id === id);
}

/** The registered site a URL belongs to, if any. */
export function siteOfUrl(url: string): SiteInfo | undefined {
  return SITES.find((s) => s.isUrl(url));
}

/** Every site's signature, in registry order (the first a page matches is its site): what the extension checks. */
export function siteSignatures(): [FormSiteId, string][] {
  return SITES.map((s) => [s.id, s.signature]);
}
