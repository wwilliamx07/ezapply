/**
 * The site registry: every job site whose application forms ezapply reads and fills, with what both the companion
 * and the extension need to know about it. Adding a site means adding an entry here (and its definition in the
 * extension's `adapters/sites/`); detection, tenants, jobs, permissions, the extension's build and its manifest all
 * come from this list. No zod: the adapters import it (`@ezapply/protocol/sites`).
 */
import { isOracleUrl, ORACLE_OPTIONAL_HOST_PERMISSIONS, oracleJob, oracleJobPath, oracleTenant } from "./oracle.js";
import { STANDARD_WAITS, type Timing } from "./timing.js";
import { isWorkdayUrl, WORKDAY_HOST_PERMISSIONS, workdayCanonicalPath, workdayJob, workdayTenant } from "./workday.js";

export type FormSiteId = "workday" | "oracle";

/**
 * How the extension gets access to a site's pages: `fixed` hosts are in the manifest (granted at install);
 * `per-origin` sites can be on any host (employers' own domains), so each origin is granted on its own, at Set
 * posting on one of its pages or from the options page.
 */
export type SiteAccess = { kind: "fixed"; hosts: readonly string[] } | { kind: "per-origin" };

export interface SiteInfo {
  id: FormSiteId;
  /** As the user knows it: "Workday", "Oracle Recruiting Cloud". */
  name: string;
  /** A posting or application page of this site. */
  isUrl(url: string): boolean;
  /** The employer's space on the site, lowercased: a Workday tenant, an Oracle career site (`host/site`). */
  tenant(url: string): string | undefined;
  /** The job a URL is for, lowercased: a Workday requisition, an Oracle job id. */
  job(url: string): string | undefined;
  /** A posting's identifying path, when the site varies it for the same job (a locale segment). */
  canonicalPath?(pathname: string): string;
  access: SiteAccess;
  /** The site's waits: how long its adapter waits for each thing (see timing.ts). */
  waits: Timing;
}

export const SITES: readonly SiteInfo[] = [
  {
    id: "workday",
    name: "Workday",
    isUrl: isWorkdayUrl,
    tenant: workdayTenant,
    job: workdayJob,
    canonicalPath: workdayCanonicalPath,
    access: { kind: "fixed", hosts: WORKDAY_HOST_PERMISSIONS },
    // The standard waits were measured on Workday.
    waits: { ...STANDARD_WAITS },
  },
  {
    id: "oracle",
    name: "Oracle Recruiting Cloud",
    isUrl: isOracleUrl,
    tenant: oracleTenant,
    job: oracleJob,
    canonicalPath: oracleJobPath,
    access: { kind: "per-origin" },
    waits: { ...STANDARD_WAITS },
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

/** Host permissions the manifest grants at install: every fixed site's hosts. */
export function fixedHostPermissions(): string[] {
  return SITES.flatMap((s) => (s.access.kind === "fixed" ? [...s.access.hosts] : []));
}

/** Optional host permissions the manifest must declare: any https origin, when a site is granted per origin. */
export function optionalHostPermissions(): string[] {
  return SITES.some((s) => s.access.kind === "per-origin") ? [...ORACLE_OPTIONAL_HOST_PERMISSIONS] : [];
}
