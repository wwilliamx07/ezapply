import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import {
  PDFArray,
  type PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFPage,
  type PDFRef,
} from "@cantoo/pdf-lib";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { writeFileAtomic } from "../../util/fs.js";
import { installHint } from "../../util/install-hints.js";
import { run, which } from "../../util/proc.js";
import { describeSize, PAGE_SIZES, type PageSizeName, parsePageRanges, sameSize } from "./pages.js";

export interface PdfInfo {
  path: string;
  bytes: number;
  pages: number;
  pageSizes: { size: string; widthPt: number; heightPt: number; count: number }[];
  encrypted: boolean;
  hasTextLayer: boolean;
  title?: string;
  author?: string;
}

export interface MergeInput {
  path: string;
  /** 1-based selection like "1-2,4"; all pages when omitted. */
  pages?: string;
  /** Bookmark label; defaults to the file name. */
  label?: string;
}

export interface MergeOptions {
  bookmarks?: boolean;
  /** "auto" matches every page to the first input's first page size. */
  normalize?: "auto" | "none" | PageSizeName;
  title?: string;
  author?: string;
}

export interface MergeResult {
  output: string;
  pages: number;
  bytes: number;
  sections: { label: string; source: string; firstPage: number; lastPage: number }[];
  normalizedPages: number;
}

const require = createRequire(import.meta.url);

async function loadPdfLib(path: string): Promise<PDFDocument> {
  const bytes = await readPdfBytes(path);
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test((err as Error).message)) {
      throw new EzError(
        ErrorCode.BadRequest,
        `${path} is encrypted.`,
        "Ask the user for an unencrypted copy (e.g. print to PDF from their viewer).",
      );
    }
    throw new EzError(ErrorCode.BadRequest, `Could not read ${path} as a PDF: ${(err as Error).message}`);
  }
}

async function readPdfBytes(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      throw new EzError(ErrorCode.NotFound, `File not found: ${path}`);
    throw err;
  }
}

// ---- pdf.js (text + rendering) ------------------------------------------------------------------

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | undefined;
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/** A PDF to read: its path, or its bytes (a review's snapshot). */
export type PdfSource = string | Uint8Array;

async function openPdfJs(source: PdfSource) {
  const lib = await pdfjs();
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  // The loading task owns the worker; destroying it releases the document. pdf.js takes over the buffer it's
  // given, so bytes passed in are copied.
  const task = lib.getDocument({
    data: typeof source === "string" ? await readPdfBytes(source) : new Uint8Array(source),
    verbosity: 0,
    standardFontDataUrl: `${join(root, "standard_fonts")}/`,
    cMapUrl: `${join(root, "cmaps")}/`,
    cMapPacked: true,
  });
  return { doc: await task.promise, close: () => task.destroy() };
}

/** Text per page in reading order, the way a naive ATS parser would see it. */
export async function pdfText(source: PdfSource, pages?: string): Promise<{ page: number; text: string }[]> {
  const { doc, close } = await openPdfJs(source);
  try {
    const indices = parsePageRanges(pages, doc.numPages);
    const out: { page: number; text: string }[] = [];
    for (const i of indices) {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      out.push({ page: i + 1, text: text.replace(/[ \t]+\n/g, "\n").trim() });
    }
    return out;
  } finally {
    await close();
  }
}

/** Render one page to PNG. */
export async function pdfRender(path: string, pageNumber: number, scale: number): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const { doc, close } = await openPdfJs(path);
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new EzError(ErrorCode.BadRequest, `Page ${pageNumber} does not exist (document has ${doc.numPages}).`);
    }
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await close();
  }
}

// ---- pdf-lib (structure) ------------------------------------------------------------------------

export async function pdfInfo(path: string): Promise<PdfInfo> {
  return pdfInfoOf(await readPdfBytes(path), path);
}

/** pdfInfo of bytes in hand (`path` is only reported back). */
export async function pdfInfoOf(raw: Uint8Array, path: string): Promise<PdfInfo> {
  const bytes = raw.byteLength;
  const doc = await PDFDocument.load(raw, { ignoreEncryption: true, updateMetadata: false });
  const sizes = new Map<string, { size: string; widthPt: number; heightPt: number; count: number }>();
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    const key = `${Math.round(width)}x${Math.round(height)}`;
    const cur = sizes.get(key);
    if (cur) cur.count++;
    else
      sizes.set(key, {
        size: describeSize([width, height]),
        widthPt: Math.round(width * 100) / 100,
        heightPt: Math.round(height * 100) / 100,
        count: 1,
      });
  }
  const encrypted = doc.isEncrypted;
  let hasTextLayer = false;
  if (!encrypted) {
    const sample = await pdfText(raw, `1-${Math.min(3, doc.getPageCount())}`).catch(() => []);
    hasTextLayer = sample.some((p) => p.text.length > 20);
  }
  const title = doc.getTitle();
  const author = doc.getAuthor();
  return {
    path,
    bytes,
    pages: doc.getPageCount(),
    pageSizes: [...sizes.values()],
    encrypted,
    hasTextLayer,
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
  };
}

