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
import type { PageSizeName } from "./pdf/pages.js";
import {
  type MergeInput,
  type MergeOptions,
  pdfCompress,
  pdfFromImages,
  pdfInfo,
  pdfMerge,
  pdfRender,
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
export type EngineSource = "magic-comment" | "config" | "auto";

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
    const pageLimit = opts.maxPages ?? (/resume|cv/i.test(name) ? config.resume.pageLimit : undefined);
    const pageLimitExceeded = pageLimit !== undefined && pages > pageLimit;
    const overflow = pageLimitExceeded ? await overflowOf(pdf, pageLimit, pages) : undefined;
    const snapshot = await this.snapshot(dir, [texPath, pdf]);

    return {
      ok: true,
      engine: engine.id,
      engineFrom,
      pdf,
      pages,
      ...(pageLimit !== undefined ? { pageLimit, pageLimitExceeded } : {}),
      ...(overflow ? { overflow } : {}),
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
        : {}),
    };
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

  /** Render a page to PNG and keep a copy in <dir>/.previews/ for the user. */
  async render(input: string, page: number, scale: number): Promise<{ png: Buffer; savedTo: string }> {
    const path = this.pdfPath(input, "read");
    const png = await pdfRender(path, page, scale);
    const savedTo = join(dirname(path), ".previews", `${basename(path, ".pdf")}-p${page}.png`);
    await mkdir(dirname(savedTo), { recursive: true });
    await writeFile(savedTo, png);
    return { png, savedTo };
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

function noEngine(configured: EngineId | "auto"): EzError {
  const looked = configured === "auto" ? Object.keys(ENGINES).join(", ") : configured;
  return new EzError(
    ErrorCode.NotFound,
    `No usable TeX engine found (looked for: ${looked}).`,
    `${installHint("tex")} If a specific engine is configured in ezapply.config.json, set tex.engine to "auto".`,
  );
}
