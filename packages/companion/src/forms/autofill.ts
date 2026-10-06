import type { Field, FillResult, FillValue, FormSchema, Section } from "@ezapply/protocol";
import { normOption, strictIndex, strictMatch } from "@ezapply/protocol/match";
import type { AnswerEntry, Profile } from "../profile/schema.js";
import {
  hasLinkedInField,
  type ListKey,
  listOfButton,
  listSlots,
  profileCount,
  profileLinks,
  rowOf,
  savedItemOf,
} from "./lists.js";

export { strictMatch };

/**
 * Deterministic autofill: which fields of a step the companion fills by itself, from the profile and the answer
 * bank, without the model. Pure: no page, no files, so every rule is tested on its own and on schemas extracted
 * from saved pages.
 *
 * Why: in four live applications, 87 of 128 fills copied a profile value, and the
 * model wrote each one out after reading the whole step. Filling those here saves the tokens and turns, and gives
 * the same answer every time. The model still decides everything that needs judgment, and sees what was filled.
 *
 * What it fills: fields the extractor hints; Workday's work, education, language and website rows, each mapped to
 * a profile entry (`mapRows`); link fields (Oracle's "Link 1"); the fields of an Oracle inline item form opened
 * for one entry (`item`); and answer-bank entries whose wording equals the label, either a plain answer or one
 * computed from the profile (`computed`). Which rows to add (`rowsToAdd`) and which Oracle items are missing
 * (`missingItems`) are decided here too; FormsService.autofillStep presses the buttons.
 */

export type AutofillSource = "profile" | "answer-bank" | "computed";

export interface PlannedFill {
  fieldId: string;
  label: string;
  kind: Field["kind"];
  value: FillValue;
  source: AutofillSource;
  answerId?: string;
  /** Which rule chose the value: `hint:contact.email`, `answer:how_heard`, `row:work[1].title`. */
  rule: string;
  /** What the field held before, when it held something else (left from a previous application). */
  was?: Field["currentValue"];
  /** Sent without `strict`: the list qualifies the value (see `LOOSE_KEYS`); the read-back is still checked. */
  loose?: true;
}

/**
 * Hints whose lists name the value with more after it: Oracle's city option reads "Toronto, Ontario" and the field
 * shows "Toronto" once chosen, a postal code "K2K 3E9, Kanata, Ontario" (both seen live). A strict match would
 * refuse them; the adapter's own match picks them, and `checkReadBack` then compares what the field shows.
 */
const LOOSE_KEYS = new Set(["contact.address.city", "contact.address.postalCode"]);

/** Why a field is left to the model. */
export type LeftReason =
  | "no-rule" // nothing deterministic covers it
  | "password"
  | "read-only" // the page won't take a value (Oracle's email, from the sign-in)
  | "file"
  | "multi-select" // which entries belong is judgment (skills), and filling only adds
  | "row" // a row of a list autofill doesn't fill (certifications)
  | "extra-row" // a row beyond the profile's entries: the model decides whether to remove it
  | "section-mismatch" // a profile hint in a section it doesn't belong to (a start date under questions)
  | "not-in-profile" // the profile value isn't set
  | "eeo-unset" // voluntary self-identification not in the profile: the user is asked
  | "eeo-decline" // the profile says decline: the model picks the form's wording for it
  | "sensitive" // the answer bank says always ask
  | "ask-user" // the answer is null
  | "from-profile" // an answer computed from the profile that the profile doesn't settle
  | "no-strict-match" // the value (and its alternatives) matches none of the field's options exactly
  | "reversed-wording"; // the label is a saved variant phrased the other way round ("I do NOT…"): yes and no swap

export interface StepPlan {
  fills: PlannedFill[];
  /** Fields that already hold the planned value. */
  kept: { fieldId: string; rule: string }[];
  left: Map<string, LeftReason>;
  /**
   * Dropdowns whose value depends on their options (a degree, a language level: several wordings are right):
   * by option key (`optionKey`), one field id to list them from. Plan again with `options` once listed.
   */
  needOptions: Map<string, string>;
}

export interface PlanInput {
  form: FormSchema;
  profile: Profile;
  answers: AnswerEntry[];
  /** The posting's company, for `byCompany` answers. */
  company?: string;
  /** The posting's location (meta.json, free text), for the country of `authorizedIn`. */
  location?: string;
  /** Fields already handled in this call (the first pass), not planned again. */
  skip?: ReadonlySet<string>;
  /** Dropdown options listed in this call, by `optionKey`. A key listed without options is a miss. */
  options?: ReadonlyMap<string, string[] | null>;
  /**
   * Plan only these fields, as the inline form of one Oracle item (a work entry, a language) opened for
   * profile entry `index` of `list`.
   */
  item?: { list: ListKey; index: number; fieldIds: ReadonlySet<string> };
}

