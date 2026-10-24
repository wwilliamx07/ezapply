import { copyFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, sep } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";
import { detectTexProgram, readTexProgram, withTexProgram } from "../documents/tex/engines.js";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import { hashFiles } from "../util/hash.js";
import type { Workspace } from "../workspace/workspace.js";

export type TemplateKind = "resume" | "cover";

/** templates/<kind>/template.json: which file is the entry point. */
const TemplateMeta = z.object({
  schemaVersion: z.literal(1),
  main: z.string().regex(/\.tex$/i),
  /** default: shipped by ezapply, replaceable without asking. imported: the user's LaTeX. custom: made or edited by Claude. */
  origin: z.enum(["default", "imported", "custom"]).optional(),
  /**
   * .tex files the main file pulls in with \input, \include or \subfile, relative to the main file's folder.
   * Their text is part of the document (a resume's sections/experience.tex), so tailoring copies them
   * into the posting folder beside the main file.
   */
  contentFiles: z.array(z.string()).optional(),
  /** A sample letter the layout was drawn from, relative to templates/<kind>/. */
  example: z.string().optional(),
  importedFrom: z.string().optional(),
  importedAt: z.string().optional(),
  /**
   * Hash of the files in `importedFrom` (what an import would copy: a folder's files, or the one file) when the template was last current with
   * it: written by template_import, or when the user keeps the workspace copy of a change there (it
   * doesn't need a re-import). The workspace check compares it with the folder as it is now.
   */
  sourceHash: z.string().optional(),
});
type TemplateMeta = z.infer<typeof TemplateMeta>;

const AUX_FILE = /\.(aux|log|out|toc|fls|fdb_latexmk|synctex\.gz|xdv|bbl|blg|bcf|run\.xml|nav|snm)$/i;
const SKIP_DIRS = new Set([".git", ".build", ".history", ".previews", "node_modules", "__MACOSX"]);
const IMPORT_MAX_FILES = 400;
const IMPORT_MAX_BYTES = 60 * 1024 * 1024;
const EXAMPLE_MAX_BYTES = 20 * 1024 * 1024;
/** Sample letters Claude can read: PDFs and text through the documents tools, images directly. */
const EXAMPLE_KINDS: Record<string, "pdf" | "image" | "text"> = {
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".txt": "text",
  ".md": "text",
};

/**
 * The resume and cover letter templates in templates/<kind>/: importing the user's LaTeX, sample letters,
 * the entry point and the files it pulls in, and the engine a template needs.
 */
