import type { PageRect, ReviewAnswerBody } from "@ezapply/protocol";
import { useCallback, useEffect, useState } from "react";

export interface DraftComment {
  id: string;
  /** 1-based, as sent. */
  page: number;
  quote: string;
  note: string;
  rects: PageRect[];
}

export interface DocDraft {
  request: string;
  comments: DraftComment[];
}

export type Drafts = Record<number, DocDraft>;

const EMPTY: DocDraft = { request: "", comments: [] };

/**
 * What the user has written so far, per document. Kept in the tab's session storage under the review's id, so a
 * reload (or the browser restoring the tab) doesn't lose it; storage that's unavailable only means it isn't kept.
 */
export function useDrafts(reviewId: string | null) {
  const key = reviewId ? `ezapply-review-${reviewId}` : null;
  const [drafts, setDrafts] = useState<Drafts>({});

  useEffect(() => {
    if (!key) return;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) setDrafts(JSON.parse(saved) as Drafts);
    } catch {}
  }, [key]);

  const update = useCallback(
    (index: number, change: (d: DocDraft) => DocDraft) => {
      setDrafts((all) => {
        const next = { ...all, [index]: change(all[index] ?? EMPTY) };
        try {
          if (key) sessionStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [key],
  );

  const forget = useCallback(() => {
    try {
      if (key) sessionStorage.removeItem(key);
    } catch {}
  }, [key]);

  return { drafts, draftOf: (i: number) => drafts[i] ?? EMPTY, update, forget };
}

/** Whether a document's draft asks for changes (a request or a comment); otherwise it's approved as shown. */
export function asksChanges(d: DocDraft): boolean {
  return !!d.request.trim() || d.comments.length > 0;
}

/** The answer the companion takes: each document's request and comments, by its index. */
export function answerOf(count: number, draftOf: (i: number) => DocDraft): ReviewAnswerBody {
  return {
    documents: Array.from({ length: count }, (_, index) => {
      const d = draftOf(index);
      const request = d.request.trim();
      return {
        index,
        ...(request ? { request } : {}),
        ...(d.comments.length
          ? { comments: d.comments.map(({ page, quote, note, rects }) => ({ page, quote, note, rects })) }
          : {}),
      };
    }),
  };
}
