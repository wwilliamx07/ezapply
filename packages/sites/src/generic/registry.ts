/**
 * An application form on an employer's own page: plain HTML, posted to the employer's server, of no site in the
 * registry. Not a registered site: it has no signature and no URL rule, since almost any page has a form, so nothing
 * detects it; the extension uses it only when a form call names a tab no registry site claims. No zod (the adapter
 * bundle imports it).
 */
import type { SiteInfo } from "@ezapply/protocol/sites";
import { STANDARD_WAITS } from "@ezapply/protocol/timing";

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Its entry (`GENERIC` in `../registry.ts`): the tenant is the page's host; the job, a registry site's job the page's
 * URL names (`hostPageJob`: a careers page with a board's job parameter), which `../registry.ts` passes in.
 */
export function genericEntry(job: (url: string) => string | undefined): SiteInfo<"generic"> {
  return {
    id: "generic",
    name: "Employer's own form",
    signature: "",
    isUrl: () => false,
    tenant: host,
    job,
    waits: { ...STANDARD_WAITS },
  };
}