/** Sections where a contact or identity hint means someone else's details. */
const OTHER_PERSON = /referen|emergency|relative|spouse|supervisor|manager|referr|next of kin/i;

/** The lists autofill fills row by row. Certifications aren't: no live run has shown their fields yet. */
const ROW_LISTS: ListKey[] = ["work", "education", "languages", "links"];

/** Fields that list the same options share a key: a Workday automation id repeats in every row. */
export function optionKey(field: Field): string {
  return field.automationId ?? field.id;
}

export function planStep(input: PlanInput): StepPlan {
  const { form, skip, item } = input;
  const plan: StepPlan = { fills: [], kept: [], left: new Map(), needOptions: new Map() };
  const ctx: Ctx = {
    ...input,
    byWording: answerIndex(input.answers),
    rows: item ? new Map() : mapRows(form, input.profile),
    links: item ? new Map() : mapLinkSlots(form, input.profile),
  };
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (skip?.has(field.id)) continue;
      if (item && !item.fieldIds.has(field.id)) continue;
      const decided =
        never(field) ??
        (item ? rowField(field, { list: item.list, index: item.index }, ctx, "item") : planField(field, section, ctx));
      if ("pending" in decided) {
        plan.needOptions.set(optionKey(field), field.id);
        continue;
      }
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
        ...(LOOSE_KEYS.has(field.hint?.profileKey ?? "") ? { loose: true as const } : {}),
      });
    }
  }
  return plan;
}

type Decision =
  | { value: FillValue; source: AutofillSource; rule: string; answerId?: string }
  | { reason: LeftReason }
  | { pending: true };

interface Ctx extends PlanInput {
  byWording: Map<string, Wording>;
  /** Row sections: their profile entry, or why they have none. */
  rows: Map<string, RowEntry | "extra" | "unfilled">;
  /** Link fields outside rows: the link each takes, or null (holds something else, or no link left). */
  links: Map<string, number | null>;
}

interface RowEntry {
  list: ListKey;
  /** Index into the list's entries (`entries`). */
  index: number;
}

/** Fields never filled automatically, wherever they are. */
function never(field: Field): Decision | undefined {
  if (field.kind === "password") return { reason: "password" };
  if (field.kind === "file") return { reason: "file" };
  // The extractor says so in the help text (Oracle's email, which comes from the sign-in).
  if (/read-only/i.test(field.helpText ?? "")) return { reason: "read-only" };
  // A multi-select typeahead is a list to decide (which skills), and filling only adds to it.
  if (field.kind === "typeahead" && field.multiple) return { reason: "multi-select" };
  return undefined;
}

function planField(field: Field, section: Section, ctx: Ctx): Decision {
  const row = ctx.rows.get(section.id);
  if (row === "extra") return { reason: "extra-row" };
  if (row === "unfilled") return { reason: "row" };
  if (row) return rowField(field, row, ctx, "row");
  const link = ctx.links.get(field.id);
  if (link !== undefined) {
    if (link === null) return { reason: isEmptyValue(field.currentValue) ? "not-in-profile" : "no-rule" };
    return rowField(field, { list: "links", index: link }, ctx, "link");
  }

  const key = field.hint?.profileKey;
  if (key) {
    // Outside a row, a work or education hint is something else: Workday's "Available Start Date" under
    // Application Questions has the hint work[].start.
    if (key.startsWith("work[]") || key.startsWith("education[]")) return { reason: "section-mismatch" };
    if (OTHER_PERSON.test(section.title)) return { reason: "section-mismatch" };
    if (key.startsWith("answers.")) {
      const entry = ctx.answers.find((e) => e.id === key.slice("answers.".length));
      if (entry) return fromAnswer(field, entry, ctx);
    } else {
      return fromProfile(field, key, ctx);
    }
  }
  const wording = ctx.byWording.get(normLabel(field.label));
  if (!wording) {
    // A typeahead with entries and no rule is a list to decide, perhaps carried over from a previous application.
    return { reason: field.kind === "typeahead" && !isEmptyValue(field.currentValue) ? "multi-select" : "no-rule" };
  }
  return wording.reversed ? { reason: "reversed-wording" } : fromAnswer(field, wording.entry, ctx);
}

