import type { Field, FillResult, FillValue, FormSchema } from "@ezapply/protocol";
import type { AnswerEntry, Profile } from "../profile/schema.js";

/**
 * Deterministic autofill: which fields of a step the companion fills by itself, from the profile and the answer
 * bank, without the model. Pure: no page, no files, so every rule is tested on its own and on schemas extracted
 * from saved pages.
 *
 * Why: in the four applications of 2026-09-30 and 2026-10-01, 87 of 128 fills copied a profile value, and the
 * model wrote each one out after reading the whole step. Filling those here saves the tokens and turns, and gives
 * the same answer every time. The model still decides everything that needs judgment, and sees what was filled.
 *
 * Phase 1 (this): fields the extractor hints, outside repeatable rows, and answer-bank entries whose wording
 * equals the field's label and whose answer is a plain value. Rows, answers computed from the profile, and a
 * strict match inside the adapter come later (todo.md, item 1).
 */

export type AutofillSource = "profile" | "answer-bank";

export interface PlannedFill {
  fieldId: string;
  label: string;
  kind: Field["kind"];
  value: FillValue;
  source: AutofillSource;
  answerId?: string;
  /** Which rule chose the value: `hint:contact.email`, `answer:how_heard`. */
  rule: string;
  /** What the field held before, when it held something else (left from a previous application). */
  was?: Field["currentValue"];
}

/** Why a field is left to the model. */
export type LeftReason =
  | "no-rule" // nothing deterministic covers it
  | "password"
  | "file"
  | "multi-select" // which entries belong is judgment (skills), and filling only adds
  | "row" // work and education rows: phase 2
  | "section-mismatch" // a profile hint in a section it doesn't belong to (a start date under questions)
  | "not-in-profile" // the hinted profile value isn't set
  | "eeo-unset" // voluntary self-identification not in the profile: the user is asked
  | "eeo-decline" // the profile says decline: the model picks the form's wording for it
  | "sensitive" // the answer bank says always ask
  | "ask-user" // the answer is null
  | "from-profile" // the answer is computed from the profile (phase 2)
  | "no-strict-match" // the stored value matches none of the field's options exactly
  | "reversed-wording"; // the label is a saved variant phrased the other way round ("I do NOT…"): yes and no swap

export interface StepPlan {
  fills: PlannedFill[];
  /** Fields that already hold the planned value. */
  kept: { fieldId: string; rule: string }[];
  left: Map<string, LeftReason>;
}

export interface PlanInput {
  form: FormSchema;
  profile: Profile;
  answers: AnswerEntry[];
  /** The posting's company, for `byCompany` answers. */
  company?: string;
  /** Fields already handled in this call (the first pass), not planned again. */
  skip?: ReadonlySet<string>;
}

/** Sections where a contact or identity hint means someone else's details. */
const OTHER_PERSON = /referen|emergency|relative|spouse|supervisor|manager|referr|next of kin/i;

export function planStep({ form, profile, answers, company, skip }: PlanInput): StepPlan {
  const plan: StepPlan = { fills: [], kept: [], left: new Map() };
  const byWording = answerIndex(answers);
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (skip?.has(field.id)) continue;
      const decided = planField(field, section.title, profile, answers, byWording, company);
      if ("reason" in decided) {
        plan.left.set(field.id, decided.reason);
        continue;
      }
      if (alreadyHolds(field, decided.value)) {
        plan.kept.push({ fieldId: field.id, rule: decided.rule });
        continue;
      }
      plan.fills.push({
        fieldId: field.id,
        label: field.label,
        kind: field.kind,
        value: decided.value,
        source: decided.source,
        ...(decided.answerId ? { answerId: decided.answerId } : {}),
        rule: decided.rule,
        ...(isEmptyValue(field.currentValue) ? {} : { was: field.currentValue }),
      });
    }
  }
  return plan;
}

type Decision = { value: FillValue; source: AutofillSource; rule: string; answerId?: string } | { reason: LeftReason };

