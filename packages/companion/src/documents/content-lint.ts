import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { stringify } from "yaml";
import type { Services } from "../services.js";
import type { TemplateKind } from "../templates/service.js";

/**
 * What a program can check in a tailored resume or cover letter, under the skills' own checks: the agent is told
 * each rule and still slips. Only lines the tailoring changed are checked (a line not in the template's copy of the
 * file): the template is the user's own wording.
 * - `unsourced-number`: a number that appears in no claim, the profile, the posting or the template.
 * - `missing-src`: a changed resume bullet (a line starting with an item command) with no `% src:` comment on it
 *   or on the comment line just above or below.
 * - `unknown-src`: a `% src:` id that is neither a claim id nor a path the profile holds.
 * - `never-mention`: a term from preferences.md's "Never mention".
 * - `unbacked-skill`: on the resume, an entry of a changed labelled list (`Languages: Python, Go, Rust`, the skills
 *   line) that no claim or the profile names. The posting asking for a skill is no evidence of it.
 */
interface ContentIssue {
  kind: "unsourced-number" | "missing-src" | "unknown-src" | "never-mention" | "unbacked-skill";
  /** The file, relative to the posting folder, and the line (1-based). */
  file: string;
  line: number;
  /** What was found: the number, the id, the term, the skill; or the bullet's start for `missing-src`. */
  text: string;
}

/** The kinds review_documents refuses: a source the user can't check is no source. */
const REFUSED = new Set<ContentIssue["kind"]>(["missing-src", "unknown-src"]);

interface Evidence {
  numbers: Set<string>;
  /** Lowercased text of the claims and the profile, for the skills line. */
  backing: string;
  claimIds: Set<string>;
  profile: Record<string, unknown> | undefined;
  neverMention: string[];
}

/**
 * The content checks of a posting's resume.tex or cover.tex (and the content files its template copied); [] for
 * any other file, or a posting document without a template to compare with.
 */
export async function contentLint(s: Services, texPath: string): Promise<ContentIssue[]> {
  const doc = postingDocument(s, texPath);
  if (!doc) return [];
  const main = await s.templates.templateMain(doc.kind);
  const meta = await s.templates.templateMeta(doc.kind);
  if (!main || !meta) return [];
  const files = [{ rel: basename(texPath), template: main }];
  for (const rel of meta.contentFiles ?? []) files.push({ rel, template: join(dirname(main), rel) });
  const evidence = await gather(
    s,
    doc.postingId,
    files.map((f) => f.template),
  );
  const issues: ContentIssue[] = [];
  for (const f of files) {
    const text = await readFile(join(doc.folder, f.rel), "utf8").catch(() => null);
    if (text === null) continue;
    const template = await readFile(f.template, "utf8").catch(() => "");
    issues.push(...checkFile(f.rel.split(sep).join("/"), text, template, evidence, doc.kind));
  }
  return issues;
}

/** Refuse a review of documents whose `% src:` comments are missing or name nothing (`contentLint`). */
export async function checkSources(s: Services, files: string[]): Promise<void> {
  const problems: string[] = [];
  for (const file of files) {
    const abs = s.workspace.resolveAllowed(file, ["postings"]);
    const tex = abs.replace(/\.pdf$/i, ".tex");
    if (tex === abs) continue;
    for (const i of await contentLint(s, tex)) {
      if (REFUSED.has(i.kind))
        problems.push(`${i.file}:${i.line} ${i.kind === "missing-src" ? "no % src" : `unknown src ${i.text}`}`);
    }
  }
  if (problems.length === 0) return;
  throw new EzError(
    ErrorCode.BadRequest,
    `Sources missing or unknown: ${problems.slice(0, 8).join("; ")}${problems.length > 8 ? ` (+${problems.length - 8})` : ""}.`,
    "Give each changed bullet a % src: comment with the claim ids (claims_list) or profile paths (e.g. " +
      "work.0.highlights.1) it draws on, then compile and review again.",
  );
}

/**
 * The terms of preferences.md's "Never mention" section that a value uses: what `fill_fields` warns about in an
 * answer of the agent's own judgment.
 */
export function neverMentioned(section: string, value: string): string[] {
  return neverMentionTerms(section).filter((t) => wordMatch(value, t));
}

function postingDocument(
  s: Services,
  texPath: string,
): { postingId: string; folder: string; kind: TemplateKind } | null {
  const rel = relative(s.workspace.path("postings"), texPath).split(sep);
  if (rel.length !== 2 || rel[0] === ".." || !rel[0]) return null;
  const kind = rel[1] === "resume.tex" ? "resume" : rel[1] === "cover.tex" ? "cover" : null;
  if (!kind) return null;
  return { postingId: rel[0], folder: s.postings.folder(rel[0]), kind };
}

async function gather(s: Services, postingId: string, templates: string[]): Promise<Evidence> {
  const claims = await s.repos.claimRecords().catch(() => []);
  const profile = await s.profile.rawProfile().catch(() => undefined);
  const posting = await readFile(join(s.postings.folder(postingId), "posting.md"), "utf8").catch(() => "");
  const templateText = (await Promise.all(templates.map((t) => readFile(t, "utf8").catch(() => "")))).join("\n");
  const claimText = claims.map((c) => [c.claim, c.impact ?? "", ...c.skills].join("\n")).join("\n");
  const profileText = profile ? stringify(profile) : "";
  const prefs = await s.profile.preferences().catch(() => null);
  return {
    numbers: numbersIn([claimText, profileText, posting, templateText].join("\n")),
    backing: `${claimText}\n${profileText}`.toLowerCase(),
    claimIds: new Set(claims.map((c) => c.id)),
    profile,
    neverMention: neverMentionTerms(prefs?.neverMention ?? ""),
  };
}