/** A hinted profile value, formatted for the widget. */
function fromProfile(field: Field, key: string, ctx: Ctx): Decision {
  const { profile } = ctx;
  const rule = `hint:${key}`;
  if (key.startsWith("eeo.")) {
    const v = profile.eeo[key.slice(4) as keyof Profile["eeo"]];
    if (!v) return { reason: "eeo-unset" };
    if (/^decline/i.test(v.trim())) return { reason: "eeo-decline" };
    return toWidget(field, [v], { source: "profile", rule }, ctx);
  }
  let value: string | undefined;
  if (key === "contact.phone.countryCode") {
    // Workday lists "Canada (+1)": the country names the option, since Canada and the US share +1.
    value = profile.contact.phone ? profile.contact.address.country : undefined;
  } else if (key === "contact.phone.type") {
    const t = profile.contact.phone?.type;
    value = t ? t[0]?.toUpperCase() + t.slice(1) : undefined;
  } else if (key === "identity.fullName") {
    // One field for the whole name (Lever's "Full name", Ashby's "Legal Name"): first, middle, last.
    const { firstName, middleName, lastName } = profile.identity;
    value = [firstName, middleName, lastName].filter((p) => p?.trim()).join(" ");
  } else {
    const v = at(profile, key);
    value = typeof v === "string" && v.trim() ? v : undefined;
  }
  if (value === undefined) return { reason: "not-in-profile" };
  return toWidget(field, [value], { source: "profile", rule }, ctx);
}

/** An answer-bank entry's answer for this posting: computed from the profile, or a plain value. */
function fromAnswer(field: Field, entry: AnswerEntry, ctx: Ctx): Decision {
  if (entry.sensitive) return { reason: "sensitive" };
  // Only a profile path means "computed from the profile". Agents also write `source: user` for an answer the
  // user gave (ten such entries in one live run's bank): that's an answer to use.
  if (entry.source?.startsWith("profile.")) {
    const computed = computeAnswer(entry, field, ctx);
    if (computed !== undefined) {
      return toWidget(field, [computed], { source: "computed", rule: `computed:${entry.id}`, answerId: entry.id }, ctx);
    }
  }
  const a = entry.answer;
  let value: string | null;
  if (a === null || typeof a === "string") value = a;
  else {
    const company = ctx.company;
    const own = company ? Object.entries(a.byCompany).find(([c]) => sameText(c, company)) : undefined;
    value = own ? own[1] : a.default;
  }
  if (value === null || !value.trim()) {
    return { reason: entry.source?.startsWith("profile.") ? "from-profile" : "ask-user" };
  }
  return toWidget(field, [value], { source: "answer-bank", rule: `answer:${entry.id}`, answerId: entry.id }, ctx);
}

// ---- answers computed from the profile -----------------------------------------------------------

const yesNo = (b: boolean | undefined) => (b === undefined ? undefined : b ? "Yes" : "No");

/**
 * The answer an entry with `source: profile.…` computes to, when the profile settles it; undefined leaves it to
 * the model. Only questions with one right reading are computed. Whether a degree is "completed" for this role, or
 * a yes/no question about an EEO value, needs judgment, so `profile.education` and `profile.eeo.*` never are.
 */
