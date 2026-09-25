import { ErrorCode, EzError } from "@ezapply/protocol";

export const PAGE_SIZES = {
  letter: [612, 792],
  a4: [595.28, 841.89],
} as const;
export type PageSizeName = keyof typeof PAGE_SIZES;

/**
 * Parse a 1-based page selection such as "1-3,5,8-" into 0-based indices, in the order given.
 * An empty or undefined spec selects every page.
 */
export function parsePageRanges(spec: string | undefined, pageCount: number): number[] {
  if (!spec?.trim()) return Array.from({ length: pageCount }, (_, i) => i);
  const out: number[] = [];
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    const m = part.match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m || (!m[1] && !m[3])) throw bad(spec, `"${part}" is not a page or range`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : pageCount) : from;
    if (from < 1 || to > pageCount || from > to) throw bad(spec, `"${part}" is outside 1-${pageCount}`);
    for (let p = from; p <= to; p++) out.push(p - 1);
  }
  return out;
}

function bad(spec: string, why: string): EzError {
  return new EzError(
    ErrorCode.BadRequest,
    `Invalid page range "${spec}": ${why}`,
    'Use forms like "1", "1-3", "2,4-5" or "3-".',
  );
}

export function sameSize(a: readonly [number, number], b: readonly [number, number], tolerance = 2): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

export function describeSize([w, h]: readonly [number, number]): string {
  for (const [name, [sw, sh]] of Object.entries(PAGE_SIZES)) {
    if (sameSize([w, h], [sw, sh])) return name;
    if (sameSize([w, h], [sh, sw])) return `${name} landscape`;
  }
  return `${Math.round((w / 72) * 25.4)}x${Math.round((h / 72) * 25.4)}mm`;
}