export async function pdfMerge(inputs: MergeInput[], output: string, opts: MergeOptions = {}): Promise<MergeResult> {
  if (inputs.length === 0) throw new EzError(ErrorCode.BadRequest, "Nothing to merge.");
  const out = await PDFDocument.create();
  const sections: MergeResult["sections"] = [];
  let target: readonly [number, number] | null =
    opts.normalize && opts.normalize !== "auto" && opts.normalize !== "none" ? PAGE_SIZES[opts.normalize] : null;
  let normalizedPages = 0;

  for (const input of inputs) {
    const src = await loadPdfLib(input.path);
    const indices = parsePageRanges(input.pages, src.getPageCount());
    const firstPage = out.getPageCount() + 1;
    for (const i of indices) {
      const [page] = await out.copyPages(src, [i]);
      if (!page) continue;
      out.addPage(page);
      const size = displayedSize(page);
      if (opts.normalize === "auto" && target === null) target = size;
      // A landscape page of the right paper size (a wide table) is already right.
      const fits = target && (sameSize(size, target) || sameSize(size, [target[1], target[0]]));
      if (target && opts.normalize !== "none" && !fits) {
        fitToSize(page, target);
        normalizedPages++;
      }
    }
    sections.push({
      label: input.label ?? baseLabel(input.path),
      source: input.path,
      firstPage,
      lastPage: out.getPageCount(),
    });
  }

  if (opts.bookmarks !== false)
    addOutline(
      out,
      sections.map((s) => ({ title: s.label, pageIndex: s.firstPage - 1 })),
    );
  if (opts.title) out.setTitle(opts.title, { showInWindowTitleBar: true });
  if (opts.author) out.setAuthor(opts.author);
  out.setCreator("ezapply");
  out.setProducer("ezapply");

  const bytes = await out.save({ useObjectStreams: true });
  await writeFileAtomic(output, bytes);
  return { output, pages: out.getPageCount(), bytes: bytes.length, sections, normalizedPages };
}

/** The page as a viewer shows it: [width, height] after /Rotate. */
function displayedSize(page: PDFPage): [number, number] {
  const { width, height } = page.getMediaBox();
  return quarterTurned(page) ? [height, width] : [width, height];
}

function quarterTurned(page: PDFPage): boolean {
  return Math.abs(page.getRotation().angle) % 180 === 90;
}

/**
 * Resize a page to the target paper size (turned to the page's own orientation) and scale its content to
 * fit, centred. The page keeps its own content stream, so text, vectors and its annotations survive: the
 * resume's clickable LinkedIn and GitHub links. (Redrawing it as a form XObject, as this once did, drops
 * every annotation.) Annotation rectangles get the same transform as the content.
 */
function fitToSize(page: PDFPage, target: readonly [number, number]): void {
  const box = page.getMediaBox();
  const [dw, dh] = displayedSize(page);
  const [short, long] = [Math.min(...target), Math.max(...target)];
  const [tdw, tdh] = dw > dh ? [long, short] : [short, long];
  // Work in the unrotated coordinate space; /Rotate then turns the result like the original.
  const [tw, th] = quarterTurned(page) ? [tdh, tdw] : [tdw, tdh];
  const s = Math.min(tw / box.width, th / box.height);
  // p' = s * (p - origin) + margin, since a MediaBox needn't start at (0, 0).
  const dx = (tw - box.width * s) / 2 - s * box.x;
  const dy = (th - box.height * s) / 2 - s * box.y;
  page.scaleContent(s, s);
  page.translateContent(dx, dy); // wraps the scaled content, so the translation applies after scaling
  transformAnnotations(page, s, dx, dy);
  page.setMediaBox(0, 0, tw, th);
  for (const name of ["CropBox", "BleedBox", "TrimBox", "ArtBox"]) page.node.delete(PDFName.of(name));
}

/** Apply p' = s * p + d to every coordinate array of the page's annotations. */
function transformAnnotations(page: PDFPage, s: number, dx: number, dy: number): void {
  const annots = page.node.Annots();
  if (!annots) return;
  const move = (arr: PDFArray) => {
    for (let i = 0; i < arr.size(); i++) {
      const n = arr.lookup(i);
      if (n instanceof PDFNumber) arr.set(i, PDFNumber.of(n.asNumber() * s + (i % 2 === 0 ? dx : dy)));
    }
  };
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i);
    if (!(annot instanceof PDFDict)) continue;
    for (const key of ["Rect", "QuadPoints", "Vertices", "L", "CL"]) {
      const arr = annot.lookup(PDFName.of(key));
      if (arr instanceof PDFArray) move(arr);
    }
    const ink = annot.lookup(PDFName.of("InkList"));
    if (ink instanceof PDFArray) {
      for (let j = 0; j < ink.size(); j++) {
        const path = ink.lookup(j);
        if (path instanceof PDFArray) move(path);
      }
    }
    // /RD holds distances, not positions: scale only.
    const rd = annot.lookup(PDFName.of("RD"));
    if (rd instanceof PDFArray) rd.scalePDFNumbers(s, s);
  }
}

