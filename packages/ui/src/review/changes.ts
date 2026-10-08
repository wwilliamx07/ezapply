import { describeHunk, diffWords, type TextChange, tokenizePages } from "@ezapply/protocol/textdiff";

/** A stretch of a page's text (`LoadedPage.text`), 0-based page. */
export interface TextSpan {
  page: number;
  start: number;
  end: number;
}

/** One change since the last review, and where to mark it on the new version. */
export interface ChangeMark {
  id: string;
  change: TextChange;
  /** The words put in, per page they fall on. */
  added: TextSpan[];
  /** For a removal with nothing put in its place: where the removed words were (before or after a character). */
  removedAt?: { page: number; offset: number; after: boolean };
}

/**
 * What changed between the version last reviewed (its page texts, as the companion stored them) and the one
 * shown (its page texts as the viewer read them). Both sides are tokenised by the same code as the companion's
 * `pdf_text { sinceReviewed }`, so the page and the agent see the same changes.
 */
export function changesSince(previous: readonly string[], current: readonly string[]): ChangeMark[] {
  const a = tokenizePages(previous);
  const b = tokenizePages(current);
  const hunks = diffWords(
    a.map((t) => t.text),
    b.map((t) => t.text),
  );
  return hunks.map((h, i) => {
    const added: TextSpan[] = [];
    for (const t of b.slice(h.newStart, h.newEnd)) {
      const last = added.at(-1);
      if (last && last.page === t.page) last.end = t.end;
      else added.push({ page: t.page, start: t.start, end: t.end });
    }
    const next = b[h.newStart];
    const prev = b[h.newStart - 1];
    const removedAt =
      h.newStart === h.newEnd
        ? next
          ? { page: next.page, offset: next.start, after: false }
          : prev
            ? { page: prev.page, offset: prev.end, after: true }
            : undefined
        : undefined;
    return { id: `c${i}`, change: describeHunk(h, a, b), added, ...(removedAt ? { removedAt } : {}) };
  });
}
