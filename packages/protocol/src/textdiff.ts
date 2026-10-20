/**
 * What changed between two versions of a document, word by word, from the text pdf.js reads off its pages. Used by
 * the companion (`pdf_text { sinceReviewed }`, the review page's state) and by the review page, which marks the
 * changes on the PDF. No imports and no DOM, so both can bundle it (`@ezapply/protocol/textdiff`).
 *
 * Why words on collapsed text, not lines: a word changed early in a paragraph reflows every line after it, and a
 * line diff would mark all of them. Why the PDF's text, not the LaTeX source: it's what the user approves, and a
 * bundle or an imported template has no source of ours.
 */

/** A word of a page's text: its normalised form, and where it sits in the text it came from. */
interface Token {
  text: string;
  /** Offsets into the page text, end exclusive. A word broken by a hyphen at a line's end spans both parts. */
  start: number;
  end: number;
}

/** A word of a document, with its page (0-based). */
interface DocToken extends Token {
  page: number;
}

/** One place where the versions differ: words removed from the old one, words put in the new one, or both. */
interface Hunk {
  /** Indexes into the old and new documents' tokens, end exclusive. */
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/** A hunk as text, for the agent and for the page's list of changes. */
export interface TextChange {
  /** 1-based page of the new version where it is (for a pure removal, the page of the word that follows it). */
  page: number;
  removed?: string;
  added?: string;
  /** Up to five words of the new version before the change, on its page, to find it by. */
  before: string;
}

const QUOTES_SINGLE = /[‘’‚‛′]/g;
const QUOTES_DOUBLE = /[“”„‟″]/g;
const DASHES = /[‐‑‒–—―−]/g;
const INVISIBLE = /[­​-‍⁠﻿]/g;

/** One word as compared: ligatures unfolded (NFKC: "ﬁ" → "fi"), quotes and dashes unified, soft hyphens dropped. */
export function normalizeWord(s: string): string {
  return s
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(QUOTES_SINGLE, "'")
    .replace(QUOTES_DOUBLE, '"')
    .replace(DASHES, "-");
}

/**
 * The words of a page's text. Whitespace and line breaks separate words and are otherwise ignored, so reflowed
 * text gives the same words. A word ending in a hyphen at a line's end, followed by a word starting in lower case,
 * is one word broken by hyphenation ("experi-\nence" → "experience").
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let pendingJoin = false;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    const prev = out.at(-1);
    if (pendingJoin && prev && /^\p{Ll}/u.test(m[0])) {
      prev.text = prev.text.slice(0, -1) + normalizeWord(m[0]);
      prev.end = end;
    } else {
      const word = normalizeWord(m[0]);
      if (word) out.push({ text: word, start, end });
    }
    // A hyphen at the end of a line, after a letter: the next word may continue it.
    const after = text.slice(end, text.slice(end).search(/\S|$/) + end);
    const last = out.at(-1);
    pendingJoin = !!last && last.end === end && /\p{L}-$/u.test(last.text) && after.includes("\n");
  }
  return out;
}

/** The words of every page, in order. */
export function tokenizePages(pages: readonly string[]): DocToken[] {
  return pages.flatMap((text, page) => tokenize(text).map((t) => ({ ...t, page })));
}

/**
 * Where two word lists differ (Myers' O(ND) algorithm), as hunks of adjacent removals and insertions. Equal lists
 * give none.
 */
export function diffWords(a: readonly string[], b: readonly string[]): Hunk[] {
  // Common ends first: most revisions change a little in the middle.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const edits = myers(A, B);
  // Too different to be worth matching word by word: one change, everything between the common ends.
  if (!edits) {
    return A.length || B.length
      ? [{ oldStart: pre, oldEnd: pre + A.length, newStart: pre, newEnd: pre + B.length }]
      : [];
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  for (const e of edits) {
    if (e === "=") {
      close();
      i++;
      j++;
      continue;
    }
    open ??= { oldStart: pre + i, oldEnd: pre + i, newStart: pre + j, newEnd: pre + j };
    if (e === "-") open.oldEnd = pre + ++i;
    else open.newEnd = pre + ++j;
  }
  close();
  return hunks;
}

/**
 * More edits than this and the versions are compared as one change: the saved frontiers grow with the square of
 * the edits (a few MB here), and a document rewritten that much is read again anyway.
 */
const MAX_EDITS = 2000;

/** The edit script turning `a` into `b` ("=" keep, "-" remove from a, "+" insert from b), or null past MAX_EDITS. */
function myers(a: readonly string[], b: readonly string[]): ("=" | "-" | "+")[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array(m).fill("+");
  if (m === 0) return Array(n).fill("-");
  const off = n + m + 1;
  const v = new Int32Array(2 * off + 1);
  /** trace[d]: the frontier before step d, for diagonals -d..d (index k + d). */
  const trace: Int32Array[] = [];
  const at = (k: number) => v[off + k] as number;
  for (let d = 0; d <= Math.min(n + m, MAX_EDITS); d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? at(k + 1) : at(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], last: number, n: number, m: number): ("=" | "-" | "+")[] {
  const script: ("=" | "-" | "+")[] = [];
  let x = n;
  let y = m;
  for (let d = last; d > 0; d--) {
    const frontier = trace[d] as Int32Array;
    const at = (k: number) => frontier[k + d] as number;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      script.push("=");
      x--;
      y--;
    }
    script.push(x === prevX ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    script.push("=");
    x--;
    y--;
  }
  return script.reverse();
}

/** The changes between two versions' page texts, as text. */
export function diffPages(oldPages: readonly string[], newPages: readonly string[]): TextChange[] {
  const a = tokenizePages(oldPages);
  const b = tokenizePages(newPages);
  return diffWords(
    a.map((t) => t.text),
    b.map((t) => t.text),
  ).map((h) => describeHunk(h, a, b));
}

/** A hunk as text: what was removed and added, its page, and the words before it. */
export function describeHunk(h: Hunk, a: readonly DocToken[], b: readonly DocToken[]): TextChange {
  const words = (ts: readonly DocToken[], s: number, e: number) =>
    ts
      .slice(s, e)
      .map((t) => t.text)
      .join(" ");
  const anchor = b[h.newStart] ?? b[h.newStart - 1];
  const page = anchor?.page ?? 0;
  const removed = words(a, h.oldStart, h.oldEnd);
  const added = words(b, h.newStart, h.newEnd);
  let from = h.newStart;
  while (from > 0 && h.newStart - from < 5 && b[from - 1]?.page === page) from--;
  return {
    page: page + 1,
    ...(removed ? { removed } : {}),
    ...(added ? { added } : {}),
    before: words(b, from, h.newStart),
  };
}