/** pdf-lib has no outline API; build the /Outlines tree directly. */
function addOutline(doc: PDFDocument, entries: { title: string; pageIndex: number }[]): void {
  if (entries.length === 0) return;
  const ctx: PDFContext = doc.context;
  const outlineRef = ctx.nextRef();
  const refs: PDFRef[] = entries.map(() => ctx.nextRef());
  entries.forEach((entry, i) => {
    const page = doc.getPage(entry.pageIndex);
    const item = ctx.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: outlineRef,
      Dest: [page.ref, PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull],
      ...(i > 0 ? { Prev: refs[i - 1] as PDFRef } : {}),
      ...(i < refs.length - 1 ? { Next: refs[i + 1] as PDFRef } : {}),
    });
    ctx.assign(refs[i] as PDFRef, item);
  });
  ctx.assign(
    outlineRef,
    ctx.obj({ Type: "Outlines", First: refs[0] as PDFRef, Last: refs[refs.length - 1] as PDFRef, Count: refs.length }),
  );
  doc.catalog.set(PDFName.of("Outlines"), outlineRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

/** One page per image, fitted inside the page with a small margin. */
export async function pdfFromImages(
  images: string[],
  output: string,
  pageSize: PageSizeName,
): Promise<{ output: string; pages: number; bytes: number }> {
  if (images.length === 0) throw new EzError(ErrorCode.BadRequest, "No images given.");
  const doc = await PDFDocument.create();
  const margin = 18;
  for (const path of images) {
    const img = await embedImage(doc, path);
    const landscape = img.width > img.height;
    const [pw, ph] = landscape ? [PAGE_SIZES[pageSize][1], PAGE_SIZES[pageSize][0]] : PAGE_SIZES[pageSize];
    const scale = Math.min((pw - 2 * margin) / img.width, (ph - 2 * margin) / img.height, 1);
    const page = doc.addPage([pw, ph]);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  doc.setCreator("ezapply");
  const bytes = await doc.save({ useObjectStreams: true });
  await writeFileAtomic(output, bytes);
  return { output, pages: doc.getPageCount(), bytes: bytes.length };
}

async function embedImage(doc: PDFDocument, path: string) {
  const data = await readFile(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new EzError(ErrorCode.NotFound, `File not found: ${path}`);
    throw err;
  });
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return doc.embedJpg(data);
  if (ext === ".png") return doc.embedPng(data);
  // Anything else (webp, gif, avif, bmp): decode and re-encode as PNG.
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const image = await loadImage(data).catch(() => {
    throw new EzError(ErrorCode.BadRequest, `Unsupported image format: ${path}`, "Use PNG or JPEG.");
  });
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return doc.embedPng(canvas.toBuffer("image/png"));
}

/**
 * Shrink a PDF: first a lossless re-save (drops unused objects, packs object streams), then
 * Ghostscript image downsampling if it is installed and the target is still not met.
 */
export async function pdfCompress(
  path: string,
  output: string,
  targetBytes?: number,
): Promise<{
  output: string;
  before: number;
  after: number;
  method: string;
  metTarget: boolean | null;
  hint?: string;
}> {
  const before = (await stat(path)).size;
  const doc = await loadPdfLib(path);
  let best = await doc.save({ useObjectStreams: true });
  let method = "lossless re-save";
  if (best.length >= before) {
    best = new Uint8Array(await readFile(path));
    method = "none (already compact)";
  }

  const gs = ["gswin64c", "gswin32c", "gs"].find((b) => which(b));
  const needMore = targetBytes !== undefined && best.length > targetBytes;
  if (needMore && gs) {
    const tmpIn = `${output}.gs-in.pdf`;
    const tmpOut = `${output}.gs-out.pdf`;
    await writeFile(tmpIn, best);
    for (const preset of ["/ebook", "/screen"]) {
      const r = await run(
        gs,
        [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.6",
          `-dPDFSETTINGS=${preset}`,
          "-dNOPAUSE",
          "-dBATCH",
          "-dQUIET",
          "-dSAFER",
          `-sOutputFile=${tmpOut}`,
          tmpIn,
        ],
        { timeoutMs: 120_000 },
      );
      if (r.exitCode !== 0) break;
      const candidate = new Uint8Array(await readFile(tmpOut));
      if (candidate.length < best.length) {
        best = candidate;
        method = `ghostscript ${preset}`;
      }
      if (targetBytes !== undefined && best.length <= targetBytes) break;
    }
    await rm(tmpIn, { force: true });
    await rm(tmpOut, { force: true });
  }

  await writeFileAtomic(output, best);
  const metTarget = targetBytes === undefined ? null : best.length <= targetBytes;
  return {
    output,
    before,
    after: best.length,
    method,
    metTarget,
    ...(metTarget === false && !gs
      ? { hint: `Ghostscript can downsample its images further. ${installHint("ghostscript")}` }
      : {}),
  };
}

function baseLabel(path: string): string {
  const name =
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.pdf$/i, "") ?? path;
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