function computeAnswer(entry: AnswerEntry, field: Field, ctx: Ctx): string | undefined {
  const { profile } = ctx;
  const auth = profile.workAuthorization;
  const prefs = profile.jobPreferences;
  switch (entry.source) {
    case "profile.workAuthorization.requiresSponsorshipNow":
      return yesNo(auth.requiresSponsorshipNow);
    case "profile.workAuthorization.requiresSponsorshipFuture":
      return yesNo(auth.requiresSponsorshipFuture);
    case "profile.jobPreferences.relocate":
      return yesNo(prefs.relocate);
    case "profile.workAuthorization.authorizedIn":
      return authorizedHere(field.label, ctx);
    case "profile.jobPreferences.workMode":
      // Able to work on site or hybrid. A remote-only preference isn't an inability: left to the model.
      return prefs.workMode && prefs.workMode !== "remote" ? "Yes" : undefined;
    case "profile.jobPreferences.willingToTravelPercent": {
      // "As required": only the two ends are certain.
      const p = prefs.willingToTravelPercent;
      return p === 0 ? "No" : p === 100 ? "Yes" : undefined;
    }
    case "profile.jobPreferences.earliestStart": {
      const v = prefs.earliestStart?.trim();
      if (!v) return undefined;
      if (field.kind === "date") return /^\d{4}(-\d{2}){0,2}$/.test(v) ? v : undefined;
      return field.kind === "text" || field.kind === "textarea" ? v : undefined;
    }
    case "profile.workAuthorization.securityClearance": {
      const v = auth.securityClearance?.trim();
      if (!v) return undefined;
      return /^(none|no|n\/a)$/i.test(v) ? "No" : "Yes";
    }
    case "profile.languages": {
      // "Are you fluent in English?": the language the question names.
      const said = normLabel(`${field.label} ${entry.canonical}`);
      const lang = profile.languages.find((l) => new RegExp(`\\b${escapeRegExp(normLabel(l.language))}\\b`).test(said));
      if (!lang) return undefined;
      if (lang.proficiency === "native" || lang.proficiency === "fluent") return "Yes";
      if (lang.proficiency === "conversational" || lang.proficiency === "basic") return "No";
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Short names of the countries postings name most, so "USA" and "United States of America" are one country. */
const COUNTRIES: Record<string, string[]> = {
  canada: ["Canada"],
  "united states": ["United States", "United States of America", "USA", "U.S.", "U.S.A.", "US"],
  "united kingdom": ["United Kingdom", "UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales"],
};

/**
 * "Yes" when the job is in a country the user may work in: the country the question names ("…authorized to work in
 * Canada?"), else the one the posting's location names. Anything else (no country found, another country, two
 * countries) is left to the model: "No" is a claim about the job's country, which free text can't settle.
 */
function authorizedHere(label: string, ctx: Ctx): string | undefined {
  const allowed = new Set(ctx.profile.workAuthorization.authorizedIn.map(countryKey));
  for (const text of [label, ctx.location ?? ""]) {
    const named = countriesIn(text, allowed);
    if (named.size === 0) continue;
    return [...named].every((c) => allowed.has(c)) ? "Yes" : undefined;
  }
  return undefined;
}

function countryKey(name: string): string {
  const n = normOption(name).replace(/\.$/, "");
  for (const [key, aliases] of Object.entries(COUNTRIES)) {
    if (aliases.some((a) => normOption(a).replace(/\.$/, "") === n)) return key;
  }
  return n;
}

/** The countries a text names: the aliases above, and the user's own countries. Short codes count in capitals only. */
function countriesIn(text: string, allowed: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const names: [string, string][] = Object.entries(COUNTRIES).flatMap(([k, as]) => as.map((a) => [k, a]));
  for (const c of allowed) if (!COUNTRIES[c]) names.push([c, c]);
  for (const [key, name] of names) {
    const short = name.replace(/\./g, "").length <= 3;
    const re = new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}(?![\\p{L}])`, short ? "u" : "iu");
    if (re.test(text)) found.add(key);
  }
  return found;
}

// ---- rows ---------------------------------------------------------------------------------------

/** What a field in a row holds: one part of the row's profile entry. */
type Slot =
  | "title"
  | "company"
  | "location"
  | "current"
  | "start"
  | "end"
  | "highlights"
  | "school"
  | "degree"
  | "field"
  | "gpa"
  | "language"
  | "native"
  | "level"
  | "url";

/** The slot that names the entry, used to match rows to entries before order. */
const KEY_SLOT: Partial<Record<ListKey, Slot>> = {
  work: "company",
  education: "school",
  languages: "language",
  links: "url",
};

/** Workday tenants label levels differently: one with bare verbs ("Read", "Speak", "Write"), another with "Reading". */
const LEVEL_LABEL = /proficien|level|\b(read|writ|speak|spoken|oral|listen)|comprehension|overall|fluency/;

/**
 * Which part of the entry a row field takes: the hint when there is one (Workday's `work[].title`), else the label.
 * Labels decide what hints can't: Workday's education years ("From", "To (Actual or Expected)") have no hint, and
 * its language levels are keyed by hashed ids, so only their labels say what they are.
 */
export function slotOf(field: Field, list: ListKey): Slot | undefined {
  const key = field.hint?.profileKey;
  if (key === "work[].end (null = current)") return list === "work" ? "current" : undefined;
  const hinted = /^(work|education)\[\]\.(\w+)/.exec(key ?? "");
  if (hinted) {
    const [, from, part] = hinted;
    // Workday hints a row's dates as work[] whatever the row: they're the row's own dates.
    if (from === list || part === "start" || part === "end") return part as Slot;
    return undefined;
  }
  if (key?.startsWith("links.")) return list === "links" ? "url" : undefined;

  const label = field.label.toLowerCase();
  const date = field.kind === "date";
  const startOrEnd = (): Slot | undefined =>
    /start|from|begin|first year/.test(label)
      ? "start"
      : /\bend\b|\bto\b|until|finish|graduat|last year|expected|completion/.test(label)
        ? "end"
        : undefined;
  switch (list) {
    case "work":
      if (field.kind === "checkbox") return /current|present|i work here/.test(label) ? "current" : undefined;
      if (date) return startOrEnd();
      if (/job title|^title$|position/.test(label)) return "title";
      if (/company|employer|organi[sz]ation/.test(label)) return "company";
      if (/location|city/.test(label)) return "location";
      if (/description|responsibilit|duties|summary|achievements/.test(label)) return "highlights";
      return undefined;
    case "education":
      if (date) return startOrEnd();
      if (/school|university|college|institution|establishment/.test(label)) return "school";
      if (/field of study|major|discipline|area of study|program/.test(label)) return "field";
      if (/degree|qualification/.test(label)) return "degree";
      if (/gpa|grade|average|overall result/.test(label)) return "gpa";
      return undefined;
    case "languages":
      if (field.kind === "checkbox") {
        return /native|fluent|mother tongue|first language/.test(label) ? "native" : undefined;
      }
      if (LEVEL_LABEL.test(label)) return "level";
      if (/\blanguage\b/.test(label)) return "language";
      return undefined;
    case "links":
      return field.kind === "text" ? "url" : undefined;
    default:
      return undefined;
  }
}

type Entry = Profile["work"][number] | Profile["education"][number] | Profile["languages"][number] | { url: string };

/** A list's entries in profile order. Links: LinkedIn only when the page has no field of its own for it. */
function entries(list: ListKey, profile: Profile, form: FormSchema): Entry[] {
  if (list === "links") return profileLinks(profile, !hasLinkedInField(form)).map((url) => ({ url }));
  if (list === "certifications") return [];
  return profile[list];
}

/** The text an entry is recognised by on the page: its company, school, language or URL. */
function entryKey(list: ListKey, e: Entry): string {
  if ("company" in e) return e.company;
  if ("school" in e) return e.school;
  if ("language" in e) return e.language;
  return list === "links" && "url" in e ? e.url : "";
}

/**
 * Which profile entry each row takes. First the rows that already name an entry (its company, school, language or
 * URL), as on a form pre-filled from the last application; then the rest in page order, taking the remaining
 * entries in profile order. Rows beyond the entries are `extra`: removing one is destructive, and the user may
 * want an older job on the form, so the model decides.
 */
function mapRows(form: FormSchema, profile: Profile): Map<string, RowEntry | "extra" | "unfilled"> {
  const out = new Map<string, RowEntry | "extra" | "unfilled">();
  const byList = new Map<ListKey, Section[]>();
  for (const s of form.sections) {
    const list = rowOf(s);
    if (list && s.fields.length > 0) byList.set(list, [...(byList.get(list) ?? []), s]);
  }
  for (const [list, rows] of byList) {
    if (!ROW_LISTS.includes(list)) {
      for (const r of rows) out.set(r.id, "unfilled");
      continue;
    }
    const all = entries(list, profile, form);
    const free = new Set(all.map((_, i) => i));
    const keySlot = KEY_SLOT[list];
    for (const r of rows) {
      const keyField = r.fields.find((f) => slotOf(f, list) === keySlot);
      const shown = typeof keyField?.currentValue === "string" ? keyField.currentValue : "";
      const i = shown ? all.findIndex((e, n) => free.has(n) && sameEntry(list, entryKey(list, e), shown)) : -1;
      if (i < 0) continue;
      out.set(r.id, { list, index: i });
      free.delete(i);
    }
    for (const r of rows) {
      if (out.has(r.id)) continue;
      const next = [...free][0];
      if (next === undefined) out.set(r.id, "extra");
      else {
        out.set(r.id, { list, index: next });
        free.delete(next);
      }
    }
  }
  return out;
}

/**
 * Link fields outside rows (Oracle's "Link 1", "Link 2"): a field already holding a profile link keeps it, empty
 * ones take the links not on the page yet, in order. A field holding some other link is left alone.
 */
function mapLinkSlots(form: FormSchema, profile: Profile): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const slots = (listSlots(form).get("links") ?? []).flatMap((s) => (s.field ? [s.field] : []));
  if (slots.length === 0) return out;
  const links = entries("links", profile, form).map((e) => ("url" in e ? e.url : ""));
  const free = new Set(links.map((_, i) => i));
  for (const f of slots) {
    const shown = typeof f.currentValue === "string" ? f.currentValue.trim() : "";
    if (!shown) continue;
    const i = links.findIndex((l, n) => free.has(n) && sameEntry("links", l, shown));
    out.set(f.id, i >= 0 ? i : null);
    if (i >= 0) free.delete(i);
  }
  for (const f of slots) {
    if (out.has(f.id)) continue;
    const next = [...free][0];
    out.set(f.id, next ?? null);
    if (next !== undefined) free.delete(next);
  }
  return out;
}

function sameEntry(list: ListKey, a: string, b: string): boolean {
  if (list === "links") {
    const url = (s: string) =>
      normOption(s)
        .replace(/^https?:\/\/(www\.)?/, "")
        .replace(/\/+$/, "");
    return url(a) === url(b);
  }
  return sameText(a, b);
}

/** A field of a row (or of an Oracle item form, or a link field) filled from its profile entry. */
function rowField(field: Field, row: RowEntry, ctx: Ctx, kind: "row" | "item" | "link"): Decision {
  const entry = entries(row.list, ctx.profile, ctx.form)[row.index];
  const slot = slotOf(field, row.list);
  if (!entry || !slot) return { reason: "no-rule" };
  const rule = `${kind}:${row.list}[${row.index}].${slot}`;
  const base = { source: "profile" as const, rule };
  let value = slotValue(slot, entry, field);
  if (value === undefined) return { reason: "not-in-profile" };
  // The same link as the page shows it (a trailing slash, no "www."): kept as it is.
  const shown = field.currentValue;
  if (
    slot === "url" &&
    Array.isArray(value) &&
    typeof shown === "string" &&
    sameEntry("links", value[0] ?? "", shown)
  ) {
    value = [shown];
  }
  if (typeof value === "boolean") {
    return field.kind === "checkbox" ? { ...base, value } : { reason: "no-rule" };
  }
  // A date only into a date field: a text field's format is unknown.
  if ((slot === "start" || slot === "end") !== (field.kind === "date")) return { reason: "no-rule" };
  if (field.kind === "date") {
    const date = dateFor(field, value[0] ?? "");
    return date ? { ...base, value: date } : { reason: "no-rule" };
  }
  return toWidget(field, value, base, ctx);
}

/** The entry's value for a slot: the wordings it may have on the form, best first, or a checkbox's state. */
function slotValue(slot: Slot, e: Entry, field: Field): string[] | boolean | undefined {
  const one = (v: string | undefined | null) => (v?.trim() ? [v.trim()] : undefined);
  if ("company" in e) {
    if (slot === "title") return one(e.title);
    if (slot === "company") return one(e.company);
    if (slot === "location") return one(e.location);
    if (slot === "current") return e.end === null;
    if (slot === "start") return one(e.start);
    // No end date: the current role, whose "I currently work here" is ticked instead.
    if (slot === "end") return one(e.end);
    if (slot === "highlights") return e.highlights.length ? [e.highlights.join("\n")] : undefined;
    return undefined;
  }
  if ("school" in e) {
    if (slot === "school") return one(e.school);
    if (slot === "degree") return withAlternatives(e.degree, degreeWordings(e.degree));
    // Bare first: "Physics (Co-op)" names the field and how it's studied, and a typeahead (Workday's
    // Field of Study) searches by the one value it's sent.
    if (slot === "field") return e.field ? withAlternatives(bare(e.field), [e.field]) : undefined;
    if (slot === "gpa") return one(e.gpa);
    if (slot === "start") return one(e.start);
    if (slot === "end") return one(e.end);
    return undefined;
  }
  if ("language" in e) {
    if (slot === "language") return one(e.language);
    // "I am fluent in this language." on a native checkbox (seen live): ticked for native and fluent there.
    if (slot === "native")
      return e.proficiency === "native" || (e.proficiency === "fluent" && /fluent/i.test(field.label));
    if (slot === "level") return LEVELS[e.proficiency];
    return undefined;
  }
  return slot === "url" ? one(e.url) : undefined;
}

/**
 * Wordings of each profile proficiency on language-level lists, best first. Sites differ: Workday's live list
 * was "1 - Beginner" … "5 - Fluent" (strict matching takes "Fluent" for "5 - Fluent"); others use LinkedIn's
 * scale or plain words. The first wording the field's options hold is chosen.
 */
const LEVELS: Record<Profile["languages"][number]["proficiency"], string[]> = {
  native: ["Native", "Native or Bilingual", "Native or bilingual proficiency", "Bilingual", "Fluent", "Expert"],
  fluent: ["Fluent", "Full Professional", "Full professional proficiency", "Advanced", "Expert"],
  professional: ["Professional", "Professional Working", "Professional working proficiency", "Advanced", "Proficient"],
  conversational: ["Conversational", "Intermediate", "Limited Working", "Limited working proficiency"],
  basic: ["Basic", "Beginner", "Elementary", "Elementary proficiency", "Novice"],
};

/**
 * How degree lists name the profile's degree. Profiles say "Bachelor of Science"; Workday's live list said
 * "Bachelor's Degree", Oracle's "Bachelor’s degree". Matched strictly against the field's options, so a level
 * word never picks another level.
 */
function degreeWordings(degree: string): string[] {
  const d = degree.toLowerCase();
  if (/bachelor|\bb\.?(sc|a|eng|comm|ba)\b|undergrad/.test(d)) {
    return ["Bachelor's Degree", "Bachelor's", "Bachelors Degree", "Bachelors", "Bachelor", "Bachelor Degree"];
  }
  if (/master|\bm\.?(sc|a|eng|ba)\b|graduate degree/.test(d)) {
    return ["Master's Degree", "Master's", "Masters Degree", "Masters", "Master", "Master Degree"];
  }
  if (/doctor|ph\.?d/.test(d)) return ["Doctorate Degree", "Doctorate", "Doctoral Degree", "PhD", "Ph.D", "Ph.D."];
  if (/associate/.test(d)) return ["Associate's Degree", "Associate Degree", "Associate's", "Associates Degree"];
  if (/diploma|college/.test(d)) return ["College Diploma", "Diploma"];
  return [];
}

function withAlternatives(value: string, alternatives: string[]): string[] {
  const out = [value.trim()];
  for (const a of alternatives) if (a && !out.some((o) => normOption(o) === normOption(a))) out.push(a);
  return out;
}

/** A value without its trailing parenthetical: "Physics (Co-op)" → "Physics". */
function bare(v: string): string {
  return v.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** A profile `YYYY-MM` as the date field takes it: `YYYY` when it has only a year; a field wanting a day can't. */
function dateFor(field: Field, ym: string): string | undefined {
  if (!/^\d{4}(-\d{2})?$/.test(ym)) return undefined;
  const parts = field.dateParts;
  if (parts?.includes("DD")) return undefined;
  if (parts && !parts.includes("MM")) return ym.slice(0, 4);
  return ym.length === 4 ? undefined : ym;
}

// ---- which rows to add, which Oracle items are missing -------------------------------------------

/**
 * Rows to add before filling: for each list with an add button (Workday's `add.work-experience`, Oracle's
 * `add.link`) whose rows or link fields are fewer than the profile's entries. Never more than ten presses a
 * list. Oracle's work, education and language entries are inline forms instead (`missingItems`).
 */
export function rowsToAdd(form: FormSchema, profile: Profile): { addButtonId: string; list: ListKey; count: number }[] {
  const out: { addButtonId: string; list: ListKey; count: number }[] = [];
  const slots = listSlots(form);
  for (const b of form.addButtons) {
    const list = listOfButton(b);
    if (!list || !ROW_LISTS.includes(list) || out.some((o) => o.list === list)) continue;
    // An inline form's entries are added one by one (`missingItems`), not as rows.
    if (b.kind === "form") continue;
    const missing = profileCount(profile, list, form) - (slots.get(list)?.length ?? 0);
    if (missing > 0) out.push({ addButtonId: b.id, list, count: Math.min(missing, 10) });
  }
  return out;
}

/**
 * Oracle's work, education and language entries the page doesn't hold yet, each with the add button that opens its
 * inline form. An entry counts as held when a saved item's title names it (its company, school or language).
 */
export function missingItems(
  form: FormSchema,
  profile: Profile,
): { list: ListKey; addButtonId: string; index: number; name: string }[] {
  const out: { list: ListKey; addButtonId: string; index: number; name: string }[] = [];
  for (const list of ["work", "education", "languages"] as const) {
    const button = form.addButtons.find((b) => b.kind === "form" && listOfButton(b) === list);
    if (!button) continue;
    const saved = form.sections
      .filter((s) => savedItemOf(s) === list)
      .map((s) => normOption(s.title.split(":").slice(1).join(":")));
    entries(list, profile, form).forEach((e, index) => {
      const name = entryKey(list, e);
      // As whole words: a company called "A" isn't in every title with an "a".
      const named = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normOption(name))}(?![\\p{L}\\p{N}])`, "u");
      if (!saved.some((t) => named.test(t))) out.push({ list, addButtonId: button.id, index, name });
    });
  }
  return out;
}