function planField(
  field: Field,
  sectionTitle: string,
  profile: Profile,
  answers: AnswerEntry[],
  byWording: Map<string, Wording>,
  company: string | undefined,
): Decision {
  if (field.kind === "password") return { reason: "password" };
  if (field.kind === "file") return { reason: "file" };
  // A multi-select typeahead is a list to decide (which skills), and filling only adds to it.
  if (field.kind === "typeahead" && field.multiple) return { reason: "multi-select" };

  const key = field.hint?.profileKey;
  if (key) {
    if (key.startsWith("work[]") || key.startsWith("education[]")) {
      // Workday's rows are sections like work-experience-2 and education-1.
      return { reason: /^(work|education)[\w-]*-\d+$/.test(sectionId(field)) ? "row" : "section-mismatch" };
    }
    if (OTHER_PERSON.test(sectionTitle)) return { reason: "section-mismatch" };
    if (key.startsWith("answers.")) {
      const entry = answers.find((e) => e.id === key.slice("answers.".length));
      if (entry) return fromAnswer(field, entry, company);
    } else {
      return fromProfile(field, key, profile);
    }
  }
  const wording = byWording.get(normLabel(field.label));
  if (!wording) {
    // A typeahead with entries and no rule is a list to decide, perhaps carried over from a previous application.
    return { reason: field.kind === "typeahead" && !isEmptyValue(field.currentValue) ? "multi-select" : "no-rule" };
  }
  return wording.reversed ? { reason: "reversed-wording" } : fromAnswer(field, wording.entry, company);
}

/** A hinted profile value, formatted for the widget. */
function fromProfile(field: Field, key: string, profile: Profile): Decision {
  const rule = `hint:${key}`;
  if (key.startsWith("eeo.")) {
    const v = profile.eeo[key.slice(4) as keyof Profile["eeo"]];
    if (!v) return { reason: "eeo-unset" };
    if (/^decline/i.test(v.trim())) return { reason: "eeo-decline" };
    return toWidget(field, v, "profile", rule);
  }
  let value: string | undefined;
  if (key === "contact.phone.countryCode") {
    // Workday lists "Canada (+1)": the country names the option, since Canada and the US share +1.
    value = profile.contact.phone ? profile.contact.address.country : undefined;
  } else if (key === "contact.phone.type") {
    const t = profile.contact.phone?.type;
    value = t ? t[0]?.toUpperCase() + t.slice(1) : undefined;
  } else {
    const v = at(profile, key);
    value = typeof v === "string" && v.trim() ? v : undefined;
  }
  if (value === undefined) return { reason: "not-in-profile" };
  return toWidget(field, value, "profile", rule);
}

/** An answer-bank entry's answer for this posting, when it's a plain value. */
function fromAnswer(field: Field, entry: AnswerEntry, company: string | undefined): Decision {
  if (entry.sensitive) return { reason: "sensitive" };
  // Only a profile path means "computed from the profile" (phase 2). Agents also write `source: user` for an
  // answer the user gave (ten such entries in the first live run's bank, 2026-10-01): that's an answer to use.
  if (entry.source?.startsWith("profile.")) return { reason: "from-profile" };
  const a = entry.answer;
  let value: string | null;
  if (a === null || typeof a === "string") value = a;
  else {
    const own = company ? Object.entries(a.byCompany).find(([c]) => sameCompany(c, company)) : undefined;
    value = own ? own[1] : a.default;
  }
  if (value === null || !value.trim()) return { reason: "ask-user" };
  return toWidget(field, value, "answer-bank", `answer:${entry.id}`, entry.id);
}

/**
 * The value as the widget takes it. Options listed in the schema (radios, checkbox groups) are matched strictly
 * here and sent as the option's exact text; dropdowns and typeaheads list theirs only when opened, so their
 * read-back is checked strictly after the fill (`checkReadBack`).
 */
function toWidget(field: Field, value: string, source: AutofillSource, rule: string, answerId?: string): Decision {
  const base = { source, rule, ...(answerId ? { answerId } : {}) };
  switch (field.kind) {
    case "text":
    case "textarea":
    case "number":
    case "dropdown":
      return { ...base, value };
    case "typeahead":
      // Filling only adds an entry: one already there stays unless it's the one wanted (then it's kept).
      if (!isEmptyValue(field.currentValue) && !alreadyHolds(field, value)) return { reason: "multi-select" };
      return { ...base, value };
    case "radio":
    case "checkbox-group": {
      const option = (field.options ?? []).find((o) => strictMatch(value, o));
      if (!option) return { reason: "no-strict-match" };
      return { ...base, value: field.kind === "radio" ? option : [option] };
    }
    case "date":
      // A stored date (an expected graduation date); a date the page doesn't take fails in the adapter.
      return /^\d{4}(-\d{2}){0,2}$/.test(value.trim()) ? { ...base, value: value.trim() } : { reason: "no-rule" };
    default:
      // checkbox: no phase 1 rule fills one
      return { reason: "no-rule" };
  }
}

