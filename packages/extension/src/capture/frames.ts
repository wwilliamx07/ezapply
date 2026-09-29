import type { PageCapture } from "./capture.js";

/**
 * Job boards that company career pages embed in an iframe. A capture of the host page alone would hold the
 * company's page chrome and no job description.
 */
export const EMBEDDED_BOARD_HOST =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|icims\.com|myworkdayjobs\.com|myworkdaysite\.com|oraclecloud\.com|smartrecruiters\.com|jobvite\.com|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com|personio\.(de|com))$/i;

export interface FrameCapture {
  frameId: number;
  page: PageCapture;
}

const hasJobPosting = (p: PageCapture) => p.jsonLd.some((block) => /"JobPosting"/.test(block));

/**
 * The frame that holds the posting: the top frame, unless it has no JobPosting data and a child frame does,
 * or a child frame shows more text (the host page being mostly navigation around an embedded board).
 */
export function chooseFrame(frames: FrameCapture[]): FrameCapture | undefined {
  const top = frames.find((f) => f.frameId === 0) ?? frames[0];
  if (!top || hasJobPosting(top.page)) return top;
  const children = frames.filter((f) => f !== top && f.page.visibleText.trim().length >= 300);
  const size = (f: FrameCapture) => f.page.visibleText.trim().length;
  const bySize = (x: FrameCapture, y: FrameCapture) => size(y) - size(x);
  const withLd = children.filter((f) => hasJobPosting(f.page)).sort(bySize)[0];
  if (withLd) return withLd;
  const biggest = [...children].sort(bySize)[0];
  return biggest && size(biggest) > size(top) ? biggest : top;
}

/**
 * A large embedded job board the extension couldn't read (a cross-origin frame outside its permissions),
 * when the chosen frame has no JobPosting data of its own: capturing would store the wrong page.
 */
export function unreadableBoard(chosen: FrameCapture, frames: FrameCapture[]): string | undefined {
  if (hasJobPosting(chosen.page)) return undefined;
  const read = new Set(frames.map((f) => f.page.url));
  return chosen.page.frames.find((f) => {
    let host = "";
    try {
      host = new URL(f.src).hostname;
    } catch {
      return false;
    }
    return EMBEDDED_BOARD_HOST.test(host) && f.height >= 300 && f.width >= 300 && !read.has(f.src);
  })?.src;
}