// ---- widgets ------------------------------------------------------------------------------------

/**
 * The value as the widget takes it, from the wordings it may have (best first). Options listed in the schema
 * (radios, checkbox groups) are matched strictly here and sent as the option's exact text. Dropdowns and
 * typeaheads list theirs only when opened: one wording is sent as it is (the adapter matches it strictly, and
 * `checkReadBack` checks what got selected); several need the options first (`pending`), so the right wording is
 * chosen before the fill rather than by trying each.
 */
function toWidget(
  field: Field,
  wordings: string[],
  base: { source: AutofillSource; rule: string; answerId?: string },
  ctx: Pick<PlanInput, "options">,
): Decision {
  const value = wordings[0] ?? "";
  const decided = (v: FillValue): Decision => ({ ...base, value: v });
  switch (field.kind) {
    case "text":
    case "textarea":
    case "number":
      return decided(value);
    case "dropdown": {
      if (wordings.length === 1) return decided(value);
      // Already one of the wordings: kept without listing the options.
      const cur = field.currentValue;
      if (typeof cur === "string" && wordings.some((w) => strictMatch(w, cur))) return decided(cur);
      const key = optionKey(field);
      if (!ctx.options?.has(key)) return { pending: true };
      const options = ctx.options.get(key) ?? [];
      for (const w of wordings) {
        const i = strictIndex(w, options);
        if (i >= 0) return decided(options[i] as string);
      }
      return { reason: "no-strict-match" };
    }
    case "typeahead":
      // Filling only adds an entry: one already there stays unless it's the one wanted (then it's kept).
      if (!isEmptyValue(field.currentValue) && !alreadyHolds(field, value)) return { reason: "multi-select" };
      return decided(value);
    case "radio":
    case "checkbox-group": {
      for (const w of wordings) {
        const option = (field.options ?? []).find((o) => strictMatch(w, o));
        if (option) return decided(field.kind === "radio" ? option : [option]);
      }
      return { reason: "no-strict-match" };
    }
    case "date":
      // A stored date (an expected graduation date); a date the page doesn't take fails in the adapter.
      return /^\d{4}(-\d{2}){0,2}$/.test(value.trim()) ? decided(value.trim()) : { reason: "no-rule" };
    default:
      // A single checkbox takes only a row's yes or no (rowField).
      return { reason: "no-rule" };
  }
}

