import type { Field } from "@ezapply/protocol";
import { parseDate, settle, win } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import { act, outside } from "../engine/trace.js";
import type { FillOutcome, WidgetDriver } from "../engine/types.js";

/**
 * A date picker from UI5 Web Components (SAP's component library: SuccessFactors' dates). An app may register the
 * component under a scoped tag (`ui5-date-picker-xweb-calendar-widget`), but every instance carries the
 * `ui5-date-picker` attribute, so that's what's looked for. Its input sits in nested shadow roots.
 *
 * Driven the way the component reports a date the user entered: its `value` set in its own format (`format-pattern`,
 * `MM/dd/yyyy`), then the `change` event it fires, whose detail is `{ value, valid }`. That event is what an app
 * listens to: SuccessFactors' calendar widget reads `detail.value` and `detail.valid` from it and passes the date on
 * to its form (read from the widget's script). Typing into the inner input would need the shadow roots, focus and a
 * blur to end in the same event.
 */

const PICKER = "[ui5-date-picker]";

type Picker = HTMLElement & { value?: unknown; formatPattern?: unknown };

const pickerOf = (c: HTMLElement) => (c.matches(PICKER) ? c : c.querySelector<HTMLElement>(PICKER)) as Picker | null;

/** The date as the component holds it: its property on a live page, else the attribute (a saved one). */
const dateOf = (p: Picker) => (typeof p.value === "string" ? p.value : (p.getAttribute("value") ?? ""));

const patternOf = (p: Picker) =>
  (typeof p.formatPattern === "string" && p.formatPattern) || p.getAttribute("format-pattern") || "MM/dd/yyyy";

/** The parts the pattern asks for, in its order: `MM/dd/yyyy` → MM, DD, YYYY. */
function partsOf(pattern: string): NonNullable<Field["dateParts"]> {
  const out: NonNullable<Field["dateParts"]> = [];
  for (const token of pattern.match(/y+|M+|d+/g) ?? []) {
    const part = token[0] === "y" ? "YYYY" : token[0] === "M" ? "MM" : "DD";
    if (!out.includes(part)) out.push(part);
  }
  return out;
}

/** A date in the pattern's numeric form; undefined for a pattern with month names (`MMM`), which isn't written. */
function format(pattern: string, d: { year: string; month: string; day: string }): string | undefined {
  if (/M{3,}|E/.test(pattern)) return undefined;
  return pattern.replace(/y+|M+|d+/g, (t) =>
    t[0] === "y"
      ? t.length === 2
        ? d.year.slice(2)
        : d.year
      : (t[0] === "M" ? d.month : d.day).padStart(t.length, "0"),
  );
}

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

export function ui5DatePickerDriver(): WidgetDriver {
  return {
    kind: "date",
    is: (c) => Boolean(pickerOf(c)),
    value: (c) => {
      const p = pickerOf(c);
      return p ? dateOf(p) || null : null;
    },
    dateParts: (c) => {
      const p = pickerOf(c);
      return p ? partsOf(patternOf(p)) : undefined;
    },
    fill: async (c, value) => {
      const p = pickerOf(c);
      if (!p) return fail("No date picker found in the field.");
      if (p.hasAttribute("disabled") || p.hasAttribute("readonly")) {
        return fail("This date is read-only on the page.", { readBack: dateOf(p) });
      }
      const pattern = patternOf(p);
      const parts = partsOf(pattern);
      const date = parseDate(Array.isArray(value) ? (value[0] ?? "") : String(value));
      if (!date) return fail(`Give the date as YYYY-MM-DD (the page shows ${pattern}).`, { readBack: dateOf(p) });
      if ((parts.includes("DD") && !date.day) || (parts.includes("MM") && !date.month)) {
        return fail(`This date takes a ${parts.includes("DD") ? "day" : "month"}: give it as YYYY-MM-DD.`, {
          readBack: dateOf(p),
        });
      }
      const wanted = format(pattern, { year: date.year, month: date.month ?? "1", day: date.day ?? "1" });
      if (!wanted) return fail(`The page's date format (${pattern}) names months: type the date in it yourself.`);
      const w = win(p);
      act("input", p, { value: wanted });
      outside(() => {
        p.value = wanted;
        p.dispatchEvent(
          new w.CustomEvent("change", { bubbles: true, composed: true, detail: { value: wanted, valid: true } }),
        );
      });
      await settle(p.ownerDocument, T.dateQuietMs, T.dateMaxMs);
      const readBack = dateOf(p);
      return readBack === wanted ? { ok: true, readBack } : fail("The date did not stick.", { readBack });
    },
  };
}
