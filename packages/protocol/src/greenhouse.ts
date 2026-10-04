/**
 * Greenhouse job boards: `job-boards.greenhouse.io/<board>/jobs/<id>` (and the older `boards.greenhouse.io`, the EU
 * hosts), where the posting and its application form share one page, and the embed a company's own careers page
 * loads in a frame, `…/embed/job_app?for=<board>&token=<id>`. No imports (the adapter bundle imports it).
 */
const GREENHOUSE_HOST = /^(job-)?boards(\.eu)?\.greenhouse\.io$/i;

export function isGreenhouseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && GREENHOUSE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** The board (the employer's space), lowercased: the embed's `for`, else the path's first segment. */
export function greenhouseTenant(url: string): string | undefined {
  if (!isGreenhouseUrl(url)) return undefined;
  const u = new URL(url);
  const first = u.pathname.split("/").filter(Boolean)[0];
  const board = first === "embed" ? u.searchParams.get("for") : first;
  return board ? board.toLowerCase() : undefined;
}

/** The job id: `/jobs/<id>`, or the embed's `token`. */
export function greenhouseJob(url: string): string | undefined {
  if (!isGreenhouseUrl(url)) return undefined;
  const u = new URL(url);
  return (/\/jobs\/(\d+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("token") ?? undefined)?.toLowerCase();
}

/**
 * The Greenhouse job a company's own careers page names in its URL (`careers.example.com/jobs/…?gh_jid=1000039`):
 * Greenhouse's embed script reads `gh_jid` to load that job's application, so the page is that job's whatever its
 * host. Lowercased digits; undefined on Greenhouse's own pages, whose path names the job.
 */
export function greenhouseHostPageJob(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (isGreenhouseUrl(url)) return undefined;
  const id = u.searchParams.get("gh_jid")?.trim();
  return id && /^\d+$/.test(id) ? id : undefined;
}
