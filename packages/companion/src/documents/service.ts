import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import type { Logger } from "../logger.js";
import { writeFileAtomic } from "../util/fs.js";
import { installHint } from "../util/install-hints.js";
import { KeyedQueue } from "../util/keyed-queue.js";
import type { Opener } from "../util/open.js";
import { run, which } from "../util/proc.js";
import type { Workspace } from "../workspace/workspace.js";
import { pageLimitOf } from "./page-limit.js";
import { freeLines, type LayoutIssue, lintLayout } from "./pdf/lint.js";
import type { PageSizeName } from "./pdf/pages.js";
import {
  type MergeInput,
  type MergeOptions,
  pdfCompress,
  pdfFromImages,
  pdfInfo,
  pdfLines,
  pdfMerge,
  pdfText,
} from "./pdf/toolkit.js";
import {
  ENGINES,
  type EngineId,
  PROGRAM_ENGINES,
  readTexProgram,
  resolveEngine,
  type TexEngine,
  type TexProgram,
} from "./tex/engines.js";
import { parseTexLog, type TexDiagnostic } from "./tex/log.js";

/** Where each kind of operation may read from and write to (workspace-relative). */
const ROOTS = {
  texSource: ["postings", "templates"],
  pdfRead: ["postings", "templates", "library"],
  pdfWrite: ["postings", "library"],
  images: ["postings", "library"],
  open: ["postings", "templates", "library"],
} as const;

const HISTORY_KEEP = 30;

/** Where the engine choice came from: the file's `% !TEX program` comment, `tex.engine`, or "auto". */
type EngineSource = "magic-comment" | "config" | "auto";

export interface CompileResult {
  ok: boolean;
  engine: EngineId;
  engineFrom: EngineSource;
  pdf?: string;
  pages?: number;
  pageLimit?: number;
  pageLimitExceeded?: boolean;
  /** Past the page limit: how many text lines run over, and (the start of) that text. */
  overflow?: { lines: number; text: string };
  /** Layout problems on the pages (pdf/lint.ts), when the document is within its page limit. */
  lint?: LayoutIssue[];
  /** Within the limit: how many more lines fit at the bottom of the last page (pdf/lint.ts `freeLines`). */
  freeLines?: number;
  diagnostics: TexDiagnostic[];
  logPath: string;
  durationMs: number;
  snapshot?: string;
  hint?: string;
}

