/**
 * SAP SuccessFactors Recruiting's career site: one host per data centre (`career17.sapsf.com`, `career2.successfactors.eu`
 * …) serving every employer there, the employer named by `company`. The application is
 * `…/career?company=<company>&career_job_req_id=<requisition>&career_ns=job_application`, or the older
 * `…/sfcareer/jobreqcareer?jobId=<requisition>&company=<company>`. Once a candidate is signed in, the page can also be
 * `…/portalcareer?_s.crb=<session token>`, naming neither: the extension knows it by its body (the registry's
 * `signature`) and the adapter reads the job from the page. The employer's own careers site in front of it (Recruiting
 * Marketing, on the employer's domain) is another product with other markup, and isn't this site. No imports (the
 * adapter bundle imports it).
 */

/** The career hosts: `career`, then the data centre's number, on SAP's or SuccessFactors' domains. */
const HOST = /^career\d*\.(?:sapsf\.(?:com|eu|cn)|successfactors\.(?:com|eu))$/i;

/** The career site's pages: the application, the job listing and the signed-in portal. */
const PATH = /^\/(?:career|careers|portalcareer|sfcareer)(?:\/|$)/i;

function careerUrl(url: string): URL | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOST.test(u.hostname) && PATH.test(u.pathname) ? u : undefined;
  } catch {
    return undefined;
  }
}

export function isSuccessFactorsUrl(url: string): boolean {
  return careerUrl(url) !== undefined;
}

/** The employer: `company`, lowercased. A signed-in page's URL (`portalcareer?_s.crb=…`) has none. */
export function successFactorsTenant(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("company")?.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** The job: its requisition id (`career_job_req_id`, or `jobId` on the older pages). */
export function successFactorsJob(url: string): string | undefined {
  try {
    const params = new URL(url).searchParams;
    const job = (params.get("career_job_req_id") ?? params.get("jobId"))?.trim().toLowerCase();
    return job || undefined;
  } catch {
    return undefined;
  }
}
