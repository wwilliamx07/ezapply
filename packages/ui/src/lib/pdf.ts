import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import { linkRect, type PdfLink, safeLinkUrl } from "./links.js";
import { joinItems, type TextItem } from "./text.js";

export { itemsOf } from "./text.js";

declare const __PDF_WORKER__: string;

// pdf.js's worker and data files, all from the companion (/ui/): the page loads nothing from anywhere else.
GlobalWorkerOptions.workerSrc = __PDF_WORKER__;

export interface LoadedPage {
  proxy: PDFPageProxy;
  /** Size at scale 1, in CSS pixels (1/72 in). */
  width: number;
  height: number;
  /** Text items in the order the text layer renders them (items with text only). */
  items: TextItem[];
  /** The page's text as the companion reads it (`pdf_text`): items joined, a line break after each line's last. */
  text: string;
  /** Where each item starts in `text`. */
  itemStarts: number[];
  /** Its links, so the viewer can open them and the review can list them. */
  links: PdfLink[];
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  pages: LoadedPage[];
}

/** Open a PDF the companion serves, with every page's size and text read up front (documents here are short). */
export async function loadPdf(url: string): Promise<LoadedPdf> {
  const doc = await getDocument({
    url,
    withCredentials: true,
    standardFontDataUrl: "/ui/pdfjs/standard_fonts/",
    cMapUrl: "/ui/pdfjs/cmaps/",
    cMapPacked: true,
    iccUrl: "/ui/pdfjs/iccs/",
    wasmUrl: "/ui/pdfjs/wasm/",
    enableXfa: false,
  }).promise;
  const pages: LoadedPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const proxy = await doc.getPage(n);
    const viewport = proxy.getViewport({ scale: 1 });
    const content = await proxy.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) if ("str" in item) items.push({ str: item.str, hasEOL: item.hasEOL });
    const { text, itemStarts } = joinItems(items);
    const links = await linksOf(doc, proxy, viewport).catch(() => []);
    pages.push({ proxy, width: viewport.width, height: viewport.height, items, text, itemStarts, links });
  }
  return { doc, pages };
}

/**
 * A page's link annotations: a web, mail or phone address (`safeLinkUrl`), or a place in the same PDF resolved to
 * its page. Anything else (a script, a file, a form action) is left out.
 */
async function linksOf(
  doc: PDFDocumentProxy,
  proxy: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
): Promise<PdfLink[]> {
  const out: PdfLink[] = [];
  for (const a of await proxy.getAnnotations({ intent: "display" })) {
    if (a.subtype !== "Link" || !Array.isArray(a.rect)) continue;
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
    const rect = linkRect([x1, y1, x2, y2], viewport.width, viewport.height);
    if (!rect) continue;
    const url = safeLinkUrl(a.url ?? a.unsafeUrl);
    if (url) {
      out.push({ rect, url });
      continue;
    }
    const page = a.dest ? await pageOf(doc, a.dest).catch(() => undefined) : undefined;
    if (page !== undefined) out.push({ rect, page });
  }
  return out;
}

/** The 0-based page a destination (named, or explicit) points at. */
async function pageOf(doc: PDFDocumentProxy, dest: unknown): Promise<number | undefined> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  const ref = Array.isArray(explicit) ? explicit[0] : undefined;
  if (typeof ref === "number") return ref;
  if (ref && typeof ref === "object") return doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
  return undefined;
}