export class DocumentsService {
  /** Builds of the same file share <dir>/.build/<name>/, so they run one after another. */
  private readonly builds = new KeyedQueue();

  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
    private readonly opener: Opener,
  ) {}

  /**
   * Compile a .tex file next to itself. Aux files go to <dir>/.build/<name>/, the PDF is copied to
   * <dir>/<name>.pdf, and a successful build is snapshotted into <dir>/.history/.
   */
  async compile(input: string, opts: { maxPages?: number } = {}): Promise<CompileResult> {
    const texPath = this.ws.resolveAllowed(input, ROOTS.texSource);
    if (extname(texPath).toLowerCase() !== ".tex") {
      throw new EzError(ErrorCode.BadRequest, `Not a .tex file: ${input}`);
    }
    const key = process.platform === "win32" ? texPath.toLowerCase() : texPath;
    return this.builds.run(key, () => this.build(texPath, opts));
  }

  private async build(texPath: string, opts: { maxPages?: number }): Promise<CompileResult> {
    await stat(texPath).catch(() => {
      throw new EzError(ErrorCode.NotFound, `File not found: ${texPath}`);
    });
    const config = await this.ws.readConfig();
    const { engine, from: engineFrom } = await pickEngine(texPath, config.tex.engine);

    const name = basename(texPath, extname(texPath));
    const dir = dirname(texPath);
    const outDir = join(dir, ".build", name);
    await mkdir(outDir, { recursive: true });
    await rm(join(outDir, `${name}.pdf`), { force: true });

    const started = Date.now();
    const engineRun = await engine.compile({
      texPath,
      outDir,
      searchPaths: [this.ws.path("templates", "resume"), this.ws.path("templates", "cover")],
      timeoutMs: config.tex.timeoutSeconds * 1000,
      latexmkFlags: config.tex.latexmkFlags,
    });
    const durationMs = Date.now() - started;
    const diagnostics = parseTexLog(engineRun.logText);
    const logPath = join(outDir, `${name}.log`);
    const built = await stat(engineRun.pdfPath).then(
      () => true,
      () => false,
    );
    const failed = engineRun.timedOut || engineRun.exitCode !== 0 || !built;
    this.log.info({ engine: engine.id, engineFrom, name, ok: !failed, durationMs }, "tex compile");

    if (failed) {
      const hint = engineRun.timedOut
        ? `Compilation exceeded ${config.tex.timeoutSeconds}s. Look for an infinite loop or a package prompting for input.`
        : diagnostics.some((d) => d.severity === "error")
          ? "Fix the first error (errors cascade), then recompile."
          : `The engine produced no PDF and no parsable error. Output tail:\n${engineRun.output.slice(-1500)}`;
      return { ok: false, engine: engine.id, engineFrom, diagnostics, logPath, durationMs, hint };
    }

    const pdf = join(dir, `${name}.pdf`);
    await writeFileAtomic(pdf, new Uint8Array(await readFile(engineRun.pdfPath)));
    const pages = (await pdfInfo(pdf)).pages;
    const pageLimit = opts.maxPages ?? pageLimitOf(name, config.resume.pageLimit);
    const pageLimitExceeded = pageLimit !== undefined && pages > pageLimit;
    const overflow = pageLimitExceeded ? await overflowOf(pdf, pageLimit, pages) : undefined;
    // Over the limit, the cuts come first and will move every line: lint what fits.
    const { lint, freeLines } = pageLimitExceeded ? { lint: [] } : await lintOf(pdf, pageLimit);
    const snapshot = await this.snapshot(dir, [texPath, pdf]);

    return {
      ok: true,
      engine: engine.id,
      engineFrom,
      pdf,
      pages,
      ...(pageLimit !== undefined ? { pageLimit, pageLimitExceeded } : {}),
      ...(overflow ? { overflow } : {}),
      ...(lint.length ? { lint } : {}),
      ...(freeLines !== undefined ? { freeLines } : {}),
      diagnostics,
      logPath,
      durationMs,
      snapshot,
      ...(pageLimitExceeded
        ? {
            hint:
              `The document is ${pages} pages; the limit is ${pageLimit}. ${overflow ? `${overflow.lines} lines run past it (overflow.text). ` : ""}` +
              "Cut about that much: tighten wording or drop the weakest content. Do not shrink fonts or margins.",
          }
        : lint.some((i) => i.kind === "underfilled")
          ? {
              // Named first and on its own: given only "N layout issues", an agent fixed a short line by cutting
              // words and sent a letter with a third of the page empty to review.
              hint:
                `About ${freeLines} lines are free on the last page: add about that much evidence first, then the ` +
                "rest of `lint`. review_documents refuses an underfilled document unless `short` gives the reason " +
                "for a shorter one. Fill it with content, never with larger fonts or spacing.",
            }
          : lint.length
            ? {
                hint:
                  `${lint.length} layout issue${lint.length === 1 ? "" : "s"} in \`lint\`. Fix them in the text, then recompile. ` +
                  "Do not shrink fonts or margins.",
              }
            : {}),
    };
  }

  /**
   * Apply exact replacements to a .tex file, then compile it. Each `old` must occur exactly once in the text as it is
   * after the edits before it, and differ from its `new`; otherwise nothing is written and the error names the edit.
   * Line endings follow the file's, so an edit written with `\n` matches a file saved with `\r\n`. The result is the
   * compile's, with each changed passage and a line on each side (`changed`), so the agent checks the passage in its
   * surroundings without reading the file again.
   *
   * *Why a tool:* scripted edits (python, sed, PowerShell `-replace`) missed LaTeX's backslashes or corrupted them
   * (`"\t"` in `"\textbf"` becomes a tab), and an agent's own edit tool isn't the same in every agent. JSON arguments
   * carry backslashes as they are.
   */
  async edit(
    input: string,
    edits: { old: string; new: string }[],
  ): Promise<CompileResult & { changed: ChangedPassage[] }> {
    const texPath = this.ws.resolveAllowed(input, ROOTS.texSource);
    if (extname(texPath).toLowerCase() !== ".tex") throw new EzError(ErrorCode.BadRequest, `Not a .tex file: ${input}`);
    const original = await readFile(texPath, "utf8").catch(() => {
      throw new EzError(ErrorCode.NotFound, `File not found: ${texPath}`);
    });
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const withEol = (s: string) => s.replace(/\r?\n/g, eol);
    let text = original;
    const at: [number, number][] = [];
    edits.forEach((e, i) => {
      const from = withEol(e.old);
      const to = withEol(e.new);
      const n = `Edit ${i + 1}`;
      if (!from) throw new EzError(ErrorCode.BadRequest, `${n}: old is empty.`);
      if (from === to) {
        throw new EzError(ErrorCode.BadRequest, `${n}: new is the same as old.`, "Write the change you meant to make.");
      }
      const first = text.indexOf(from);
      if (first < 0) {
        throw new EzError(
          ErrorCode.BadRequest,
          `${n}: old isn't in the file${i > 0 ? " (after the edits before it)" : ""}. Nothing was changed.`,
          "Copy old from the .tex as it is now, never from pdf_text or lint (the PDF drops escapes and spacing).",
        );
      }
      if (text.indexOf(from, first + 1) >= 0) {
        throw new EzError(
          ErrorCode.BadRequest,
          `${n}: old occurs more than once. Nothing was changed.`,
          "Make old longer, with the words around it, so it matches one place.",
        );
      }
      text = text.slice(0, first) + to + text.slice(first + from.length);
      // The passages changed before move with this edit when they come after it.
      const delta = to.length - from.length;
      for (const r of at) {
        if (r[0] >= first + from.length) {
          r[0] += delta;
          r[1] += delta;
        }
      }
      at.push([first, first + to.length]);
    });
    await writeFileAtomic(texPath, text);
    const changed = at.map(([start, end]) => passage(text, start, end));
    return { ...(await this.compile(texPath)), changed };
  }

  /** latexdiff old vs new, compiled to <new>-diff.pdf. */
  async diff(oldInput: string, newInput: string): Promise<CompileResult & { diffTex: string }> {
    const oldTex = this.ws.resolveAllowed(oldInput, ROOTS.texSource);
    const newTex = this.ws.resolveAllowed(newInput, ROOTS.texSource);
    if (!which("latexdiff")) {
      throw new EzError(
        ErrorCode.NotFound,
        "latexdiff is not installed.",
        "Install it with the TeX distribution's package manager (it needs Perl). Meanwhile, describe the changes in chat.",
      );
    }
    const r = await run("latexdiff", ["--flatten", oldTex, newTex], {
      cwd: dirname(newTex),
      timeoutMs: 60_000,
      maxOutputBytes: 8 * 1024 * 1024,
    });
    if (r.exitCode !== 0) {
      throw new EzError(ErrorCode.Internal, `latexdiff failed: ${r.stderr.slice(-1000)}`);
    }
    const diffTex = join(dirname(newTex), `${basename(newTex, ".tex")}-diff.tex`);
    await writeFile(diffTex, r.stdout, "utf8");
    const result = await this.compile(diffTex, { maxPages: 99 });
    return { ...result, diffTex };
  }

  pdfPath(input: string, purpose: "read" | "write" | "images" | "open"): string {
    const roots = {
      read: ROOTS.pdfRead,
      write: ROOTS.pdfWrite,
      images: ROOTS.images,
      open: ROOTS.open,
    }[purpose];
    return this.ws.resolveAllowed(input, roots);
  }

  async info(input: string) {
    return pdfInfo(this.pdfPath(input, "read"));
  }

  async text(input: string, pages?: string) {
    return pdfText(this.pdfPath(input, "read"), pages);
  }

  async merge(inputs: MergeInput[], output: string, opts: MergeOptions) {
    const resolved = inputs.map((i) => ({ ...i, path: this.pdfPath(i.path, "read") }));
    const out = this.pdfPath(output, "write");
    if (extname(out).toLowerCase() !== ".pdf") throw new EzError(ErrorCode.BadRequest, "Output must end in .pdf");
    const result = await pdfMerge(resolved, out, opts);
    const snapshot = await this.snapshot(dirname(out), [out]);
    return { ...result, snapshot };
  }

  async fromImages(images: string[], output: string, pageSize: PageSizeName) {
    return pdfFromImages(
      images.map((i) => this.pdfPath(i, "images")),
      this.pdfPath(output, "write"),
      pageSize,
    );
  }

  async compress(input: string, output: string | undefined, targetBytes: number | undefined) {
    const src = this.pdfPath(input, "read");
    const dest = this.pdfPath(output ?? input, "write");
    const target = targetBytes ?? (await this.ws.readConfig()).pdf.defaultMaxBytes;
    return pdfCompress(src, dest, target);
  }

  /** `openedIn`: the browser it opened in, or `default` (the file's default application). */
  async open(input: string): Promise<{ opened: string; openedIn: string }> {
    const path = this.pdfPath(input, "open");
    return { opened: path, openedIn: await this.opener.file(path) };
  }

  /** Copy files into <dir>/.history/<timestamp>/ and prune old snapshots. */
  private async snapshot(dir: string, files: string[]): Promise<string> {
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(dir, ".history", id);
    await mkdir(target, { recursive: true });
    for (const f of files) await copyFile(f, join(target, basename(f)));
    const all = (await readdir(join(dir, ".history"))).sort();
    for (const old of all.slice(0, Math.max(0, all.length - HISTORY_KEEP))) {
      await rm(join(dir, ".history", old), { recursive: true, force: true });
    }
    return join(".history", id);
  }
}

