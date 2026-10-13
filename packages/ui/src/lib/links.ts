import type { PageRect } from "@ezapply/protocol";

/** A link in a PDF: where it sits on its page, and where it goes (a web address, or a page of the same PDF). */
export interface PdfLink {
  /** In fractions of the page's size, as comments are, so it holds at any zoom. */
  rect: PageRect;
  url?: string;
  /** 0-based. */
  page?: number;
}

const SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * A link's address as the page may open it: only web, mail and phone links. The PDF came from Claude's build of
 * the user's documents, but an address in it can still come from a posting or a template, so `javascript:`, `file:`
 * and the like stay inert.
 */
export function safeLinkUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    return SCHEMES.has(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** A rectangle in the page's viewport at scale 1 (two corners, any order) as fractions of the page. */
export function linkRect([x1, y1, x2, y2]: number[], width: number, height: number): PageRect | null {
  if ([x1, y1, x2, y2].some((n) => typeof n !== "number" || !Number.isFinite(n)) || width <= 0 || height <= 0)
    return null;
  const left = Math.max(0, Math.min(x1 as number, x2 as number));
  const top = Math.max(0, Math.min(y1 as number, y2 as number));
  const right = Math.min(width, Math.max(x1 as number, x2 as number));
  const bottom = Math.min(height, Math.max(y1 as number, y2 as number));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left / width, y: top / height, w: (right - left) / width, h: (bottom - top) / height };
}

/** What a link shows the user: the address without `mailto:`, or the page it goes to. */
export function linkLabel(link: Pick<PdfLink, "url" | "page">): string {
  if (link.url) return link.url.replace(/^mailto:/, "").replace(/^tel:/, "");
  return `Page ${(link.page ?? 0) + 1}`;
}
