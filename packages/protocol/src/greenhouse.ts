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
