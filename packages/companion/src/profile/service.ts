import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Document, isMap, parseDocument, stringify } from "yaml";
import type { z } from "zod";
import type { Logger } from "../logger.js";
import { exists } from "../util/fs.js";
import type { Workspace } from "../workspace/workspace.js";
import { type AnswerEntry, AnswersFile, missingProfileFields, Profile, ReposFile } from "./schema.js";
import { seedAnswers } from "./seed-answers.js";

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
        hint: "Create profile/profile.yaml: the onboarding page has Claude draft it from the resume (onboarding {}).",
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
    // `source` names the profile path an answer is computed from. Agents have used it to record who gave the
    // answer (`source: user`); say so, since only a profile path says what to compute the answer from.
    const notProfile = entries.filter((e) => e.source && !e.source.startsWith("profile."));
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
      notProfileSources: notProfile.length
        ? {
            ids: notProfile.map((e) => e.id),
            hint: "source is only for a profile path the answer comes from (profile.workAuthorization…). Remove it from these entries; who gave an answer isn't recorded.",
          }
        : undefined,
    };
  }

  /** profile.yaml as plain data, whether or not it validates (the onboarding page's form starts from it). */
  async rawProfile(): Promise<Record<string, unknown> | undefined> {
    const text = await readFile(this.ws.path("profile", "profile.yaml"), "utf8").catch(() => null);
    if (text === null) return undefined;
    const doc = parseDocument(text);
    const value = doc.errors.length ? undefined : doc.toJS();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  /**
   * Write the profile from the onboarding page's form. Only the keys the schema models are set (or removed, when
   * the form left them empty), each in place, so the user's comments, their order and any keys of their own
   * survive. The result must validate, else nothing is written and the issues come back.
   */
  async saveProfile(value: Record<string, unknown>): Promise<{ ok: true } | { ok: false; errors: Issue[] }> {
    const path = this.ws.path("profile", "profile.yaml");
    const text = await readFile(path, "utf8").catch(() => null);
    const doc = text === null ? parseDocument("schemaVersion: 1\n") : parseDocument(text);
    if (doc.errors.length)
      return { ok: false, errors: [{ path: "profile.yaml", message: doc.errors[0]?.message ?? "" }] };
    if (!doc.contents) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
    for (const [key, v] of Object.entries(value)) {
      if (!PROFILE_KEYS.has(key)) continue;
      setPruned(doc, [key], v);
    }
    doc.set("schemaVersion", 1);
    const parsed = Profile.safeParse(doc.toJS());
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
      };
    }
    await mkdir(join(path, ".."), { recursive: true });
    const header = text === null ? "# Facts about you, for applications. Edit freely; ezapply checks it.\n" : "";
    await writeFile(path, header + doc.toString({ lineWidth: 110 }), "utf8");
    return { ok: true };
  }

  /**
   * Set answers in the answer bank by entry id (null: ask every time), in place, keeping the file's comments and
   * every other field. Unknown ids are skipped.
   */
  async saveAnswers(
    answers: Record<string, string | null>,
  ): Promise<{ ok: true; set: string[] } | { ok: false; errors: Issue[] }> {
    const path = this.ws.path("profile", "answers.yaml");
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null)
      return { ok: false, errors: [{ path: "answers.yaml", message: "profile/answers.yaml is missing" }] };
    const doc = parseDocument(text);
    const entries = doc.toJS()?.entries as { id?: string }[] | undefined;
    if (doc.errors.length || !Array.isArray(entries)) {
      return { ok: false, errors: [{ path: "answers.yaml", message: "profile/answers.yaml can't be read" }] };
    }
    const set: string[] = [];
    entries.forEach((e, i) => {
      if (e.id && Object.hasOwn(answers, e.id)) {
        const a = answers[e.id];
        doc.setIn(["entries", i, "answer"], typeof a === "string" && a.trim() ? a.trim() : null);
        set.push(e.id);
      }
    });
    const parsed = AnswersFile.safeParse(doc.toJS());
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
      };
    }
    await writeFile(path, doc.toString({ lineWidth: 110 }), "utf8");
    return { ok: true, set };
  }

  /** preferences.md by its sections (`## Tone`…); what's under no known heading is kept as `extra`. */
  async preferences(): Promise<Record<PreferenceKey, string> & { extra: string }> {
    const text = await readFile(this.ws.path("profile", "preferences.md"), "utf8").catch(() => "");
    return parsePreferences(text);
  }

  /** Write preferences.md under its fixed headings, keeping anything else the file held after them. */
  async savePreferences(prefs: Record<PreferenceKey, string>): Promise<void> {
    const { extra } = await this.preferences();
    const path = this.ws.path("profile", "preferences.md");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, formatPreferences(prefs, extra), "utf8");
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

