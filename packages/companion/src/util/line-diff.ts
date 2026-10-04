/**
 * A unified diff of two texts, line by line, with `context` unchanged lines around each change. Small and
 * dependency-free: it diffs LaTeX sources of a few hundred lines, through a longest-common-subsequence table.
 * Inputs whose table would be too large come back as a one-line note instead.
 */
export function unifiedDiff(oldText: string, newText: string, label: string, context = 2): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length * b.length > 4_000_000) {
    return `--- ${label}\n+++ ${label}\n(too large to diff: ${a.length} lines before, ${b.length} after)`;
  }
  const ops = diffOps(a, b);
  if (!ops.some((o) => o.kind !== " ")) return "";

  const out = [`--- ${label}`, `+++ ${label}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]?.kind === " ") {
      i++;
      continue;
    }
    // A hunk: back up for context, then run until `context * 2` unchanged lines in a row (or the end).
    const start = Math.max(0, i - context);
    let end = i;
    let quiet = 0;
    while (end < ops.length && quiet <= context * 2) {
      quiet = ops[end]?.kind === " " ? quiet + 1 : 0;
      end++;
    }
    end = Math.min(ops.length, end - Math.max(0, quiet - context));
    const hunk = ops.slice(start, end);
    const first = hunk[0];
    const oldStart = (first?.a ?? 0) + 1;
    const newStart = (first?.b ?? 0) + 1;
    const oldLen = hunk.filter((o) => o.kind !== "+").length;
    const newLen = hunk.filter((o) => o.kind !== "-").length;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const o of hunk) out.push(`${o.kind}${o.text}`);
    i = end;
  }
  return out.join("\n");
}

interface Op {
  kind: " " | "-" | "+";
  text: string;
  /** Position in the old and new line lists where this op sits. */
  a: number;
  b: number;
}

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j]: length of the LCS of a[i..] and b[j..], in one flat array.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] =
        a[i] === b[j] ? (lcs[at(i + 1, j + 1)] ?? 0) + 1 : Math.max(lcs[at(i + 1, j)] ?? 0, lcs[at(i, j + 1)] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i] ?? "", a: i, b: j });
      i++;
      j++;
    } else if (j < m && (i >= n || (lcs[at(i, j + 1)] ?? 0) > (lcs[at(i + 1, j)] ?? 0))) {
      ops.push({ kind: "+", text: b[j] ?? "", a: i, b: j });
      j++;
    } else {
      ops.push({ kind: "-", text: a[i] ?? "", a: i, b: j });
      i++;
    }
  }
  return ops;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