function checkFile(file: string, text: string, template: string, e: Evidence, kind: TemplateKind): ContentIssue[] {
  const kept = new Set(template.split(/\r?\n/).map((l) => l.trim()));
  const lines = text.split(/\r?\n/);
  const out: ContentIssue[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || kept.has(line)) return;
    const at = { file, line: i + 1 };
    const { code, comment } = splitComment(line);
    for (const id of srcIds(comment)) if (!known(id, e)) out.push({ kind: "unknown-src", ...at, text: id });
    const visible = visibleText(code);
    if (!visible.trim()) return;
    for (const n of numbersIn(visible)) if (!e.numbers.has(n)) out.push({ kind: "unsourced-number", ...at, text: n });
    for (const t of e.neverMention) if (wordMatch(visible, t)) out.push({ kind: "never-mention", ...at, text: t });
    if (kind === "resume" && /^\\[a-zA-Z]*item\b/i.test(code) && !hasSrc(lines, i)) {
      out.push({ kind: "missing-src", ...at, text: visible.trim().slice(0, 60) });
    }
    for (const skill of kind === "resume" ? listEntries(visible) : []) {
      if (!e.backing.includes(skill.toLowerCase())) out.push({ kind: "unbacked-skill", ...at, text: skill });
    }
  });
  return out;
}

/** A LaTeX line split at its first unescaped `%`. */
function splitComment(line: string): { code: string; comment: string } {
  const m = /(^|[^\\])%/.exec(line);
  if (!m) return { code: line, comment: "" };
  const at = m.index + (m[1]?.length ?? 0);
  return { code: line.slice(0, at), comment: line.slice(at + 1) };
}

function srcIds(comment: string): string[] {
  const m = /^\s*src:\s*(.*)$/i.exec(comment);
  return m?.[1] ? m[1].split(/[,\s]+/).filter(Boolean) : [];
}

/** A `% src:` on the line, or on a comment-only line just above or below it. */
function hasSrc(lines: string[], i: number): boolean {
  if (/(^|[^\\])%\s*src:/i.test(lines[i] ?? "")) return true;
  return [lines[i - 1], lines[i + 1]].some((l) => l !== undefined && /^\s*%\s*src:/i.test(l));
}

/** A claim id, or a path the profile holds (`work.0.highlights.1`, `work[0]`, with or without `profile.`). */
function known(id: string, e: Evidence): boolean {
  if (e.claimIds.has(id)) return true;
  const path = id
    .replace(/^profile[.:]/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  if (path.length === 0) return false;
  let v: unknown = e.profile;
  for (const key of path) v = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  return v !== undefined && v !== null;
}

/** The text a line prints: commands and their dimension arguments dropped, escapes undone. */
function visibleText(code: string): string {
  return code
    .replace(/\\[a-zA-Z@]+\*?\s*\{\s*-?[\d.]+\s*(pt|em|ex|in|cm|mm|bp|sp|\\[a-z]+)\s*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/[{}~]/g, " ");
}

/** Numbers as written, without thousands separators or leading zeros: "1,200" and "1200" match. */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = m[0].replace(/,(?=\d{3}\b)/g, "").replace(/^0+(?=\d)/, "");
    out.add(n);
  }
  return out;
}

/** The entries of a labelled list of three or more short items ("Languages: Python, Go, Rust"). */
function listEntries(visible: string): string[] {
  if (!visible.includes(":")) return [];
  const body = visible.slice(visible.indexOf(":") + 1);
  const items = body
    .split(/[,;|]/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (items.length < 3 || items.some((x) => x.split(" ").length > 4)) return [];
  return items;
}

/** preferences.md's "Never mention" as terms: one per line or comma-separated, list markers dropped. */
function neverMentionTerms(section: string): string[] {
  return section
    .split(/\r?\n|[,;]/)
    .map((t) =>
      t
        .replace(/^\s*[-*+]\s*/, "")
        .replace(/^["'`]|["'`.]$/g, "")
        .trim(),
    )
    .filter((t) => t && t.split(/\s+/).length <= 5);
}

function wordMatch(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * A compile's result with the content findings added to its `lint` and named in its hint, for tex_compile and
 * tex_edit. A failed build is returned as it is.
 */
export async function withContentLint<T extends { ok: boolean; lint?: unknown[]; hint?: string }>(
  s: Services,
  path: string,
  result: T,
): Promise<T> {
  if (!result.ok) return result;
  const issues = await contentLint(s, s.workspace.resolveAllowed(path, ["postings", "templates"])).catch(() => []);
  if (issues.length === 0) return result;
  const kinds = [...new Set(issues.map((i) => i.kind))].join(", ");
  const note =
    `${issues.length} content finding${issues.length === 1 ? "" : "s"} in lint (${kinds}): use only what the ` +
    "evidence holds, give each changed bullet a % src: of claim ids or profile paths, and leave out what " +
    "preferences.md says never to mention.";
  return { ...result, lint: [...(result.lint ?? []), ...issues], hint: result.hint ? `${result.hint} ${note}` : note };
}
