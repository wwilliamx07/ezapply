/**
 * The site registry: every job site whose application forms ezapply reads and fills, in detection order, with what
 * both the companion and the extension need to know about it. Each site's entry is in its own directory
 * (`<site>/registry.ts`); adding a site means adding its directory and its entry here. Detection, tenants, jobs, the
 * extension's build and its adapter bundles all come from this list. No zod: the adapters import it.
 */
import type { SiteInfo } from "@ezapply/protocol/sites";
import { ashbyInfo } from "./ashby/registry.js";
import { dayforceInfo } from "./dayforce/registry.js";
import { genericEntry } from "./generic/registry.js";
import { greenhouseInfo } from "./greenhouse/registry.js";
import { leverInfo } from "./lever/registry.js";
import { oracleInfo } from "./oracle/registry.js";
import { phenomInfo } from "./phenom/registry.js";
import { successfactorsInfo } from "./successfactors/registry.js";
import { workdayInfo } from "./workday/registry.js";

const ENTRIES = [
  workdayInfo,
  oracleInfo,
  greenhouseInfo,
  leverInfo,
  ashbyInfo,
  phenomInfo,
  dayforceInfo,
  successfactorsInfo,
] as const;

/** A registered site's id. */
export type FormSiteId = (typeof ENTRIES)[number]["id"];

export const SITES: readonly SiteInfo<FormSiteId>[] = ENTRIES;

/**
 * The definition for an application on an employer's own page (`generic/`): not in `SITES`, so nothing detects it
 * and no list of sites names it. The extension uses it only when a form call names a tab no registry site claims.
 */
export const GENERIC: SiteInfo<"generic"> = genericEntry((url) => {
  for (const s of SITES) {
    const job = s.hostPageJob?.(url);
    if (job) return job;
  }
  return undefined;
});

/** Every form site's id, in registry order. */
export const FORM_SITE_IDS: readonly FormSiteId[] = SITES.map((s) => s.id);

export function siteInfo(id: string): SiteInfo<FormSiteId> | undefined {
  return SITES.find((s) => s.id === id);
}

/** The registered site a URL belongs to, if any. */
export function siteOfUrl(url: string): SiteInfo<FormSiteId> | undefined {
  return SITES.find((s) => s.isUrl(url));
}

/** The site whose provider serves a host for every employer (`SiteInfo.providerHosts`), if any. */
export function providerOf(host: string): SiteInfo<FormSiteId> | undefined {
  return SITES.find((s) => s.providerHosts?.test(host));
}

/** The query parameters that name a job on some site's pages (`SiteInfo.jobParams`), lowercased. */
export const SITE_JOB_PARAMS: readonly string[] = SITES.flatMap((s) => s.jobParams ?? []);

/** Every site's signature, in registry order (the first a page matches is its site): what the extension checks. */
export function siteSignatures(): [FormSiteId, string][] {
  return SITES.map((s) => [s.id, s.signature]);
}

/** The registry's site for the URL, else generic: where only a URL is known. */
export function detectSite(url: string): FormSiteId | "generic" {
  return siteOfUrl(url)?.id ?? "generic";
}

/**
 * Whether a site id (from the wire, a stored posting) is a registered site's: one whose forms ezapply reads and fills,
 * each with its own adapter.
 */
export function isFormSite(site: string | undefined): site is FormSiteId {
  return FORM_SITE_IDS.includes(site as FormSiteId);
}

/** The tenant an application or posting URL belongs to on its site (a Workday tenant, an Oracle career site). */
export function siteTenant(url: string): string | undefined {
  return siteOfUrl(url)?.tenant(url);
}

/**
 * The job an application or posting URL is for, lowercased (a Workday requisition, an Oracle job id), as its
 * site reads it. Undefined when the URL doesn't name one. Two postings at one company share a tenant; this tells
 * their applications apart.
 */
export function siteJob(url: string): string | undefined {
  return siteOfUrl(url)?.job(url);
}

/**
 * Whether two job ids name the same job: equal, or one is the other with Workday's posting suffix (`jr1000001`
 * and `jr1000001-1`: the requisition, and its first posting), or by the site's own rule when `site` names one with
 * one (`SiteInfo.sameJob`).
 */
export function sameJob(a: string, b: string, site?: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`)) return true;
  return Boolean(site && siteInfo(site)?.sameJob?.(x, y));
}
