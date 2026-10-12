import type { PageLines, TextLine, TextSpan } from "./toolkit.js";

/**
 * Layout checks on a compiled document, from where its text sits (pdfLines). They stand in for looking at a
 * rendered page: tailoring changes only the text inside a template the user already approved, so what can go
 * wrong there is mechanical (a word left alone on a line, a date out of line, space left over, text off the
 * page), and an image of the page costs more context than the findings, on every later turn. Overfull and
 * underfull lines come from the TeX log (diagnostics), not from here.
 */
export interface LayoutIssue {
  kind: "short-line" | "ragged-right" | "underfilled" | "off-page";
  page: number;
  /** The text concerned (shortened). */
  text: string;
  message: string;
}

const MAX_ISSUES = 8;
/** A bullet glyph or list marker at the start of a line: a new item, not a wrapped line. */
const MARKER = /^[•◦▪▫■□●○▸►‣∙·–—*-]/u;

export function lintLayout(pages: PageLines[], opts: { pageLimit?: number } = {}): LayoutIssue[] {
  const all = pages.flatMap((p) => p.lines.filter((l) => onPage(l, p)));
  if (all.length === 0) return [];
  const frame = { left: Math.min(...all.map((l) => l.x0)), right: Math.max(...all.map((l) => l.x1)) };
  const width = frame.right - frame.left;
  if (width <= 0) return [];
  const issues = [
    ...pages.flatMap((p) => offPage(p)),
    ...pages.flatMap((p) => shortLines(p, frame.left, width)),
    ...raggedRight(pages, frame.left, width),
    ...underfilled(pages, opts.pageLimit),
  ];
  return issues.slice(0, MAX_ISSUES);
}

function onPage(l: TextLine, p: PageLines): boolean {
  return l.x0 >= -1 && l.x1 <= p.width + 1 && l.y >= 0 && l.y <= p.height;
}

function offPage(p: PageLines): LayoutIssue[] {
  return p.lines
    .filter((l) => !onPage(l, p))
    .map((l) => ({
      kind: "off-page",
      page: p.page,
      text: short(l.text),
      message: "This line runs off the page.",
    }));
}

/**
 * The last line of a wrapped bullet or paragraph holding one or two words (and under a fifth of the text width).
 * Three or four words on a last line are common in a full resume, and chasing them costs a compile each.
 * A wrapped line follows a nearly full line closely, in the same size, without a list marker, and the line
 * before it doesn't end a sentence.
 */
function shortLines(p: PageLines, left: number, width: number): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  for (let i = 1; i < p.lines.length; i++) {
    const a = p.lines[i - 1] as TextLine;
    const b = p.lines[i] as TextLine;
    const wraps =
      a.spans.length === 1 &&
      b.spans.length === 1 &&
      Math.abs(a.size - b.size) <= 0.5 &&
      a.y - b.y > 0 &&
      a.y - b.y <= 1.45 * a.size &&
      a.x1 >= left + 0.8 * width &&
      !/[.:!?]["”')\]]?$/.test(a.text) &&
      !MARKER.test(b.text) &&
      b.x0 <= a.x0 + 3 * a.size;
    if (!wraps || b.text.split(/\s+/).length > 2 || b.x1 - b.x0 > 0.2 * width) continue;
    out.push({
      kind: "short-line",
      page: p.page,
      text: short(b.text),
      message: `"${short(b.text)}" sits alone on the last line of "…${a.text.slice(-40)}": cut a few words so it fits on the line above, or say enough more to fill the line.`,
    });
  }
  return out;
}

/**
 * Right-aligned entries (dates, places: the text after an \hfill near the right edge) that don't end where the
 * others do.
 */
function raggedRight(pages: PageLines[], left: number, width: number): LayoutIssue[] {
  const ends = pages.flatMap((p) =>
    p.lines
      .filter((l) => l.spans.length >= 2)
      .map((l) => ({ page: p.page, span: l.spans[l.spans.length - 1] as TextSpan }))
      .filter((e) => e.span.x1 >= left + 0.75 * width),
  );
  if (ends.length < 2) return [];
  const counts = new Map<number, number>();
  for (const e of ends) {
    const key = Math.round(e.span.x1 * 2) / 2;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // The edge most of them share; on a tie, the rightmost.
  const [edge] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] as [number, number];
  return ends
    .filter((e) => Math.abs(e.span.x1 - edge) > 1.5)
    .map((e) => ({
      kind: "ragged-right",
      page: e.page,
      text: short(e.span.text),
      message: `"${short(e.span.text)}" ends ${Math.abs(e.span.x1 - edge).toFixed(1)}pt ${e.span.x1 < edge ? "short of" : "past"} the right edge the other right-aligned entries share.`,
    }));
}

/**
 * At the page limit, free space at the bottom of the last page: with margins taken as equal top and bottom,
 * three or more empty lines' worth is room for more of the strongest content.
 */
function underfilled(pages: PageLines[], pageLimit: number | undefined): LayoutIssue[] {
  const last = pages[pages.length - 1];
  if (!last || pageLimit === undefined || pages.length !== pageLimit || last.lines.length < 2) return [];
  const top = Math.max(...last.lines.map((l) => l.y + l.size));
  const lowest = last.lines.reduce((lo, l) => (l.y < lo.y ? l : lo));
  const free = lowest.y - 0.25 * lowest.size - (last.height - top);
  const gaps = last.lines
    .slice(1)
    .map((l, i) => (last.lines[i] as TextLine).y - l.y)
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  const lineHeight = gaps[Math.floor(gaps.length / 2)] ?? 1.2 * lowest.size;
  const lines = Math.floor(free / lineHeight);
  if (lines < 3) return [];
  return [
    {
      kind: "underfilled",
      page: last.page,
      text: short(lowest.text),
      message: `About ${lines} lines are free at the bottom of page ${last.page}: room for more of the strongest content.`,
    },
  ];
}

function short(text: string): string {
  const t = text.trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}