export class TemplateService {
  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
  ) {}

  /**
   * Copy a LaTeX project, or a single .tex file, into templates/<kind>/. Build artifacts and VCS folders
   * are skipped. An existing template is moved to templates/.old/ rather than overwritten; replacing one
   * the user has needs `replace`, replacing ezapply's shipped default does not. The source is recorded so
   * the workspace check notices when the user edits it, so it must be the user's own copy: a folder or file
   * outside the workspace, or one they keep in library/.
   */
  async importTemplate(input: { source: string; kind: TemplateKind; main?: string; replace?: boolean }): Promise<{
    folder: string;
    main: string;
    files: string[];
    contentFiles?: string[];
    previous?: string;
    texProgram?: { engine: string; added: boolean; note?: string };
  }> {
    if (!isAbsolute(input.source)) {
      throw new EzError(
        ErrorCode.BadRequest,
        "source must be an absolute path.",
        "Ask the user for the full path of the folder or .tex file.",
      );
    }
    const src = input.source;
    const srcStat = await stat(src).catch(() => null);
    if (!srcStat?.isDirectory() && !srcStat?.isFile()) throw new EzError(ErrorCode.NotFound, `Not found: ${src}`);
    const within = relative(this.ws.root, src);
    if (!within.startsWith("..") && !isAbsolute(within) && !`${within}${sep}`.startsWith(`library${sep}`)) {
      throw new EzError(
        ErrorCode.BadRequest,
        "source is inside the workspace, outside library/.",
        "Import from the user's own folder or file, or from one they keep in library/.",
      );
    }
    if (inScratchpad(src)) {
      throw new EzError(
        ErrorCode.BadRequest,
        "source is in a Claude scratchpad: a copy the user never edits.",
        "Import from the user's own folder or .tex file (outside the workspace, or in library/), so their edits are noticed.",
      );
    }
    const single = srcStat.isFile();
    if (single && !src.toLowerCase().endsWith(".tex")) {
      throw new EzError(ErrorCode.BadRequest, `Not a .tex file: ${src}`, "Pass the .tex file or its folder.");
    }

    const { root, files } = await importable(src);
    const texFiles = files.filter((f) => f.toLowerCase().endsWith(".tex"));
    if (texFiles.length === 0) throw new EzError(ErrorCode.BadRequest, `No .tex files in ${src}`);
    const main = single ? files[0] : (input.main ?? (await detectMain(root, texFiles)));
    if (single && main && (await findContentFiles(root, main)).length) {
      // Copied alone, it would lose the sections it pulls in from beside it.
      throw new EzError(
        ErrorCode.BadRequest,
        `${main} pulls in other .tex files from its folder.`,
        "Import the folder that holds them instead.",
      );
    }
    if (!main || !texFiles.includes(main)) {
      throw new EzError(
        ErrorCode.BadRequest,
        `Could not tell which .tex file is the main document (candidates: ${texFiles.join(", ")}).`,
        "Ask the user which file to compile and pass it as `main`.",
      );
    }

    const dest = this.ws.path("templates", input.kind);
    let previous: string | undefined;
    const existing = await readdir(dest).catch(() => [] as string[]);
    if (existing.length > 0) {
      if (!input.replace && (await this.templateMeta(input.kind))?.origin !== "default") {
        throw new EzError(
          ErrorCode.BadRequest,
          `templates/${input.kind} already has files.`,
          "Confirm with the user, then call again with replace: true (the old template is kept in templates/.old/).",
        );
      }
      previous = this.ws.path("templates", ".old", `${input.kind}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(this.ws.path("templates", ".old"), { recursive: true });
      await rename(dest, previous);
    }
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await mkdir(join(dest, f, ".."), { recursive: true });
      await cp(join(root, f), join(dest, f));
    }
    const texProgram = await ensureTexProgram(join(dest, main));
    const contentFiles = await findContentFiles(dest, main);
    const meta: TemplateMeta = {
      schemaVersion: 1,
      main,
      origin: "imported",
      ...(contentFiles.length ? { contentFiles } : {}),
      importedFrom: src,
      importedAt: new Date().toISOString(),
      sourceHash: await hashFiles(root, files),
    };
    await writeJsonAtomic(join(dest, "template.json"), meta);
    this.log.info({ kind: input.kind, files: files.length, contentFiles: contentFiles.length }, "template imported");
    return {
      folder: dest,
      main: join(dest, main),
      files,
      ...(contentFiles.length ? { contentFiles } : {}),
      ...(previous ? { previous } : {}),
      ...(texProgram ? { texProgram } : {}),
    };
  }

  /**
   * Copy a sample cover letter (PDF, image or text) into templates/cover/example/ so Claude can read it
   * and rebuild the template in its layout. Word and other formats must be exported to PDF first.
   */
  async importExample(input: { sourcePath: string }): Promise<{
    path: string;
    format: "pdf" | "image" | "text";
    previous?: string;
  }> {
    if (!isAbsolute(input.sourcePath)) {
      throw new EzError(
        ErrorCode.BadRequest,
        "sourcePath must be an absolute path.",
        "Ask the user for the full path.",
      );
    }
    const src = input.sourcePath;
    const srcStat = await stat(src).catch(() => null);
    if (!srcStat?.isFile()) throw new EzError(ErrorCode.NotFound, `Not a file: ${src}`);
    const ext = extname(src).toLowerCase();
    const format = EXAMPLE_KINDS[ext];
    if (!format) {
      throw new EzError(
        ErrorCode.BadRequest,
        `Can't read ${ext || "extensionless"} files as an example.`,
        "Ask the user to export it as a PDF (in Word: File → Save As → PDF) and pass that path, or send a screenshot.",
      );
    }
    if (srcStat.size > EXAMPLE_MAX_BYTES) {
      throw new EzError(ErrorCode.BadRequest, `${src} is larger than ${EXAMPLE_MAX_BYTES / 1024 / 1024} MB.`);
    }

    const dir = this.ws.path("templates", "cover", "example");
    let previous: string | undefined;
    const existing = (await readdir(dir).catch(() => [] as string[])).filter((f) => !f.startsWith("."));
    if (existing.length > 0) {
      previous = this.ws.path("templates", ".old", `cover-example-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(this.ws.path("templates", ".old"), { recursive: true });
      await rename(dir, previous);
    }
    await mkdir(dir, { recursive: true });
    const name = basename(src);
    await copyFile(src, join(dir, name));

    const cur = await this.templateMeta("cover");
    if (cur)
      await writeJsonAtomic(this.ws.path("templates", "cover", "template.json"), {
        ...cur,
        example: `example/${name}`,
      });
    this.log.info({ format }, "cover example imported");
    return { path: join(dir, name), format, ...(previous ? { previous } : {}) };
  }

  /**
   * The folder or file an imported template came from, as it is now: its hash next to the one recorded, and
   * for a template imported before `sourceHash` existed, whether it still matches the workspace copy. Null
   * for a template that wasn't imported; `unreadable` when the source is gone or can't be listed.
   */
  async sourceState(
    kind: TemplateKind,
  ): Promise<
    | null
    | { from: string; unreadable: string }
    | { from: string; hash: string; recorded: string | null; matchesCopy?: boolean }
  > {
    const meta = await this.templateMeta(kind);
    if (!meta?.importedFrom) return null;
    const from = meta.importedFrom;
    let source: { root: string; files: string[] };
    try {
      source = await importable(from);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return { from, unreadable: code === "ENOENT" ? "not found" : (err as Error).message };
    }
    const hash = await hashFiles(source.root, source.files);
    if (meta.sourceHash) return { from, hash, recorded: meta.sourceHash };
    return {
      from,
      hash,
      recorded: null,
      matchesCopy: await this.copyMatches(kind, meta.main, source.root, source.files),
    };
  }

  /** Record that templates/<kind>/ is current with its source as it hashes now. */
  async setSourceHash(kind: TemplateKind, sourceHash: string): Promise<void> {
    const meta = await this.templateMeta(kind);
    if (!meta) throw new EzError(ErrorCode.NotFound, `templates/${kind} has no template.json.`);
    await writeJsonAtomic(this.ws.path("templates", kind, "template.json"), { ...meta, sourceHash });
  }

  /**
   * Stop watching a template's source: drops `importedFrom` and `sourceHash`. For a template imported from a
   * copy nobody edits (a scratchpad) when the user keeps no file of their own.
   */
  async forgetSource(kind: TemplateKind): Promise<void> {
    const meta = await this.templateMeta(kind);
    if (!meta) throw new EzError(ErrorCode.NotFound, `templates/${kind} has no template.json.`);
    const { importedFrom: _, sourceHash: __, ...rest } = meta;
    await writeJsonAtomic(this.ws.path("templates", kind, "template.json"), rest);
  }

  /**
   * The LaTeX documents in library/ (a .tex file with both \documentclass and \begin{document}): the hash of
   * the file and the .tex files it pulls in, which template was imported from it (the file, or a folder
   * holding it), and which template's main file has the same text. The workspace check reports the ones
   * that are neither: a resume or cover letter the user dropped there and never imported.
   */
  async libraryDocuments(): Promise<LibraryDocument[]> {
    const lib = this.ws.path("library");
    const files = await listTex(lib).catch(() => [] as string[]);
    if (!files.length) return [];
    const metas = { resume: await this.templateMeta("resume"), cover: await this.templateMeta("cover") };
    const out: LibraryDocument[] = [];
    for (const rel of files) {
      const abs = join(lib, rel);
      const text = await readFile(abs, "utf8").catch(() => null);
      if (text === null || !/\\documentclass/.test(text) || !/\\begin\{document\}/.test(text)) continue;
      const dir = dirname(abs);
      const pulled = await findContentFiles(dir, basename(abs));
      const doc: LibraryDocument = {
        path: `library/${rel}`,
        abs,
        hash: await hashFiles(dir, [basename(abs), ...pulled]),
        pullsIn: pulled.length > 0,
      };
      for (const kind of ["resume", "cover"] as const) {
        const meta = metas[kind];
        if (!meta) continue;
        if (meta.importedFrom && contains(meta.importedFrom, abs)) doc.sourceOf = kind;
        const copy = await readFile(this.ws.path("templates", kind, meta.main), "utf8").catch(() => null);
        if (copy !== null && sameAsCopy(text, copy)) doc.copyOf = kind;
      }
      out.push(doc);
    }
    return out;
  }

  /**
   * Whether every file in the source is in templates/<kind>/ unchanged. The `% !TEX program` line an
   * import may add to the main file is left out of the comparison.
   */
  private async copyMatches(kind: TemplateKind, main: string, from: string, files: string[]): Promise<boolean> {
    for (const f of files) {
      const [src, copy] = await Promise.all([
        readFile(join(from, f), "utf8").catch(() => null),
        readFile(this.ws.path("templates", kind, f), "utf8").catch(() => null),
      ]);
      if (src === null || copy === null) return false;
      if (f === main ? !sameAsCopy(src, copy) : normText(src) !== normText(copy)) return false;
    }
    return true;
  }

  async templateMeta(kind: TemplateKind): Promise<TemplateMeta | null> {
    const raw = await readJson(this.ws.path("templates", kind, "template.json")).catch(() => null);
    const parsed = TemplateMeta.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /** Main .tex of a template, or null if none is set up. */
  async templateMain(kind: TemplateKind): Promise<string | null> {
    const meta = await this.templateMeta(kind);
    return meta ? this.ws.path("templates", kind, meta.main) : null;
  }

  /**
   * Record the entry point (and the content files it pulls in). A template Claude reworks stops being the
   * shipped default. `main` comes from Claude, so it must resolve inside templates/<kind>/.
   */
  async setTemplateMain(kind: TemplateKind, main: string): Promise<{ main: string; contentFiles: string[] }> {
    const folder = this.ws.path("templates", kind);
    const abs = this.ws.resolveAllowed(join(folder, main), [`templates/${kind}`]);
    if (extname(abs).toLowerCase() !== ".tex") throw new EzError(ErrorCode.BadRequest, `Not a .tex file: ${main}`);
    await stat(abs).catch(() => {
      throw new EzError(ErrorCode.NotFound, `templates/${kind}/${main} does not exist.`);
    });
    const rel = relative(folder, abs).split("\\").join("/");
    const contentFiles = await findContentFiles(folder, rel);
    const existing: TemplateMeta = (await this.templateMeta(kind)) ?? { schemaVersion: 1, main: rel };
    const { contentFiles: _, ...cur } = existing;
    await writeJsonAtomic(join(folder, "template.json"), {
      ...cur,
      schemaVersion: 1,
      main: rel,
      origin: cur.origin === "imported" ? "imported" : "custom",
      ...(contentFiles.length ? { contentFiles } : {}),
    });
    return { main: abs, contentFiles };
  }
}

interface LibraryDocument {
  /** Workspace-relative, with forward slashes (`library/resume.tex`). */
  path: string;
  abs: string;
  hash: string;
  /** It \inputs .tex files beside it, so an import takes its folder. */
  pullsIn: boolean;
  /** The template imported from this file or from a folder holding it. */
  sourceOf?: TemplateKind;
  /** The template whose main file has the same text. */
  copyOf?: TemplateKind;
}

/**
 * A path in a Claude Code scratchpad (`…/claude/<project>/<session>/scratchpad/…` under the temp folder): a
 * copy Claude made, which the user never edits, so watching it for their edits finds nothing.
 */
export function inScratchpad(path: string): boolean {
  return /[\\/]claude(?:-[^\\/]*)?[\\/](?:[^\\/]+[\\/])*scratchpad(?:[\\/]|$)/i.test(path);
}

/** Whether `inner` is `outer` or inside it. */
function contains(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const normText = (text: string) => text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

/** A source main file and its workspace copy are the same, apart from the `% !TEX program` line an import adds. */
function sameAsCopy(source: string, copy: string): boolean {
  const a = normText(source);
  const b = normText(copy);
  if (a === b) return true;
  return !readTexProgram(a) && !!readTexProgram(b) && a === b.replace(/^% !TEX program = \S+\n/, "");
}

/** .tex files under a folder, relative to it with forward slashes; hidden, build and VCS folders skipped; four levels, 200 files at most. */
async function listTex(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (out.length >= 200) return;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), relPath, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".tex")) out.push(relPath);
    }
  };
  await walk(root, "", 0);
  return out.sort();
}

/** What an import copies from `source`: a folder's files (build output skipped), or the one .tex file. */
async function importable(source: string): Promise<{ root: string; files: string[] }> {
  if ((await stat(source)).isFile()) return { root: dirname(source), files: [basename(source)] };
  return { root: source, files: await listImportable(source) };
}

async function listImportable(root: string): Promise<string[]> {
  const out: string[] = [];
  let bytes = 0;
  const walk = async (dir: string, rel: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relPath);
      } else if (entry.isFile() && !AUX_FILE.test(entry.name)) {
        bytes += (await stat(join(dir, entry.name))).size;
        out.push(relPath);
        if (out.length > IMPORT_MAX_FILES || bytes > IMPORT_MAX_BYTES) {
          throw new EzError(
            ErrorCode.BadRequest,
            `${root} is too large to import (over ${IMPORT_MAX_FILES} files or ${IMPORT_MAX_BYTES / 1024 / 1024} MB).`,
            "Point at the folder that holds just the resume/cover letter sources.",
          );
        }
      }
    }
  };
  await walk(root, "");
  return out.sort();
}

/**
 * The .tex files that `main` (relative to `root`) pulls in with \input, \include or \subfile, directly or
 * through each other, as paths relative to main's folder. Only files that exist inside `root` count, so
 * packages (\input{glyphtounicode}) and class files are left out.
 */
export async function findContentFiles(root: string, main: string): Promise<string[]> {
  const base = posix.dirname(main.split("\\").join("/"));
  const found = new Set<string>();
  const visit = async (rel: string, depth: number) => {
    if (depth > 5) return;
    const text = await readFile(join(root, base, rel), "utf8").catch(() => null);
    if (text === null) return;
    for (const name of inputsOf(text)) {
      for (const candidate of extname(name) ? [name] : [`${name}.tex`, name]) {
        const norm = posix.normalize(candidate);
        if (norm.startsWith("..") || posix.isAbsolute(norm) || !norm.toLowerCase().endsWith(".tex")) continue;
        if (found.has(norm)) break;
        const s = await stat(join(root, base, norm)).catch(() => null);
        if (!s?.isFile()) continue;
        found.add(norm);
        await visit(norm, depth + 1);
        break;
      }
    }
  };
  await visit(posix.basename(main), 0);
  return [...found].sort();
}

/** Arguments of \input{…}, \include{…} and \subfile{…} outside comments. */
function inputsOf(tex: string): string[] {
  const out: string[] = [];
  for (const line of tex.split(/\r?\n/)) {
    const code = line.replace(/(^|[^\\])%.*$/, "$1");
    for (const m of code.matchAll(/\\(?:input|include|subfile)\s*\{([^}]+)\}/g)) {
      const name = m[1]?.trim();
      if (name) out.push(name);
    }
  }
  return out;
}

/**
 * The engine an imported main file asks for with `% !TEX program`. A file without the comment that needs
 * pdflatex gets it added, so it and every tailored copy build with pdflatex whatever tex.engine says.
 */
async function ensureTexProgram(mainPath: string): Promise<{ engine: string; added: boolean; note?: string } | null> {
  const source = await readFile(mainPath, "utf8");
  const existing = readTexProgram(source);
  if (existing) return { engine: existing.value, added: false };
  const needed = detectTexProgram(source);
  if (!needed) return null;
  await writeFile(mainPath, withTexProgram(source, needed.engine), "utf8");
  return {
    engine: needed.engine,
    added: true,
    note: `Added \`% !TEX program = ${needed.engine}\` to ${basename(mainPath)} because ${needed.reason}. Tell the user.`,
  };
}

/** The main file is the one with both \documentclass and \begin{document}; prefer shallow, resume-ish names. */
async function detectMain(root: string, texFiles: string[]): Promise<string | undefined> {
  const candidates: string[] = [];
  for (const f of texFiles) {
    const text = await readFile(join(root, f), "utf8").catch(() => "");
    if (/\\documentclass/.test(text) && /\\begin\{document\}/.test(text)) candidates.push(f);
  }
  if (candidates.length <= 1) return candidates[0];
  const score = (f: string) => (f.includes("/") ? 10 : 0) + (/resume|cv|cover|letter|main/i.test(f) ? 0 : 5);
  const sorted = candidates.sort((a, b) => score(a) - score(b));
  return score(sorted[0] as string) < score(sorted[1] as string) ? sorted[0] : undefined;
}
