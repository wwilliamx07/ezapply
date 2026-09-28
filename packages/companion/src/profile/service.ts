import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseDocument, stringify } from "yaml";
import type { z } from "zod";
import type { Logger } from "../logger.js";
import { exists } from "../util/fs.js";
import type { Workspace } from "../workspace/workspace.js";
import { type AnswerEntry, AnswersFile, missingProfileFields, Profile, ReposFile } from "./schema.js";
import { SEED_VERSION, seedAnswers } from "./seed-answers.js";

export interface Issue {
  path: string;
  message: string;
}

export type Checked<T> =
  | { exists: false }
  | { exists: true; valid: true; value: T }
  | { exists: true; valid: false; errors: Issue[] };

const ANSWERS_HEADER = `Screening-question answer bank. Used to fill application questions; Claude asks you when unsure.
  answer:     the confirmed answer ("Yes", "No", or text). null = ask me every time.
              { default: ..., byCompany: { "Acme": "Yes" } } for company-specific answers.
  suggested:  a proposed default. Not used on forms until copied into answer.
  sensitive:  always ask, even when an answer exists.
  variants:   other wordings of the same question seen on forms (Claude adds these).`;

/** The user's own data in profile/: profile, answer bank, repo selection, preferences; and library/. */
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

  /**
   * Create answers.yaml from the seed list if it does not exist. An existing file with an older `seedVersion`
   * gets the entries added since, once, as unanswered questions; its comments and answers are kept, and
   * entries the user deleted aren't added back.
   */
  async ensureAnswerSeed(): Promise<{ created: boolean; added: string[] }> {
    const path = this.ws.path("profile", "answers.yaml");
    if (!(await exists(path))) {
      await this.writeYaml(
        path,
        { schemaVersion: 1, seedVersion: SEED_VERSION, entries: seedAnswers() },
        ANSWERS_HEADER,
      );
      this.log.info("seeded answers.yaml");
      return { created: true, added: [] };
    }
    const doc = parseDocument(await readFile(path, "utf8"));
    const js = doc.errors.length ? null : (doc.toJS() as { seedVersion?: unknown; entries?: unknown });
    if (!js || !Array.isArray(js.entries)) return { created: false, added: [] };
    const had = typeof js.seedVersion === "number" ? js.seedVersion : 1;
    if (had >= SEED_VERSION) return { created: false, added: [] };
    const ids = new Set(js.entries.map((e) => (e as { id?: unknown } | null)?.id));
    const added = seedAnswers(had).filter((e) => !ids.has(e.id));
    for (const entry of added) doc.addIn(["entries"], doc.createNode(entry));
    doc.set("seedVersion", SEED_VERSION);
    await writeFile(path, doc.toString({ lineWidth: 110 }), "utf8");
    this.log.info({ added: added.map((e) => e.id) }, "added newer seed questions to answers.yaml");
    return { created: false, added: added.map((e) => e.id) };
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
