import {
  blur,
  callReact,
  parseDate,
  press,
  setNativeValue,
  settle,
  sleep,
  text,
  typeChar,
  win,
} from "@ezapply/engine/dom";
import { T } from "@ezapply/engine/timing";
import { branch } from "@ezapply/engine/trace";
import type { FillOutcome, WidgetDriver } from "@ezapply/engine/types";
import { fieldError } from "./page.js";
import { SEL } from "./selectors.js";

/** Workday's split date: a Month, Day and Year part (any of them), each its own input. */

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

/**
 * What one part of a split date holds as far as the page is concerned. Live Workday keeps the part's value in
 * its own state and shows it in a display element next to the input; setting the input's value changes the
 * input but not that state (seen live: the input read "12" while Workday said the field was empty). So the
 * display counts when there is one, then `aria-valuenow`, then the input's value.
 */
function datePartValue(input: HTMLInputElement): string {
  const display = input.parentElement?.querySelector(SEL.datePartDisplay);
  if (display) {
    const t = text(display);
    return /^\d+$/.test(t) ? t : "";
  }
  const now = input.getAttribute("aria-valuenow");
  if (now !== null) return /^\d+$/.test(now.trim()) ? now.trim() : "";
  return input.value.trim();
}

function datePartInput(c: HTMLElement, part: "Month" | "Day" | "Year"): HTMLInputElement | null {
  return c.querySelector<HTMLInputElement>(`input[aria-label="${part}" i]`);
}

/** The date as YYYY, YYYY-MM or YYYY-MM-DD from the parts the field has; null when all are empty. */
function dateValue(c: HTMLElement): string | null {
  const part = (p: "Month" | "Day" | "Year") => {
    const input = datePartInput(c, p);
    return input ? datePartValue(input) : "";
  };
  const [y, m, d] = [part("Year"), part("Month"), part("Day")];
  if (!y && !m && !d) return null;
  return [y, m, d]
    .filter(Boolean)
    .map((v, i) => (i === 0 ? v : v.padStart(2, "0")))
    .join("-");
}

function dateParts(c: HTMLElement): ("MM" | "DD" | "YYYY")[] {
  const has = (l: string) => Boolean(c.querySelector(`input[aria-label="${l}" i]`));
  return [
    ...(has("Month") ? (["MM"] as const) : []),
    ...(has("Day") ? (["DD"] as const) : []),
    ...(has("Year") ? (["YYYY"] as const) : []),
  ];
}

/**
 * Enter one date part the way a person does: click it, type the digits, leave it. Live Workday's parts take
 * digits in their key handlers and keep the value in their own state; setting the input's value (what this
 * did before) showed the digits while Workday still called the field empty, however often it was repeated.
 * When typing leaves the part without the value (a plain input that ignores synthetic keys), the value is set
 * directly as a last resort.
 */
async function enterDatePart(input: HTMLInputElement, v: string): Promise<void> {
  const display = input.parentElement?.querySelector<HTMLElement>(SEL.datePartDisplay);
  press(display ?? input);
  input.focus();
  const start = input.value;
  for (const [i, ch] of [...v].entries()) {
    typeChar(input, ch, i === 0);
    await sleep(T.dateDigitMs);
  }
  if (Number(datePartValue(input)) !== Number(v)) {
    branch("date part set directly", { typed: datePartValue(input), wanted: v });
    setNativeValue(input, v);
    if (Number(input.value) !== Number(v)) callReact(input, "onChange", { target: { ...input, value: v } });
  } else if (input.value !== start) {
    // A browser fires change when a typed-in input loses focus.
    input.dispatchEvent(new (win(input).Event)("change", { bubbles: true }));
  }
  blur(input);
  await sleep(T.datePartMs);
}

async function fillDate(c: HTMLElement, value: string): Promise<FillOutcome> {
  const date = parseDate(value);
  if (!date) return fail('Dates must be "YYYY-MM-DD", "YYYY-MM" or "YYYY" (or "MM/YYYY", "MM/DD/YYYY").');
  const month = date.month?.padStart(2, "0");
  const day = date.day?.padStart(2, "0");
  const parts: [HTMLInputElement, string][] = [];
  for (const [label, v] of [
    ["Month", month],
    ["Day", day],
    ["Year", date.year],
  ] as const) {
    const input = datePartInput(c, label);
    if (!input) continue;
    if (v === undefined) return fail(`This date needs a ${label.toLowerCase()}.`);
    parts.push([input, v]);
  }
  const enter = async () => {
    for (const [input, v] of parts) await enterDatePart(input, v);
    await settle(c.ownerDocument, T.dateQuietMs, T.dateMaxMs);
  };
  await enter();
  // Seen live: a date field showing a "required" error took a second entry. One more pass when it still does.
  const error = fieldError(c);
  if (error) {
    branch("date entered again", { error });
    await enter();
  }
  const readBack = dateValue(c) ?? "";
  const has = (p: "Month" | "Day" | "Year") => Boolean(datePartInput(c, p));
  const want = [has("Year") && date.year, has("Month") && month, has("Day") && day].filter(Boolean).join("-");
  return readBack === want
    ? { ok: true, readBack }
    : fail(
        "The page didn't take the date: its parts show " +
          `"${readBack || "nothing"}". Ask the user to type it (${parts.map(([, v]) => v).join("/")}).`,
        { readBack },
      );
}

const partLabels = (c: HTMLElement) =>
  [...c.querySelectorAll("input")].map((i) => (i.getAttribute("aria-label") ?? "").toLowerCase());

export const dateDriver: WidgetDriver = {
  kind: "date",
  is: (c) => partLabels(c).includes("year") || partLabels(c).includes("month"),
  value: dateValue,
  dateParts,
  fill: (c, value) => fillDate(c, Array.isArray(value) ? value.join(", ") : String(value)),
};
