import type { FormSchema } from "@ezapply/protocol";
import type { Profile } from "../profile/schema.js";
import { hasLinkedInField, LISTS, listOfButton, listSlots, profileCount } from "./lists.js";

/**
 * The hand-off checklist, kept by the companion instead of the model's memory. The ezapply-apply skill asks for a
 * list at the review page (documents attached, every add-button section filled, files left from a previous
 * application removed, answers from the user or judgment flagged), and live runs missed parts of it: the cover
 * letter twice (now `notAttached`), and sections that start empty are easy to miss. The companion has the facts:
 * the page, the profile, and form-log.jsonl.
 *
 * Two parts: `stepWarnings` on each step (get_form, autofill_step, and logged by go_next as the step is left),
 * and `handoff` at the review page, from the log. Warnings are things to check, never errors: a row count can
 * be right on purpose (the user left out an old job).
 */

/**
 * What looks off on this step: a repeatable section whose row count differs from the profile's list, and file
 * fields holding files this application didn't upload. `uploaded` holds the file names uploaded to this
 * application (form-log.jsonl).
 */
export function stepWarnings(form: FormSchema, profile: Profile | null, uploaded: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (profile) {
    const seen = new Set<string>();
    const slots = listSlots(form);
    for (const b of form.addButtons) {
      // By the button's label first: Oracle's Add Experience and Add Education share one section.
      const list = listOfButton(b);
      if (!list || seen.has(list)) continue;
      seen.add(list);
      const title = b.section ?? b.label;
      const withLinkedIn = list === "links" && !hasLinkedInField(form);
      const name = withLinkedIn ? "links" : (LISTS.find((l) => l.key === list)?.name ?? list);
      const want = profileCount(profile, list, form);
      // Workday's rows (`work-experience-2`), Oracle's saved items (`languages.item-2`) and link fields.
      const rows = slots.get(list)?.length ?? 0;
      if (rows < want) {
        out.push(`${title}: the page has ${rows} row${rows === 1 ? "" : "s"}, the profile has ${want} ${name}.`);
      } else if (rows > want) {
        out.push(
          `${title}: the page has ${rows} rows, the profile has ${want} ${name} (left from a previous application?).`,
        );
      }
    }
  }
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (f.kind !== "file" || !Array.isArray(f.currentValue)) continue;
      const stale = f.currentValue.filter((name) => !uploaded.has(name));
      if (stale.length) {
        out.push(
          `${f.label} holds ${stale.join(", ")}, which this application didn't upload (left from a previous ` +
            "application? remove_items it).",
        );
      }
    }
  }
  return out;
}

/** One line of form-log.jsonl, as far as the checklist reads it. */
export interface LogEvent {
  event: string;
  fieldId?: string;
  value?: unknown;
  source?: string;
  ok?: boolean;
  auto?: boolean;
  was?: unknown;
  file?: string;
  removed?: unknown;
  reason?: string;
  sectionId?: string;
  step?: string;
  stepIndex?: number;
  warnings?: string[];
}

export interface Handoff {
  /** Warnings from the last time each step was left, for steps that still had any. */
  steps: { step: string; warnings: string[] }[];
  /** Answers from the user or your judgment: flag them for a second look. */
  answersToFlag: { fieldId: string; value: unknown; source: string }[];
  /** Fields autofill_step filled, by section. */
  automatic: Record<string, string[]>;
  /** Values autofill_step overwrote (left from a previous application). */
  replaced: { fieldId: string; was: unknown; now: unknown }[];
  /** What was removed: old attachments, entries, rows. */
  removed: { what: string; reason?: string }[];
}

/** The hand-off summary from this posting's log: what the skill's hand-off message lists. */
export function handoff(events: LogEvent[]): Handoff {
  const lastFill = new Map<string, LogEvent>();
  const steps = new Map<string, string[]>();
  const removed: Handoff["removed"] = [];
  for (const e of events) {
    if (e.event === "fill" && e.ok && e.fieldId) lastFill.set(e.fieldId, e);
    if (e.event === "step-check") steps.set(String(e.stepIndex ?? e.step ?? "?"), e.warnings ?? []);
    if (e.event === "remove" && e.ok) {
      removed.push({ what: `${e.fieldId}: ${JSON.stringify(e.removed)}`, ...(e.reason ? { reason: e.reason } : {}) });
    }
    if (e.event === "remove-row" && e.ok) {
      removed.push({
        what: `${e.sectionId}${e.removed ? ` (${e.removed})` : ""}`,
        ...(e.reason ? { reason: e.reason } : {}),
      });
    }
  }
  const fills = [...lastFill.values()];
  const automatic: Record<string, string[]> = {};
  for (const f of fills.filter((x) => x.auto)) {
    const section = f.fieldId?.split(".")[0] ?? "";
    automatic[section] = [
      ...(automatic[section] ?? []),
      `${f.fieldId?.split(".").slice(1).join(".")} = ${JSON.stringify(f.value)}`,
    ];
  }
  return {
    steps: [...steps].filter(([, w]) => w.length > 0).map(([step, warnings]) => ({ step, warnings })),
    answersToFlag: fills
      .filter((f) => f.source === "user" || f.source === "judgment")
      .map((f) => ({ fieldId: f.fieldId as string, value: f.value, source: f.source as string })),
    automatic,
    replaced: fills
      .filter((f) => f.auto && f.was !== undefined)
      .map((f) => ({ fieldId: f.fieldId as string, was: f.was, now: f.value })),
    removed,
  };
}
