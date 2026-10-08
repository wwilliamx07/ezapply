import type { PageRect } from "@ezapply/protocol";

/** Join rects on the same line that touch, so a selection is a few boxes, not one per span. */
export function mergeRects(rects: PageRect[]): PageRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: PageRect[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    const sameLine = last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5;
    if (last && sameLine && r.x <= last.x + last.w + 0.01) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.y = Math.min(last.y, r.y);
      last.w = right - last.x;
      last.h = bottom - last.y;
    } else out.push({ ...r });
  }
  return out.map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }));
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

const WORD = /[\p{L}\p{N}]/u;

/** A selection that starts or ends inside a word takes the whole word: the agent should get "building", not "uilding". */
export function expandToWords(range: Range): void {
  const start = range.startContainer;
  if (start.nodeType === Node.TEXT_NODE) {
    const t = start.textContent ?? "";
    let o = range.startOffset;
    if (WORD.test(t[o] ?? "")) while (o > 0 && WORD.test(t[o - 1] ?? "")) o--;
    range.setStart(start, o);
  }
  const end = range.endContainer;
  if (end.nodeType === Node.TEXT_NODE) {
    const t = end.textContent ?? "";
    let o = range.endOffset;
    if (WORD.test(t[o - 1] ?? "")) while (o < t.length && WORD.test(t[o] ?? "")) o++;
    range.setEnd(end, o);
  }
}
