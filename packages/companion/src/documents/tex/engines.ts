import { readFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { run, which } from "../../util/proc.js";

const ENGINE_IDS = ["latexmk", "xelatex", "lualatex", "pdflatex", "tectonic"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** Preference order for engine "auto". pdflatex is excluded: it cannot load system fonts. */
const AUTO_ORDER: readonly EngineId[] = ["latexmk", "xelatex", "lualatex", "tectonic"];

/**
 * Engines a `% !TEX program = …` comment may name. latexmk is left out: it is a build driver, and the
 * comment would not say which engine it should drive.
 */
export const PROGRAM_ENGINES: readonly EngineId[] = ["pdflatex", "xelatex", "lualatex", "tectonic"];

/** TeXShop and TeXstudio read the magic comment from the first 20 lines only. */
const PROGRAM_LINES = 20;
// `% !TEX program = x` (TeXstudio, VS Code) and `% !TEX TS-program = x` (TeXShop), any case.
const PROGRAM_RE = /^\s*%+\s*!\s*TeX\s+(?:TS-)?program\s*=\s*(.*?)\s*$/i;

export interface TexProgram {
  /** The value as written. */
  value: string;
  /** 1-based line number. */
  line: number;
  /** The engine it names, or null when the value is not one of PROGRAM_ENGINES. */
  engine: EngineId | null;
}

/** The first `% !TEX program` comment in the first 20 lines of a .tex source, if any. */
export function readTexProgram(source: string): TexProgram | null {
  const lines = source.replace(/^﻿/, "").split(/\r?\n/, PROGRAM_LINES);
  for (const [i, text] of lines.entries()) {
    const m = PROGRAM_RE.exec(text);
    if (!m) continue;
    const value = m[1] ?? "";
    const id = value.toLowerCase();
    const engine = PROGRAM_ENGINES.find((e) => e === id) ?? null;
    return { value, line: i + 1, engine };
  }
  return null;
}

/**
 * The engine a source needs when it says nothing: pdflatex for sources that use pdfTeX-only commands
 * (`\pdfgentounicode`, `glyphtounicode`) and don't load fontspec. Such templates fail under XeLaTeX, and
 * even when guarded they get different font metrics there, which can change the page count.
 */
export function detectTexProgram(source: string): { engine: EngineId; reason: string } | null {
  const pdftex = /\\pdfgentounicode|\\pdfglyphtounicode|\\input\s*\{?\s*glyphtounicode/.exec(source);
  if (!pdftex || /\{fontspec\}|\\setmainfont/.test(source)) return null;
  return { engine: "pdflatex", reason: `it uses the pdfTeX-only \`${pdftex[0]}\`` };
}

/** `source` with `% !TEX program = <engine>` as its first line (after any BOM), keeping its line endings. */
export function withTexProgram(source: string, engine: EngineId): string {
  const bom = source.startsWith("﻿") ? "﻿" : "";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return `${bom}% !TEX program = ${engine}${eol}${source.slice(bom.length)}`;
}

interface CompileRequest {
  texPath: string;
  outDir: string;
  /** Extra folders searched for .cls/.sty/images (templates). The .tex's own folder is always searched. */
  searchPaths: string[];
  timeoutMs: number;
  /** Engine flags for latexmk, e.g. ["-xelatex"]. */
  latexmkFlags: string[];
}

export interface EngineRun {
  engine: EngineId;
  exitCode: number | null;
  timedOut: boolean;
  logText: string;
  pdfPath: string;
  /** Tail of stdout/stderr, for failures that never reach the log (missing binaries, perl). */
  output: string;
}

export interface TexEngine {
  id: EngineId;
  available(): Promise<boolean>;
  compile(req: CompileRequest): Promise<EngineRun>;
}

type Distro = "miktex" | "texlive" | "unknown";
let distroCache: Promise<Distro> | undefined;

/**
 * MiKTeX and TeX Live spell some options differently. Only a definite answer is remembered: an `ezapply`
 * started before TeX was installed finds out once it is.
 */
function distro(): Promise<Distro> {
  distroCache ??= (async () => {
    const bin = ["xelatex", "lualatex", "pdflatex"].find((b) => which(b));
    if (!bin) return "unknown";
    const r = await run(bin, ["--version"], { timeoutMs: 15_000 }).catch(() => null);
    const text = `${r?.stdout ?? ""}${r?.stderr ?? ""}`;
    return /MiKTeX/i.test(text) ? "miktex" : /TeX Live/i.test(text) ? "texlive" : "unknown";
  })().then((d) => {
    if (d === "unknown") distroCache = undefined;
    return d;
  });
  return distroCache;
}

async function safetyArgs(): Promise<string[]> {
  // Shell escape is always off: posting text ends up in .tex files.
  return (await distro()) === "miktex" ? ["--disable-write18", "--max-print-line=10000"] : ["-no-shell-escape"];
}

function texEnv(req: CompileRequest): NodeJS.ProcessEnv {
  const paths = [dirname(req.texPath), ...req.searchPaths];
  return {
    ...process.env,
    // Trailing separator keeps the distribution's default search path.
    TEXINPUTS: `${paths.join(delimiter)}${delimiter}`,
    max_print_line: "10000",
    error_line: "254",
    half_error_line: "238",
  };
}

async function readLog(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8"); // XeTeX/LuaTeX write UTF-8 logs
  } catch {
    return "";
  }
}

function jobName(texPath: string): string {
  return basename(texPath).replace(/\.tex$/i, "");
}

class LatexmkEngine implements TexEngine {
  readonly id = "latexmk" as const;
  private ok: Promise<boolean> | undefined;

  async available(): Promise<boolean> {
    if (!which("latexmk")) return false;
    // latexmk is a Perl script; being on PATH is not enough if Perl is missing. Remember only success,
    // so installing Perl or TeX later is picked up.
    this.ok ??= run("latexmk", ["-v"], { timeoutMs: 15_000 })
      .then((r) => r.exitCode === 0)
      .catch(() => false);
    const ok = await this.ok;
    if (!ok) this.ok = undefined;
    return ok;
  }

  async compile(req: CompileRequest): Promise<EngineRun> {
    const safety = await safetyArgs();
    const args = [
      ...req.latexmkFlags,
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      `-outdir=${req.outDir}`,
      ...safety.map((a) => `-latexoption=${a}`),
      basename(req.texPath),
    ];
    const r = await run("latexmk", args, { cwd: dirname(req.texPath), env: texEnv(req), timeoutMs: req.timeoutMs });
    const name = jobName(req.texPath);
    return {
      engine: this.id,
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      logText: await readLog(join(req.outDir, `${name}.log`)),
      pdfPath: join(req.outDir, `${name}.pdf`),
      output: `${r.stdout}\n${r.stderr}`.slice(-4000),
    };
  }
}

/** Runs the engine directly, repeating while the log asks for a rerun (max 3 passes). */
class DirectEngine implements TexEngine {
  constructor(readonly id: "xelatex" | "lualatex" | "pdflatex") {}

  async available(): Promise<boolean> {
    return which(this.id) !== null;
  }

  async compile(req: CompileRequest): Promise<EngineRun> {
    const safety = await safetyArgs();
    const name = jobName(req.texPath);
    const args = [
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      `-output-directory=${req.outDir}`,
      ...safety,
      basename(req.texPath),
    ];
    let last: EngineRun | undefined;
    for (let pass = 1; pass <= 3; pass++) {
      const r = await run(this.id, args, { cwd: dirname(req.texPath), env: texEnv(req), timeoutMs: req.timeoutMs });
      const logText = await readLog(join(req.outDir, `${name}.log`));
      last = {
        engine: this.id,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        logText,
        pdfPath: join(req.outDir, `${name}.pdf`),
        output: `${r.stdout}\n${r.stderr}`.slice(-4000),
      };
      if (r.exitCode !== 0 || r.timedOut || !/Rerun to get|Label\(s\) may have changed/i.test(logText)) break;
    }
    return last as EngineRun;
  }
}

class TectonicEngine implements TexEngine {
  readonly id = "tectonic" as const;

  async available(): Promise<boolean> {
    return which("tectonic") !== null;
  }

  async compile(req: CompileRequest): Promise<EngineRun> {
    // Tectonic never enables shell escape unless asked, and ignores TEXINPUTS.
    const args = [
      "-X",
      "compile",
      basename(req.texPath),
      "--outdir",
      req.outDir,
      "--keep-logs",
      ...[dirname(req.texPath), ...req.searchPaths].flatMap((p) => ["-Z", `search-path=${p}`]),
    ];
    const r = await run("tectonic", args, { cwd: dirname(req.texPath), timeoutMs: req.timeoutMs });
    const name = jobName(req.texPath);
    return {
      engine: this.id,
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      logText: await readLog(join(req.outDir, `${name}.log`)),
      pdfPath: join(req.outDir, `${name}.pdf`),
      output: `${r.stdout}\n${r.stderr}`.slice(-4000),
    };
  }
}

export const ENGINES: Record<EngineId, TexEngine> = {
  latexmk: new LatexmkEngine(),
  xelatex: new DirectEngine("xelatex"),
  lualatex: new DirectEngine("lualatex"),
  pdflatex: new DirectEngine("pdflatex"),
  tectonic: new TectonicEngine(),
};

/** Resolve a configured engine name ("auto" or a specific id) to an installed engine. */
export async function resolveEngine(configured: EngineId | "auto"): Promise<TexEngine | null> {
  if (configured !== "auto") return (await ENGINES[configured].available()) ? ENGINES[configured] : null;
  for (const id of AUTO_ORDER) if (await ENGINES[id].available()) return ENGINES[id];
  return null;
}