/** A passage `tex_edit` changed: its first line number and its lines, with one on each side. */
interface ChangedPassage {
  line: number;
  text: string;
}

/** The lines from `start` to `end` in `text` (character offsets), with one line on each side. */
function passage(text: string, start: number, end: number): ChangedPassage {
  const lines = text.split(/\r?\n/);
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length - 1;
  const from = Math.max(0, lineOf(start) - 1);
  const to = Math.min(lines.length - 1, lineOf(Math.max(start, end - 1)) + 1);
  return { line: from + 1, text: lines.slice(from, to + 1).join("\n") };
}

/**
 * The engine for one file: its `% !TEX program` comment, else tex.engine, else the first installed engine
 * in AUTO_ORDER. A comment naming a missing or unknown engine is an error, never a fallback: another
 * engine can change fonts and the page count.
 */
async function pickEngine(
  texPath: string,
  configured: EngineId | "auto",
): Promise<{ engine: TexEngine; from: EngineSource }> {
  const program = readTexProgram(await readFile(texPath, "utf8"));
  if (program) {
    if (!program.engine) throw unknownProgram(program, texPath);
    const engine = ENGINES[program.engine];
    if (!(await engine.available())) throw missingProgram(program, texPath);
    return { engine, from: "magic-comment" };
  }
  const engine = await resolveEngine(configured);
  if (!engine) throw noEngine(configured);
  return { engine, from: configured === "auto" ? "auto" : "config" };
}

