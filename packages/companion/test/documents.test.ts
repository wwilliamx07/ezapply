import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePageRanges } from "../src/documents/pdf/pages.js";
import { pdfInfo, pdfText } from "../src/documents/pdf/toolkit.js";
import { DocumentsService } from "../src/documents/service.js";
import { resolveEngine } from "../src/documents/tex/engines.js";
import { createLogger } from "../src/logger.js";
import { Workspace } from "../src/workspace/workspace.js";

let root: string;
let ws: Workspace;
let docs: DocumentsService;

async function makePdf(path: string, size: [number, number], lines: string[][]): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const pageLines of lines) {
    const page = doc.addPage(size);
    pageLines.forEach((text, i) => {
      page.drawText(text, { x: 50, y: size[1] - 80 - i * 20, size: 12, font });
    });
  }
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, await doc.save());
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-docs-"));
  ws = new Workspace(root);
  docs = new DocumentsService(ws, createLogger({ toFile: false, level: "silent" }));
  await makePdf(join(root, "postings/p1/cover.pdf"), [612, 792], [["Dear hiring manager", "Cover letter body"]]);
  await makePdf(join(root, "postings/p1/resume.pdf"), [612, 792], [["Jane Doe", "Experience", "Skills"]]);
  await makePdf(
    join(root, "library/transcript.pdf"),
    [595.28, 841.89],
    [["Transcript page 1"], ["Transcript page 2"], ["Transcript page 3"]],
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parsePageRanges", () => {
  it("parses selections", () => {
    expect(parsePageRanges(undefined, 3)).toEqual([0, 1, 2]);
    expect(parsePageRanges("2-", 4)).toEqual([1, 2, 3]);
    expect(parsePageRanges("3,1-2", 3)).toEqual([2, 0, 1]);
  });
  it("rejects out-of-range selections", () => {
    expect(() => parsePageRanges("0", 3)).toThrow(/outside/);
    expect(() => parsePageRanges("2-9", 3)).toThrow(/outside/);
    expect(() => parsePageRanges("a", 3)).toThrow(/not a page/);
  });
});

describe("DocumentsService PDFs", () => {
  it("merges with ranges, bookmarks, metadata and size normalization", async () => {
    const result = await docs.merge(
      [
        { path: "postings/p1/cover.pdf", label: "Cover Letter" },
        { path: "postings/p1/resume.pdf", label: "Resume" },
        { path: "library/transcript.pdf", pages: "1-2", label: "Transcript" },
      ],
      "postings/p1/Doe_Jane_Acme_Application.pdf",
      { bookmarks: true, normalize: "auto", title: "Jane Doe: Application", author: "Jane Doe" },
    );
    expect(result.pages).toBe(4);
    expect(result.normalizedPages).toBe(2);
    expect(result.sections).toEqual([
      expect.objectContaining({ label: "Cover Letter", firstPage: 1, lastPage: 1 }),
      expect.objectContaining({ label: "Resume", firstPage: 2, lastPage: 2 }),
      expect.objectContaining({ label: "Transcript", firstPage: 3, lastPage: 4 }),
    ]);
    expect(result.snapshot).toMatch(/^\.history[\\/]/);

    const info = await pdfInfo(result.output);
    expect(info.pageSizes).toEqual([expect.objectContaining({ size: "letter", count: 4 })]);
    expect(info.title).toBe("Jane Doe: Application");
    expect(info.hasTextLayer).toBe(true);

    const merged = await PDFDocument.load(await readFile(result.output));
    expect(merged.catalog.get(PDFName.of("Outlines"))).toBeDefined();

    const text = await pdfText(result.output, "3-4");
    expect(text.map((t) => t.text)).toEqual(["Transcript page 1", "Transcript page 2"]);
  });

  it("renders a page to PNG and saves a preview", async () => {
    const { png, savedTo } = await docs.render("postings/p1/resume.pdf", 1, 1);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect((await stat(savedTo)).size).toBe(png.length);
  });

  it("extracts text in reading order", async () => {
    const [page] = await docs.text("postings/p1/resume.pdf");
    expect(page?.text).toBe("Jane Doe\nExperience\nSkills");
  });

  it("builds a PDF from images", async () => {
    const canvas = createCanvas(400, 600);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#336";
    ctx.fillRect(0, 0, 400, 600);
    await writeFile(join(root, "library/scan.png"), canvas.toBuffer("image/png"));
    await writeFile(join(root, "library/scan.webp"), canvas.toBuffer("image/webp"));
    const r = await docs.fromImages(["library/scan.png", "library/scan.webp"], "library/scan.pdf", "letter");
    expect(r.pages).toBe(2);
  });

  it("compresses losslessly and reports whether the target was met", async () => {
    const r = await docs.compress("library/transcript.pdf", "library/transcript-small.pdf", 1_000_000);
    expect(r.metTarget).toBe(true);
    expect(r.after).toBeLessThanOrEqual(r.before);
  });

  it("refuses paths outside the allowed folders", async () => {
    await expect(docs.info("../outside.pdf")).rejects.toMatchObject({ code: "path_not_allowed" });
    await expect(docs.merge([{ path: "library/transcript.pdf" }], "templates/x.pdf", {})).rejects.toMatchObject({
      code: "path_not_allowed",
    });
    await expect(docs.compile("repo-cache/x/main.tex")).rejects.toMatchObject({ code: "path_not_allowed" });
  });

  it("reports encrypted or unreadable PDFs clearly", async () => {
    await writeFile(join(root, "library/broken.pdf"), "not a pdf");
    await expect(docs.merge([{ path: "library/broken.pdf" }], "postings/p1/x.pdf", {})).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});

const engine = await resolveEngine("auto");

describe.skipIf(!engine)(`tex_compile (${engine?.id ?? "no engine installed"})`, () => {
  it("compiles, counts pages, enforces the resume page limit and snapshots", async () => {
    await mkdir(join(root, "postings/p2"), { recursive: true });
    const onePage = "\\documentclass{article}\\begin{document}Hello resume.\\end{document}\n";
    await writeFile(join(root, "postings/p2/resume.tex"), onePage);
    const ok = await docs.compile("postings/p2/resume.tex");
    expect(ok).toMatchObject({ ok: true, pages: 1, pageLimit: 1, pageLimitExceeded: false });
    expect(ok.snapshot).toBeDefined();

    const twoPages = "\\documentclass{article}\\begin{document}One\\newpage Two\\end{document}\n";
    await writeFile(join(root, "postings/p2/resume.tex"), twoPages);
    const long = await docs.compile("postings/p2/resume.tex");
    expect(long).toMatchObject({ ok: true, pages: 2, pageLimitExceeded: true });
    expect(long.hint).toMatch(/limit is 1/);
  }, 180_000);

  it("reports errors with line numbers", async () => {
    await writeFile(
      join(root, "postings/p2/cover.tex"),
      "\\documentclass{article}\n\\begin{document}\n\\notacommand\n\\end{document}\n",
    );
    const bad = await docs.compile("postings/p2/cover.tex");
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]).toMatchObject({ severity: "error", line: 3 });
  }, 180_000);

  it("never runs shell escape", async () => {
    await writeFile(
      join(root, "postings/p2/escape.tex"),
      "\\documentclass{article}\\begin{document}\\immediate\\write18{echo pwned > pwned.txt}x\\end{document}\n",
    );
    await docs.compile("postings/p2/escape.tex");
    await expect(stat(join(root, "postings/p2/pwned.txt"))).rejects.toThrow();
  }, 180_000);
});
