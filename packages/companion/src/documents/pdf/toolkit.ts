import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import {
  type PDFContext,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  type PDFPage,
  type PDFRef,
} from "@cantoo/pdf-lib";
import { ErrorCode, EzError } from "@ezapply/protocol";
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

async function openPdfJs(path: string) {
  const lib = await pdfjs();
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  // The loading task owns the worker; destroying it releases the document.
  const task = lib.getDocument({
    data: await readPdfBytes(path),
    verbosity: 0,
    standardFontDataUrl: `${join(root, "standard_fonts")}/`,
    cMapUrl: `${join(root, "cmaps")}/`,
    cMapPacked: true,
  });
  return { doc: await task.promise, close: () => task.destroy() };
}

/** Text per page in reading order, the way a naive ATS parser would see it. */
export async function pdfText(path: string, pages?: string): Promise<{ page: number; text: string }[]> {
  const { doc, close } = await openPdfJs(path);
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
  const bytes = (await stat(path)).size;
  const raw = await readPdfBytes(path);
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
    const sample = await pdfText(path, `1-${Math.min(3, doc.getPageCount())}`).catch(() => []);
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
      const page = src.getPage(i);
      const { width, height } = page.getSize();
      if (opts.normalize === "auto" && target === null) target = [width, height];
      if (target && opts.normalize !== "none" && !sameSize([width, height], target)) {
        await drawScaled(out, page, target);
        normalizedPages++;
      } else {
        const [copied] = await out.copyPages(src, [i]);
        if (copied) out.addPage(copied);
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
  await writeAtomic(output, bytes);
  return { output, pages: out.getPageCount(), bytes: bytes.length, sections, normalizedPages };
}

/** Scale a foreign page onto a new page of the target size, centred, preserving vectors. */
async function drawScaled(out: PDFDocument, page: PDFPage, target: readonly [number, number]): Promise<void> {
  const embedded = await out.embedPage(page);
  const { width, height } = page.getSize();
  const landscape = width > height;
  const [tw, th] = landscape ? [target[1], target[0]] : target;
  const scale = Math.min(tw / width, th / height);
  const dest = out.addPage([tw, th]);
  dest.drawPage(embedded, {
    x: (tw - width * scale) / 2,
    y: (th - height * scale) / 2,
    xScale: scale,
    yScale: scale,
  });
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
  await writeAtomic(output, bytes);
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

  await writeAtomic(output, best);
  const metTarget = targetBytes === undefined ? null : best.length <= targetBytes;
  return {
    output,
    before,
    after: best.length,
    method,
    metTarget,
    ...(metTarget === false && !gs
      ? { hint: "Install Ghostscript to downsample images (winget install ArtifexSoftware.GhostScript)." }
      : {}),
  };
}

/** Open a file in the OS default application (the user's PDF viewer). */
export async function openInDefaultApp(path: string): Promise<void> {
  await stat(path).catch(() => {
    throw new EzError(ErrorCode.NotFound, `File not found: ${path}`);
  });
  if (process.platform === "win32") {
    // explorer.exe hands the file to its registered viewer without a shell parsing the path.
    await run("explorer.exe", [path], { timeoutMs: 10_000 });
  } else {
    await run(process.platform === "darwin" ? "open" : "xdg-open", [path], { timeoutMs: 10_000 });
  }
}

export async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM") {
      throw new EzError(
        ErrorCode.BadRequest,
        `${path} is locked by another program.`,
        "Ask the user to close the PDF in their viewer (Acrobat locks open files), then retry.",
      );
    }
    throw err;
  }
}

function baseLabel(path: string): string {
  const name =
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.pdf$/i, "") ?? path;
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