function unknownProgram(program: TexProgram, texPath: string): EzError {
  const driver = program.value.toLowerCase() === "latexmk" ? " latexmk is a build driver, not an engine." : "";
  return new EzError(
    ErrorCode.BadRequest,
    `Unknown TeX program "${program.value}" in the % !TEX program comment on line ${program.line} of ${basename(texPath)}.`,
    `Name one of ${PROGRAM_ENGINES.join(", ")}.${driver} Or remove the comment to use tex.engine from ezapply.config.json.`,
  );
}

function missingProgram(program: TexProgram, texPath: string): EzError {
  const install =
    program.engine === "tectonic"
      ? "Ask the user to install Tectonic (https://tectonic-typesetting.github.io)."
      : `MiKTeX and TeX Live both include ${program.engine}. ${installHint("tex")}`;
  return new EzError(
    ErrorCode.NotFound,
    `${program.engine} is not installed (named by the % !TEX program comment on line ${program.line} of ${basename(texPath)}).`,
    `${install} Don't change or remove the comment to build with another engine: fonts and the page count can change.`,
  );
}

/**
 * The text on the pages past the limit, so the agent can size its cuts in one go: a live resume took five
 * compiles, partly because the result said only "2 pages" and not that three lines had spilled over.
 */
async function overflowOf(pdf: string, limit: number, pages: number): Promise<CompileResult["overflow"]> {
  const extra = await pdfText(pdf, `${limit + 1}-${pages}`).catch(() => null);
  if (!extra) return undefined;
  const text = extra.map((p) => p.text).join("\n");
  const lines = text.split("\n").filter((l) => l.trim()).length;
  return { lines, text: text.length > 400 ? `${text.slice(0, 400)}…` : text };
}

/**
 * The layout checks and the free lines on the last page; a document the checks can't read is reported as having
 * no issues, never as a failed build.
 */
async function lintOf(
  pdf: string,
  pageLimit: number | undefined,
): Promise<{ lint: LayoutIssue[]; freeLines?: number }> {
  const pages = await pdfLines(pdf).catch(() => null);
  if (!pages) return { lint: [] };
  const last = pages[pages.length - 1];
  const free = last ? freeLines(last) : undefined;
  return {
    lint: lintLayout(pages, pageLimit === undefined ? {} : { pageLimit }),
    ...(free !== undefined ? { freeLines: free } : {}),
  };
}

function noEngine(configured: EngineId | "auto"): EzError {
  const looked = configured === "auto" ? Object.keys(ENGINES).join(", ") : configured;
  return new EzError(
    ErrorCode.NotFound,
    `No usable TeX engine found (looked for: ${looked}).`,
    `${installHint("tex")} If a specific engine is configured in ezapply.config.json, set tex.engine to "auto".`,
  );
}
