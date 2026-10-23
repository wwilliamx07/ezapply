import { type AnswerEntry, normalizeQuestion } from "../profile/schema.js";
import type { leanForm } from "./service.js";

type LeanForm = ReturnType<typeof leanForm>;
type LeanField = LeanForm["sections"][number]["fields"][number];

/** What get_form marks on a field, from this application's log and the answer bank. */
export interface FieldFacts {
  /** Field ids this application filled (successful `fill` events), or null when no posting is credited. */
  filled: ReadonlySet<string> | null;
  /** File names this application uploaded. */
  uploaded: ReadonlySet<string>;
  /** The answer bank's questions by their normalised wording (`canonical` and `variants`). */
  bank: ReadonlyMap<string, string>;
}

/**
 * Mark the fields the agent must look at, so it doesn't have to find them:
 * - `prefilled`: a value this application didn't fill, from the site's resume parsing or a previous application.
 *   Seen live, the agent left such fields as they came; it checks them like empty ones.
 * - `stale`: files in a file field this application didn't upload, even with a current document's name.
 * - `bankMatch`: the answer bank's entry whose question is worded exactly like the label (case and punctuation
 *   aside). A question worded otherwise is still the agent's to match by meaning; the value, polarity and option
 *   always are.
 * Without a posting credited, only `bankMatch` is marked: nothing says what this application filled.
 */
export function markFields(form: LeanForm, facts: FieldFacts): LeanForm {
  const sections = form.sections.map((s) => ({ ...s, fields: s.fields.map((f) => mark(f, facts)) }));
  return { ...form, sections };
}

function mark(f: LeanField, facts: FieldFacts): LeanField & { prefilled?: true; stale?: string[]; bankMatch?: string } {
  const out: LeanField & { prefilled?: true; stale?: string[]; bankMatch?: string } = { ...f };
  if (facts.filled && f.kind === "file" && Array.isArray(f.currentValue)) {
    const stale = f.currentValue.filter((name) => !facts.uploaded.has(name));
    if (stale.length) out.stale = stale;
  } else if (facts.filled && hasValue(f.currentValue) && !facts.filled.has(f.id)) out.prefilled = true;
  const match = facts.bank.get(normalizeQuestion(f.label));
  if (match) out.bankMatch = match;
  return out;
}

function hasValue(v: LeanField["currentValue"]): boolean {
  return typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.length > 0 : v === true;
}

/** The answer bank's questions by their normalised wording; a wording two entries share matches neither. */
export function bankIndex(entries: AnswerEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  const shared = new Set<string>();
  for (const e of entries) {
    for (const q of [e.canonical, ...e.variants]) {
      const key = normalizeQuestion(q);
      if (!key) continue;
      const had = out.get(key);
      if (had && had !== e.id) shared.add(key);
      else out.set(key, e.id);
    }
  }
  for (const key of shared) out.delete(key);
  return out;
}
