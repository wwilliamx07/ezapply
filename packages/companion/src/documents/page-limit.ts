/**
 * The page limit a document's name implies: a resume's is `resume.pageLimit`, and a cover letter is one page.
 * The letter's limit is what lets the compile and the review measure its free space: without one, nothing did,
 * and letters came back well short of the page.
 */
export function pageLimitOf(name: string, resumeLimit: number): number | undefined {
  if (/resume|cv/i.test(name)) return resumeLimit;
  if (/cover|letter/i.test(name)) return 1;
  return undefined;
}

/** Free lines at the bottom of the last page from which a document counts as underfilled (lint and review). */
export const UNDERFILLED_LINES = 3;
