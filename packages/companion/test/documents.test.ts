import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type PDFArray,
  type PDFDict,
  PDFDocument,
  PDFName,
  type PDFNumber,
  PDFString,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freeLines, lintLayout } from "../src/documents/pdf/lint.js";
import { parsePageRanges } from "../src/documents/pdf/pages.js";
import { type PageLines, pdfInfo, pdfLines, pdfText } from "../src/documents/pdf/toolkit.js";
import { DocumentsService } from "../src/documents/service.js";
import {
  detectTexProgram,
  ENGINES,
  type EngineRun,
  readTexProgram,
  resolveEngine,
  withTexProgram,
} from "../src/documents/tex/engines.js";
import { createLogger } from "../src/logger.js";
import { Workspace } from "../src/workspace/workspace.js";

let root: string;
let ws: Workspace;
let docs: DocumentsService;
const opened: string[] = [];

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
  docs = new DocumentsService(ws, createLogger({ toFile: false, level: "silent" }), {
    file: async (path) => {
      opened.push(path);
      return "edge";
    },
    url: async () => "edge",
  });
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

describe("layout lint", () => {
  /** A Letter page with 72pt margins: text from x 72 to 540. Each entry is drawn at its x, on its own baseline. */
  async function page(rows: { x?: number; y: number; text: string; right?: string }[]) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([612, 792]);
    /** FULL in a row's text: words up to the right margin, without passing it. */
    const fill = (from: number, text: string) => {
      const [before = "", after = ""] = text.split("FULL");
      let words = "built";
      while (font.widthOfTextAtSize(`${before}${words} and shipped${after}`, 10) < 540 - from) words += " and shipped";
      return `${before}${words}${after}`;
    };
    for (const r of rows) {
      const x = r.x ?? 72;
      const text = r.text.includes("FULL") ? fill(x, r.text) : r.text;
      p.drawText(text, { x, y: r.y, size: 10, font });
      if (r.right) p.drawText(r.right, { x: 540 - font.widthOfTextAtSize(r.right, 10), y: r.y, size: 10, font });
    }
    return pdfLines(await doc.save());
  }

  it("finds a word left alone on a bullet's last line", async () => {
    const issues = lintLayout(
      await page([
        { y: 700, text: "• FULL" },
        { x: 82, y: 688, text: "users" },
        { y: 676, text: "• FULL" },
        { x: 82, y: 664, text: "a continuation long enough to be a fair share of the line" },
      ]),
    );
    expect(issues).toEqual([expect.objectContaining({ kind: "short-line", page: 1, text: "users" })]);
  });

  it("leaves a new item, a new sentence and a heading alone", async () => {
    const issues = lintLayout(
      await page([
        { y: 700, text: "FULL" },
        { y: 688, text: "• Next item" },
        { y: 676, text: "FULL." },
        { y: 664, text: "Short." },
        { y: 652, text: "FULL" },
        { y: 620, text: "Skills" },
      ]),
    );
    expect(issues).toEqual([]);
  });

  it("finds a right-aligned date out of line with the others", async () => {
    const issues = lintLayout(
      await page([
        { y: 700, text: "Acme Corp", right: "2023 – 2024" },
        { y: 680, text: "Globex", right: "2021 – 2023" },
        { y: 660, text: "Initech", right: "2019 – 2021" },
      ]),
    );
    expect(issues).toEqual([]);
    const shifted = await page([
      { y: 700, text: "Acme Corp", right: "2023 – 2024" },
      { y: 680, text: "Globex", right: "2021 – 2023" },
    ]);
    const date = shifted[0]?.lines[1]?.spans[1];
    if (date) {
      date.x0 -= 4;
      date.x1 -= 4;
    }
    expect(lintLayout(shifted)).toEqual([
      expect.objectContaining({
        kind: "ragged-right",
        text: "2021 – 2023",
        message: expect.stringMatching(/4\.0pt short of/),
      }),
    ]);
  });

  it("says how much room is left at the page limit, and finds text off the page", async () => {
    const top = await page([
      { y: 710, text: "Jane Doe" },
      { y: 696, text: "Experience" },
      { y: 682, text: "Skills" },
    ]);
    expect(lintLayout(top, { pageLimit: 1 })).toEqual([
      expect.objectContaining({ kind: "underfilled", message: expect.stringMatching(/^About \d+ lines are free/) }),
    ]);
    expect(lintLayout(top, { pageLimit: 2 })).toEqual([]);
    expect(lintLayout(top)).toEqual([]);
    const free = freeLines(top[0] as PageLines) ?? 0;
    expect(free).toBeGreaterThanOrEqual(3);
    // One more line at the bottom takes one free line away.
    const fuller = await page([
      { y: 710, text: "Jane Doe" },
      { y: 696, text: "Experience" },
      { y: 682, text: "Skills" },
      { y: 668, text: "Projects" },
    ]);
    expect(freeLines(fuller[0] as PageLines)).toBe(free - 1);
    const off = await page([
      { y: 700, text: "Jane Doe" },
      { x: 560, y: 680, text: "a line that runs past the edge" },
    ]);
    expect(lintLayout(off)).toEqual([expect.objectContaining({ kind: "off-page" })]);
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

  it("keeps a resized page's links, moved with its content", async () => {
    // An A4 first document sets the size; the Letter resume with a clickable link gets resized to it.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText("Jane Doe  github.com/jane", { x: 50, y: 705, size: 12, font });
    const link = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [50, 700, 250, 720],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of("https://github.com/jane") },
      }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    await writeFile(join(root, "postings/p1/linked-resume.pdf"), await doc.save());

    const result = await docs.merge(
      [{ path: "library/transcript.pdf", pages: "1" }, { path: "postings/p1/linked-resume.pdf" }],
      "postings/p1/linked-bundle.pdf",
      { normalize: "auto" },
    );
    expect(result.normalizedPages).toBe(1);
    const merged = await PDFDocument.load(await readFile(result.output));
    const resized = merged.getPage(1);
    expect(resized.getSize()).toEqual({ width: 595.28, height: 841.89 });
    const annots = resized.node.Annots();
    expect(annots?.size()).toBe(1);
    const annot = annots?.lookup(0) as PDFDict;
    const s = 595.28 / 612;
    const dy = (841.89 - 792 * s) / 2;
    const rect = (annot.lookup(PDFName.of("Rect")) as PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
    expect(rect.map((v) => Math.round(v * 10) / 10)).toEqual(
      [50 * s, 700 * s + dy, 250 * s, 720 * s + dy].map((v) => Math.round(v * 10) / 10),
    );
    expect((await pdfText(result.output, "2"))[0]?.text).toContain("github.com/jane");
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

  it("opens files for the user through the opener, only from allowed folders", async () => {
    expect(await docs.open("postings/p1/resume.pdf")).toEqual({
      opened: join(root, "postings/p1/resume.pdf"),
      openedIn: "edge",
    });
    expect(opened).toEqual([join(root, "postings/p1/resume.pdf")]);
    await expect(docs.open("profile/profile.yaml")).rejects.toMatchObject({ code: "path_not_allowed" });
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

describe("TeX program comment", () => {
  it("reads both spellings, any case, from the first 20 lines only", () => {
    expect(readTexProgram("% !TEX program = pdflatex\n\\documentclass{article}")).toEqual({
      value: "pdflatex",
      line: 1,
      engine: "pdflatex",
    });
    expect(readTexProgram("\uFEFF%!TeX TS-program = XeLaTeX\r\n")).toMatchObject({ line: 1, engine: "xelatex" });
    expect(readTexProgram("%% comment\n  %  !tex  program=lualatex  \n")).toMatchObject({
      line: 2,
      engine: "lualatex",
    });
    expect(readTexProgram(`${"% filler\n".repeat(20)}% !TEX program = pdflatex\n`)).toBeNull();
    expect(readTexProgram("\\documentclass{article} % !TEX program = pdflatex\n")).toBeNull();
    expect(readTexProgram("% !TEX root = main.tex\n")).toBeNull();
  });

  it("keeps unknown values, options and latexmk without an engine", () => {
    expect(readTexProgram("% !TEX program = latexmk\n")).toMatchObject({ value: "latexmk", engine: null });
    expect(readTexProgram("% !TEX program = pdflatex --shell-escape\n")).toMatchObject({ engine: null });
    expect(readTexProgram("% !TEX program = context\n")).toMatchObject({ engine: null });
  });

  it("detects pdfTeX-only sources and adds the comment", () => {
    const jake = "\\documentclass{article}\n\\input{glyphtounicode}\n\\pdfgentounicode=1\n";
    expect(detectTexProgram(jake)).toMatchObject({ engine: "pdflatex" });
    expect(detectTexProgram(`${jake}\\usepackage{fontspec}\n`)).toBeNull();
    expect(detectTexProgram("\\documentclass{article}\n\\usepackage[T1]{fontenc}\n")).toBeNull();
    expect(withTexProgram("\uFEFFa\r\nb", "pdflatex")).toBe("\uFEFF% !TEX program = pdflatex\r\na\r\nb");
    expect(readTexProgram(withTexProgram(jake, "pdflatex"))?.engine).toBe("pdflatex");
  });
});

describe("tex_compile engine choice", () => {
  const src = "\\documentclass{article}\\begin{document}x\\end{document}\n";
  // Record which engine runs without running TeX: every engine "fails" without a PDF.
  const ran: string[] = [];
  beforeEach(() => {
    ran.length = 0;
    for (const e of Object.values(ENGINES)) {
      vi.spyOn(e, "available").mockResolvedValue(true);
      vi.spyOn(e, "compile").mockImplementation(async (req): Promise<EngineRun> => {
        ran.push(e.id);
        const pdfPath = join(req.outDir, "none.pdf");
        return { engine: e.id, exitCode: 1, timedOut: false, logText: "", pdfPath, output: "" };
      });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(join(root, "ezapply.config.json"), { force: true });
  });

  it("prefers the comment, then tex.engine, then auto", async () => {
    await mkdir(join(root, "postings/p3"), { recursive: true });
    await writeFile(join(root, "postings/p3/a.tex"), `% !TEX program = pdflatex\n${src}`);
    await writeFile(join(root, "postings/p3/b.tex"), src);
    await writeFile(
      join(root, "ezapply.config.json"),
      JSON.stringify({ schemaVersion: 1, tex: { engine: "lualatex" } }),
    );

    expect(await docs.compile("postings/p3/a.tex")).toMatchObject({ engine: "pdflatex", engineFrom: "magic-comment" });
    expect(await docs.compile("postings/p3/b.tex")).toMatchObject({ engine: "lualatex", engineFrom: "config" });
    await rm(join(root, "ezapply.config.json"));
    expect(await docs.compile("postings/p3/b.tex")).toMatchObject({ engine: "latexmk", engineFrom: "auto" });
    expect(ran).toEqual(["pdflatex", "lualatex", "latexmk"]);
  });

  it("tex_edit applies exact edits in the file's line endings, then compiles, or changes nothing", async () => {
    await mkdir(join(root, "postings/p4"), { recursive: true });
    const path = join(root, "postings/p4/resume.tex");
    const src = "\\begin{itemize}\r\n\\item \\textbf{Built} a parser\r\n\\item Wrote tests\r\n\\end{itemize}\r\n";
    await writeFile(path, src);
    const r = await docs.edit("postings/p4/resume.tex", [
      { old: "\\item Wrote tests", new: "\\item Wrote tests\n\\item Ran CI" },
      { old: "\\textbf{Built}", new: "\\textbf{Designed}" },
    ]);
    expect(await readFile(path, "utf8")).toBe(
      "\\begin{itemize}\r\n\\item \\textbf{Designed} a parser\r\n\\item Wrote tests\r\n\\item Ran CI\r\n\\end{itemize}\r\n",
    );
    expect(r.changed).toEqual([
      { line: 2, text: "\\item \\textbf{Designed} a parser\n\\item Wrote tests\n\\item Ran CI\n\\end{itemize}" },
      { line: 1, text: "\\begin{itemize}\n\\item \\textbf{Designed} a parser\n\\item Wrote tests" },
    ]);
    expect(ran).toHaveLength(1);

    const now = await readFile(path, "utf8");
    for (const [edits, message] of [
      [[{ old: "\\item Ran CI", new: "\\item Ran CI" }], /Edit 1: new is the same as old/],
      [[{ old: "\\item", new: "x" }], /Edit 1: old occurs more than once/],
      [
        [
          { old: "Ran CI", new: "Ran builds" },
          { old: "Ran CI", new: "y" },
        ],
        /Edit 2: old isn't in the file \(after the edits before it\)/,
      ],
    ] as const) {
      await expect(docs.edit("postings/p4/resume.tex", [...edits])).rejects.toMatchObject({ message });
    }
    expect(await readFile(path, "utf8")).toBe(now);
    await expect(docs.edit("profile/profile.yaml", [{ old: "a", new: "b" }])).rejects.toThrow();
  });

  it("fails instead of falling back when the named engine is missing or unknown", async () => {
    vi.spyOn(ENGINES.pdflatex, "available").mockResolvedValue(false);
    await writeFile(join(root, "postings/p3/a.tex"), `% !TEX program = pdflatex\n${src}`);
    await expect(docs.compile("postings/p3/a.tex")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringMatching(/pdflatex is not installed.*line 1 of a\.tex/),
      hint: expect.stringMatching(/Don't change or remove the comment/),
    });

    await writeFile(join(root, "postings/p3/a.tex"), `% !TEX program = latexmk\n${src}`);
    await expect(docs.compile("postings/p3/a.tex")).rejects.toMatchObject({
      code: "bad_request",
      hint: expect.stringMatching(/pdflatex, xelatex, lualatex, tectonic\. latexmk is a build driver/),
    });
    expect(ran).toEqual([]);
  });
});

const engine = await resolveEngine("auto");
const hasPdflatex = await ENGINES.pdflatex.available();

// CI's tex job sets this: there, a missing engine must fail rather than skip the compile tests.
describe.runIf(process.env.EZAPPLY_REQUIRE_TEX === "1")("TeX for the compile tests", () => {
  it("has an auto engine and pdflatex", () => {
    expect(engine?.id).toBeDefined();
    expect(hasPdflatex).toBe(true);
  });
});

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
    expect(long.hint).toMatch(/limit is 1\. \d+ lines run past it/);
    expect(long.overflow?.text).toContain("Two");
    expect(long.overflow?.lines).toBeGreaterThanOrEqual(1);
    expect(long.lint).toBeUndefined();

    // Within the limit, layout issues come back as lint, and the hint points to them.
    const lines = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of the resume.\\par`).join("\n");
    await writeFile(
      join(root, "postings/p2/resume.tex"),
      `\\documentclass{article}\\pagestyle{empty}\\begin{document}\n${lines}\n\\end{document}\n`,
    );
    const short = await docs.compile("postings/p2/resume.tex");
    expect(short.lint).toEqual([expect.objectContaining({ kind: "underfilled", page: 1 })]);
    expect(short.freeLines).toBeGreaterThanOrEqual(3);
    expect(short.hint).toMatch(/^About \d+ lines are free on the last page: add about that much evidence first/);

    // A cover letter is one page: a second one is overflow, and a short one is underfilled.
    await writeFile(join(root, "postings/p2/cover.tex"), twoPages);
    expect(await docs.compile("postings/p2/cover.tex")).toMatchObject({ pageLimit: 1, pageLimitExceeded: true });
    await writeFile(
      join(root, "postings/p2/cover.tex"),
      `\\documentclass{article}\\pagestyle{empty}\\begin{document}\n${lines}\n\\end{document}\n`,
    );
    const letter = await docs.compile("postings/p2/cover.tex");
    expect(letter.lint).toEqual([expect.objectContaining({ kind: "underfilled" })]);
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

  it("compiles the shipped default cover letter template to one page", async () => {
    const shipped = join(dirname(fileURLToPath(import.meta.url)), "../../cli/templates/cover/cover.tex");
    await mkdir(join(root, "templates/cover"), { recursive: true });
    await copyFile(shipped, join(root, "templates/cover/cover.tex"));
    const res = await docs.compile("templates/cover/cover.tex");
    expect(res).toMatchObject({ ok: true, pages: 1, engineFrom: "auto" });
    expect(res.engine).not.toBe("pdflatex");
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

describe.skipIf(!hasPdflatex)("tex_compile with % !TEX program = pdflatex", () => {
  it("builds a pdfTeX-only resume with pdflatex whatever tex.engine says", async () => {
    await mkdir(join(root, "postings/p4"), { recursive: true });
    await writeFile(
      join(root, "postings/p4/resume.tex"),
      [
        "% !TEX program = pdflatex",
        "\\documentclass[letterpaper,11pt]{article}",
        "\\input{glyphtounicode}",
        "\\pdfgentounicode=1",
        "\\begin{document}",
        "Jane Doe, resume.",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(root, "ezapply.config.json"),
      JSON.stringify({ schemaVersion: 1, tex: { engine: "xelatex" } }),
    );
    try {
      const res = await docs.compile("postings/p4/resume.tex");
      expect(res).toMatchObject({ ok: true, pages: 1, engine: "pdflatex", engineFrom: "magic-comment" });
    } finally {
      await rm(join(root, "ezapply.config.json"), { force: true });
    }
  }, 180_000);
});
