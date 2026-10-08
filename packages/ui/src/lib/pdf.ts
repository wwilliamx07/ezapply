import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import { joinItems, type TextItem } from "./text.js";

export { itemsOf, type TextItem } from "./text.js";

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
    pages.push({ proxy, width: viewport.width, height: viewport.height, items, text, itemStarts });
  }
  return { doc, pages };
}
