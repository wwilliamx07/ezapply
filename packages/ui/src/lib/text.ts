/** A text item as pdf.js reads it: what the text layer shows as one span. */
export interface TextItem {
  str: string;
  hasEOL: boolean;
}

/** The page text the companion's `pdf_text` builds, keeping where each item starts. */
export function joinItems(items: readonly TextItem[]): { text: string; itemStarts: number[] } {
  let text = "";
  const itemStarts: number[] = [];
  for (const item of items) {
    itemStarts.push(text.length);
    text += item.str + (item.hasEOL ? "\n" : "");
  }
  return { text, itemStarts };
}

/**
 * The parts of items a range of the page text covers: [item, start, end] with offsets inside each item's string.
 * The line breaks between items belong to none.
 */
export function itemsOf(
  items: readonly TextItem[],
  itemStarts: readonly number[],
  start: number,
  end: number,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < items.length; i++) {
    const s = itemStarts[i] as number;
    const e = s + (items[i] as TextItem).str.length;
    if (e <= start) continue;
    if (s >= end) break;
    const from = Math.max(start, s) - s;
    const to = Math.min(end, e) - s;
    if (to > from) out.push([i, from, to]);
  }
  return out;
}