/**
 * Whether a fill took the value it was meant to. A dropdown or typeahead the adapter matched loosely (a prefix or
 * a substring: "Yes" picking "Yes, I will require sponsorship") counts as inexact: fine for the model, which reads
 * the read-back, not for a pass nobody checks field by field.
 */
export function checkReadBack(fill: PlannedFill, r: FillResult): { ok: true } | { ok: false; selected?: string } {
  if (!r.ok) return { ok: false };
  // The page shows a date its own way (04/30/2030); the adapter already fails a date that didn't take.
  if (fill.kind === "date") return { ok: true };
  if (r.inexact?.length || r.unmatched?.length) return { ok: false, selected: r.inexact?.[0]?.selected };
  const back = r.readBack;
  if (back === undefined || back === null) return { ok: true };
  const wanted = Array.isArray(fill.value) ? fill.value : [String(fill.value)];
  const got = Array.isArray(back) ? back : [String(back)];
  const ok = wanted.every((w) => got.some((g) => strictMatch(w, g) || strictMatch(lastSegment(w), g)));
  return ok ? { ok: true } : { ok: false, selected: got.join(", ") };
}

/** Exact, or the option without its trailing parenthetical, or the parenthetical alone; case and spaces aside. */
export function strictMatch(wanted: string, option: string): boolean {
  const w = normText(wanted);
  const o = normText(option);
  if (!w) return false;
  const bare = o.replace(/\s*\([^)]*\)$/, "");
  const paren = /\(([^)]*)\)$/.exec(o)?.[1];
  return o === w || bare === w || paren === w;
}

/** A label as compared with the answer bank's wording: case, punctuation, a required mark and spacing aside. */
export function normLabel(s: string): string {
  return (
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      // Forms add examples in parentheses that saved wordings leave out ("a visible minority (including people
      // who are …)", "expect to graduate (complete your studies)"), and "(required)".
      .replace(/\([^)]*\)/g, " ")
      .replace(/\*+\s*$/g, "")
      .replace(/[^\p{L}\p{N}' ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

interface Wording {
  entry: AnswerEntry;
  /** Negated the other way from the entry's canonical question, so its yes and no are swapped. */
  reversed: boolean;
}

/**
 * Every wording of every entry, normalised. A variant whose negation differs from the canonical question's
 * ("I do NOT require sponsorship" saved under "Do you require sponsorship?") is marked reversed: the skill saves a
 * form's wording as a variant, and the model flips yes and no for it, but this pass doesn't, so it never fills one.
 */
function answerIndex(answers: AnswerEntry[]): Map<string, Wording> {
  const out = new Map<string, Wording>();
  for (const e of answers) {
    const polarity = negations(e.canonical) % 2;
    for (const wording of [e.canonical, ...e.variants]) {
      const k = normLabel(wording);
      if (k && !out.has(k)) out.set(k, { entry: e, reversed: negations(wording) % 2 !== polarity });
    }
  }
  return out;
}

const NEGATIONS = new Set(["not", "no", "never", "none", "without", "cannot", "neither", "nor"]);

function negations(s: string): number {
  return normLabel(s)
    .split(" ")
    .filter((w) => NEGATIONS.has(w) || w.endsWith("n't")).length;
}

function alreadyHolds(field: Field, value: FillValue): boolean {
  const cur = field.currentValue;
  if (isEmptyValue(cur)) return false;
  if (typeof value === "boolean") return cur === value;
  const wanted = Array.isArray(value) ? value : [value];
  const have = Array.isArray(cur) ? cur : [String(cur)];
  if (field.kind === "text" || field.kind === "textarea" || field.kind === "number") {
    return have.length === 1 && have[0]?.trim() === wanted[0]?.trim();
  }
  return (
    wanted.length === have.length &&
    wanted.every((w) => have.some((h) => strictMatch(w, h) || strictMatch(lastSegment(w), h)))
  );
}

function isEmptyValue(v: Field["currentValue"]): boolean {
  return v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}

function sameCompany(a: string, b: string): boolean {
  return normText(a) === normText(b);
}

function normText(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function lastSegment(path: string): string {
  return path.split(">").pop()?.trim() ?? path;
}

/** The section part of a field id (`work-experience-2.jobTitle` → `work-experience-2`). */
function sectionId(field: Field): string {
  return field.id.split(".")[0] ?? "";
}

function at(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
