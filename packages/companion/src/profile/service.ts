import { copyFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { parseDocument, stringify } from "yaml";
import type { z } from "zod";
import { detectTexProgram, readTexProgram, withTexProgram } from "../documents/tex/engines.js";
import type { Logger } from "../logger.js";
import { readJson, type Workspace, writeJsonAtomic } from "../workspace/workspace.js";
import { type AnswerEntry, AnswersFile, missingProfileFields, Profile, ReposFile, TemplateMeta } from "./schema.js";
import { seedAnswers } from "./seed-answers.js";

export type TemplateKind = "resume" | "cover";

export interface Issue {
  path: string;
  message: string;
}

export type Checked<T> =
  | { exists: false }
  | { exists: true; valid: true; value: T }
  | { exists: true; valid: false; errors: Issue[] };

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

const ANSWERS_HEADER = `Screening-question answer bank. Used to fill application questions; Claude asks you when unsure.
  answer:     the confirmed answer ("Yes", "No", or text). null = ask me every time.
              { default: ..., byCompany: { "Acme": "Yes" } } for company-specific answers.
  suggested:  a proposed default. Not used on forms until copied into answer.
  sensitive:  always ask, even when an answer exists.
  variants:   other wordings of the same question seen on forms (Claude adds these).`;

export class ProfileService {
  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
  ) {}

  profile(): Promise<Checked<Profile>> {
    return this.readYaml(this.ws.path("profile", "profile.yaml"), Profile);
  }

  answers(): Promise<Checked<AnswersFile>> {
    return this.readYaml(this.ws.path("profile", "answers.yaml"), AnswersFile);
  }

  repos(): Promise<Checked<ReposFile>> {
    return this.readYaml(this.ws.path("profile", "repos.yaml"), ReposFile);
  }

  async writeRepos(file: ReposFile): Promise<void> {
    const header = "GitHub repos that feed the knowledge base. Managed by ezapply; edit freely.";
    await this.writeYaml(this.ws.path("profile", "repos.yaml"), ReposFile.parse(file), header);
  }

  /** Create answers.yaml from the seed list if it does not exist. Returns true when created. */
  async ensureAnswerSeed(): Promise<boolean> {
    const path = this.ws.path("profile", "answers.yaml");
    if (await exists(path)) return false;
    await this.writeYaml(path, { schemaVersion: 1, entries: seedAnswers() }, ANSWERS_HEADER);
    this.log.info("seeded answers.yaml");
    return true;
  }

  async checkProfile() {
    const p = await this.profile();
    if (!p.exists)
      return {
        exists: false,
        hint: "Create profile/profile.yaml (the ezapply-onboard skill extracts it from the resume).",
      };
    if (!p.valid) return { exists: true, valid: false, errors: p.errors };
    return { exists: true, valid: true, missing: missingProfileFields(p.value) };
  }

  async checkAnswers() {
    const a = await this.answers();
    if (!a.exists) return { exists: false };
    if (!a.valid) return { exists: true, valid: false, errors: a.errors };
    const entries = a.value.entries;
    const unanswered = entries.filter((e) => !isAnswered(e));
    return {
      exists: true,
      valid: true,
      total: entries.length,
      answered: entries.length - unanswered.length,
      sensitive: entries.filter((e) => e.sensitive).map((e) => e.id),
      unanswered: unanswered.map((e) => ({
        id: e.id,
        canonical: e.canonical,
        ...(e.suggested ? { suggested: e.suggested } : {}),
        ...(e.source ? { source: e.source } : {}),
        sensitive: e.sensitive,
      })),
    };
  }

  /**
   * Copy a LaTeX project into templates/<kind>/. Build artifacts and VCS folders are skipped. An
   * existing template is moved to templates/.old/ rather than overwritten; replacing one the user has
   * needs `replace`, replacing ezapply's shipped default does not.
   */
  async importTemplate(input: { sourceDir: string; kind: TemplateKind; main?: string; replace?: boolean }): Promise<{
    folder: string;
    main: string;
    files: string[];
    previous?: string;
    texProgram?: { engine: string; added: boolean; note?: string };
  }> {
    if (!isAbsolute(input.sourceDir)) {
      throw new EzError(
        ErrorCode.BadRequest,
        "sourceDir must be an absolute path.",
        "Ask the user for the full folder path.",
      );
    }
    const src = input.sourceDir;
    const srcStat = await stat(src).catch(() => null);
    if (!srcStat?.isDirectory()) throw new EzError(ErrorCode.NotFound, `Not a folder: ${src}`);
    const within = relative(this.ws.root, src);
    if (!within.startsWith("..") && !isAbsolute(within)) {
      throw new EzError(ErrorCode.BadRequest, "sourceDir is already inside the workspace.");
    }

    const files = await listImportable(src);
    const texFiles = files.filter((f) => f.toLowerCase().endsWith(".tex"));
    if (texFiles.length === 0) throw new EzError(ErrorCode.BadRequest, `No .tex files in ${src}`);
    const main = input.main ?? (await detectMain(src, texFiles));
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
      await cp(join(src, f), join(dest, f));
    }
    const texProgram = await ensureTexProgram(join(dest, main));
    const meta: TemplateMeta = {
      schemaVersion: 1,
      main,
      origin: "imported",
      importedFrom: src,
      importedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(join(dest, "template.json"), meta);
    this.log.info({ kind: input.kind, files: files.length }, "template imported");
    return {
      folder: dest,
      main: join(dest, main),
      files,
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

  async templateMeta(kind: TemplateKind): Promise<TemplateMeta | null> {
    const parsed = TemplateMeta.safeParse(await readJson(this.ws.path("templates", kind, "template.json")));
    return parsed.success ? parsed.data : null;
  }

  /** Main .tex of a template, or null if none is set up. */
  async templateMain(kind: TemplateKind): Promise<string | null> {
    const meta = await this.templateMeta(kind);
    return meta ? this.ws.path("templates", kind, meta.main) : null;
  }

  /** Record the entry point. A template Claude reworks stops being the shipped default. */
  async setTemplateMain(kind: TemplateKind, main: string): Promise<void> {
    await stat(this.ws.path("templates", kind, main)).catch(() => {
      throw new EzError(ErrorCode.NotFound, `templates/${kind}/${main} does not exist.`);
    });
    const cur = await this.templateMeta(kind);
    await writeJsonAtomic(this.ws.path("templates", kind, "template.json"), {
      ...cur,
      schemaVersion: 1,
      main,
      origin: cur?.origin === "imported" ? "imported" : "custom",
    });
  }

  async preferencesStatus(): Promise<{ exists: boolean; words: number }> {
    const text = await readFile(this.ws.path("profile", "preferences.md"), "utf8").catch(() => "");
    return { exists: text.length > 0, words: text.split(/\s+/).filter(Boolean).length };
  }

  async libraryFiles(): Promise<string[]> {
    return (await readdir(this.ws.path("library")).catch(() => [] as string[])).filter((f) => !f.startsWith("."));
  }

  private async readYaml<S extends z.ZodType>(path: string, schema: S): Promise<Checked<z.output<S>>> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
      throw err;
    }
    const doc = parseDocument(text, { prettyErrors: true });
    if (doc.errors.length > 0) {
      return {
        exists: true,
        valid: false,
        errors: doc.errors.map((e) => ({ path: basename(path), message: e.message })),
      };
    }
    const parsed = schema.safeParse(doc.toJS());
    if (!parsed.success) {
      return {
        exists: true,
        valid: false,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
      };
    }
    return { exists: true, valid: true, value: parsed.data };
  }

  private async writeYaml(path: string, value: unknown, header: string): Promise<void> {
    const body = stringify(value, { lineWidth: 110 });
    const comment = header
      .split("\n")
      .map((l) => `# ${l}`.trimEnd())
      .join("\n");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${comment}\n${body}`, "utf8");
  }
}

export function isAnswered(e: AnswerEntry): boolean {
  if (e.answer === null) return false;
  if (typeof e.answer === "string") return e.answer.trim().length > 0;
  return e.answer.default !== null;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
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