/** The top-level keys of profile.yaml the onboarding form writes; any others in the file are the user's own. */
const PROFILE_KEYS = new Set([
  "identity",
  "contact",
  "links",
  "workAuthorization",
  "jobPreferences",
  "work",
  "education",
  "skills",
  "languages",
  "certifications",
  "eeo",
]);

/**
 * Set a value at a path of a YAML document: an object key by key (so the keys and comments it doesn't touch stay),
 * anything else whole. Empty strings, undefined and empty objects remove the key: the form leaves a field empty
 * to say it isn't known.
 */
function setPruned(doc: Document, path: (string | number)[], value: unknown): void {
  if (value === undefined || value === "" || (isPlainObject(value) && Object.keys(value).length === 0)) {
    if (doc.hasIn(path)) doc.deleteIn(path);
    return;
  }
  if (isPlainObject(value)) {
    // Key by key: a key the form doesn't know (the user's own) is left as it is.
    if (!isMap(doc.getIn(path, true))) doc.setIn(path, doc.createNode({}));
    for (const [k, v] of Object.entries(value)) setPruned(doc, [...path, k], v);
    if (isMap(doc.getIn(path, true)) && (doc.getIn(path, true) as { items: unknown[] }).items.length === 0) {
      doc.deleteIn(path);
    }
    return;
  }
  doc.setIn(path, value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type PreferenceKey = "tone" | "emphasis" | "neverMention" | "targets" | "coverLetters";

/** preferences.md's headings, in order. */
const PREFERENCE_HEADINGS: [PreferenceKey, string][] = [
  ["tone", "Tone"],
  ["emphasis", "What to emphasize"],
  ["neverMention", "Never mention"],
  ["targets", "Target roles and locations"],
  ["coverLetters", "Cover letters"],
];

export function parsePreferences(text: string): Record<PreferenceKey, string> & { extra: string } {
  const out = { tone: "", emphasis: "", neverMention: "", targets: "", coverLetters: "", extra: "" };
  const byTitle = new Map(PREFERENCE_HEADINGS.map(([k, t]) => [t.toLowerCase(), k]));
  let current: PreferenceKey | "extra" = "extra";
  const parts: Record<string, string[]> = { extra: [] };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const key = byTitle.get((h[1] as string).toLowerCase());
      current = key ?? "extra";
      if (!key) (parts.extra as string[]).push(line);
      continue;
    }
    if (/^#\s+Preferences\s*$/i.test(line)) continue;
    parts[current] = [...(parts[current] ?? []), line];
  }
  for (const [k, lines] of Object.entries(parts)) {
    (out as Record<string, string>)[k] = lines.join("\n").trim();
  }
  return out;
}

export function formatPreferences(prefs: Record<PreferenceKey, string>, extra = ""): string {
  const sections = PREFERENCE_HEADINGS.filter(([k]) => prefs[k].trim()).map(
    ([k, t]) => `## ${t}\n\n${prefs[k].trim()}\n`,
  );
  return [`# Preferences\n`, ...sections, ...(extra.trim() ? [`${extra.trim()}\n`] : [])].join("\n");
}

export function isAnswered(e: AnswerEntry): boolean {
  if (e.answer === null) return false;
  if (typeof e.answer === "string") return e.answer.trim().length > 0;
  return e.answer.default !== null;
}