/**
 * Whether a fill took the value it was meant to. A dropdown or typeahead the adapter matched loosely (a prefix or
 * a substring: "Yes" picking "Yes, I will require sponsorship") counts as inexact: fine for the model, which reads
 * the read-back, not for a pass nobody checks field by field. Fills are sent `strict`, so an adapter that knows it
 * refuses a loose match itself; this also covers one built before.
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
  // A phone field formats the number as it's typed (Greenhouse's shows 647-555-0100 as (647) 555-0100), and may
  // put the country code in front: the digits are what must match.
  if (fill.rule === "hint:contact.phone.number") {
    const digits = (s: string) => s.replace(/\D/g, "");
    const want = digits(String(fill.value));
    if (want && got.some((g) => digits(g).endsWith(want))) return { ok: true };
  }
  const ok = wanted.every((w) => got.some((g) => strictMatch(w, g) || strictMatch(lastSegment(w), g)));
  return ok ? { ok: true } : { ok: false, selected: got.join(", ") };
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
  // A checkbox: unticked reads as false, which is a value here, not "empty".
  if (typeof value === "boolean") return (cur === true) === value;
  if (isEmptyValue(cur)) return false;
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

function sameText(a: string, b: string): boolean {
  return normOption(a) === normOption(b);
}

function lastSegment(path: string): string {
  return path.split(">").pop()?.trim() ?? path;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function at(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
