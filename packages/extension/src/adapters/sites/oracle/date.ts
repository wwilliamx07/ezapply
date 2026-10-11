import { norm, parseDate, settle } from "../../engine/dom.js";
import { T } from "../../engine/timing.js";
import type { FillOutcome, WidgetDriver } from "../../engine/types.js";
import { comboInput, fillCombo } from "./combo.js";
import { SEL } from "./selectors.js";

/** Oracle's date: a month, day and year list (any of them), each a cx-select, in the row's own order. */

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

/** The date parts a date row has, in its own order (month, day, year). */
function datePartInputs(c: HTMLElement): { part: "MM" | "DD" | "YYYY"; input: HTMLInputElement }[] {
  const out: { part: "MM" | "DD" | "YYYY"; input: HTMLInputElement }[] = [];
  for (const el of c.querySelectorAll<HTMLElement>(SEL.datePart)) {
    const input = comboInput(el) ?? el.querySelector<HTMLInputElement>("input");
    if (!input) continue;
    const cls = el.className;
    const part = /--month/.test(cls) ? "MM" : /--day/.test(cls) ? "DD" : /--year/.test(cls) ? "YYYY" : null;
    if (part) out.push({ part, input });
  }
  return out;
}

function dateParts(c: HTMLElement): ("MM" | "DD" | "YYYY")[] {
  return datePartInputs(c).map((p) => p.part);
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A month as the page shows it ("March", "Mar", "3", "03") → 1–12, or 0 when it isn't one. */
function monthNumber(s: string): number {
  const v = norm(s).toLowerCase();
  if (/^\d{1,2}$/.test(v)) return Number(v) >= 1 && Number(v) <= 12 ? Number(v) : 0;
  const i = MONTHS.findIndex((m) => v.length >= 3 && m.startsWith(v.replace(/\.$/, "")));
  return i + 1;
}

function monthNames(m: number): string[] {
  const name = MONTHS[m - 1] ?? "";
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return [cap, cap.slice(0, 3), String(m).padStart(2, "0"), String(m)];
}

/** The date as YYYY, YYYY-MM or YYYY-MM-DD from what its parts show; null when all are empty. */
function dateValue(c: HTMLElement): string | null {
  const parts = datePartInputs(c);
  const get = (p: "MM" | "DD" | "YYYY") => norm(parts.find((x) => x.part === p)?.input.value);
  const [y, mRaw, d] = [get("YYYY"), get("MM"), get("DD")];
  if (!y && !mRaw && !d) return null;
  const m = mRaw ? String(monthNumber(mRaw) || mRaw) : "";
  return [y, m, d]
    .filter(Boolean)
    .map((v, i) => (i === 0 ? v : v.padStart(2, "0")))
    .join("-");
}

async function fillDate(c: HTMLElement, value: string): Promise<FillOutcome> {
  const date = parseDate(value);
  if (!date) return fail('Dates must be "YYYY-MM-DD", "YYYY-MM" or "YYYY" (or "MM/YYYY", "MM/DD/YYYY").');
  const parts = datePartInputs(c);
  const month = date.month ? Number(date.month) : undefined;
  const day = date.day ? Number(date.day) : undefined;
  const wanted: string[] = [];
  const problems: string[] = [];
  for (const { part, input } of parts) {
    const candidates =
      part === "YYYY"
        ? [date.year]
        : part === "MM"
          ? month && monthNames(month)
          : day && [String(day).padStart(2, "0"), String(day)];
    if (!candidates) return fail(`This date needs a ${part === "MM" ? "month" : "day"}.`);
    const r = await fillCombo(input, candidates);
    if (!r.ok) problems.push(`${part}: ${r.error}`);
  }
  await settle(c.ownerDocument, T.dateQuietMs, T.dateMaxMs);
  const has = (p: string) => parts.some((x) => x.part === p);
  if (has("YYYY")) wanted.push(date.year);
  if (has("MM") && month) wanted.push(String(month).padStart(2, "0"));
  if (has("DD") && day) wanted.push(String(day).padStart(2, "0"));
  const readBack = dateValue(c) ?? "";
  return readBack === wanted.join("-") && !problems.length
    ? { ok: true, readBack }
    : fail(`The date shows "${readBack || "nothing"}". ${problems.join(" ")}`.trim(), { readBack });
}

export const dateDriver: WidgetDriver = {
  kind: "date",
  is: (c) => c.matches(SEL.dateRow) || Boolean(c.querySelector(SEL.datePart)),
  value: dateValue,
  dateParts,
  fill: (c, value) => fillDate(c, Array.isArray(value) ? value.join(", ") : String(value)),
};
