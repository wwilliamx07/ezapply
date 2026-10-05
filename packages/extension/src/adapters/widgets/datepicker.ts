import type { FillValue } from "@ezapply/protocol";
import { parseDate, press, text, waitFor, win } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import type { FillOutcome, WidgetDriver } from "../engine/types.js";

/**
 * A react-datepicker that picks a month (`MM/YYYY`), as Phenom's work dates do. Its text input takes no typing:
 * a typed value, even from trusted keys, is put back at once (seen live), so the calendar is driven instead. Open it
 * from the input, choose the year in its header (a year list, else the header's previous and next arrows), then
 * press the month. The months it won't allow (before the start date, after today) are disabled, and the year list
 * offers only the years in range, which a refusal names.
 */

const MONTH_CELL = ".react-datepicker__month-text";

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

export function monthPickerDriver(): WidgetDriver {
  const input = (c: HTMLElement) =>
    c.querySelector<HTMLInputElement>(".react-datepicker__input-container input, .react-datepicker-wrapper input");
  const calendar = (doc: Document) => doc.querySelector<HTMLElement>(".react-datepicker");
  /** The year the calendar shows: its month list's label ("month  2026-10"), else a month's ("Choose August 2026"). */
  const shownYear = (cal: HTMLElement) => {
    const label =
      cal.querySelector(".react-datepicker__month")?.getAttribute("aria-label") ??
      cal.querySelector(`${MONTH_CELL}[aria-label]`)?.getAttribute("aria-label") ??
      "";
    return /(\d{4})/.exec(label)?.[1];
  };

  async function toYear(cal: HTMLElement, year: string): Promise<string | undefined> {
    const list = cal.querySelector<HTMLSelectElement>(".react-datepicker__header select");
    if (list) {
      const years = [...list.options].map((o) => o.value);
      if (!years.includes(year)) return `Only ${years[0]}–${years.at(-1)} can be chosen here.`;
      const w = win(list);
      const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, "value")?.set;
      if (setter) setter.call(list, year);
      else list.value = year;
      list.dispatchEvent(new w.Event("change", { bubbles: true }));
    } else {
      const arrows = [
        ...cal.querySelectorAll<HTMLElement>(".react-datepicker__header button, .react-datepicker__navigation"),
      ];
      const prev = arrows.find((b) => /prev/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.className}`));
      const next = arrows.find((b) => /next/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.className}`));
      for (let i = 0; i < 60 && shownYear(cal) !== year; i++) {
        const shown = Number(shownYear(cal));
        const arrow = shown > Number(year) ? prev : next;
        if (!arrow || arrow.hasAttribute("disabled")) break;
        press(arrow);
        await waitFor(() => shownYear(cal) !== String(shown), T.dropdownOpenMs);
      }
    }
    return (await waitFor(() => shownYear(cal) === year, T.dropdownSelectMs))
      ? undefined
      : `${year} can't be chosen here.`;
  }

  return {
    kind: "date",
    is: (c) => Boolean(input(c)),
    value: (c) => input(c)?.value || null,
    dateParts: () => ["MM", "YYYY"],
    fill: async (c, value: FillValue) => {
      const i = input(c);
      if (!i) return fail("No date input found.");
      const d = parseDate(Array.isArray(value) ? String(value[0] ?? "") : String(value));
      if (!d?.month) return fail('This date takes a month and year: "YYYY-MM".', { readBack: i.value });
      const want = `${d.month.padStart(2, "0")}/${d.year}`;
      if (i.value === want) return { ok: true, readBack: want };
      const doc = i.ownerDocument;
      if (!calendar(doc)) {
        i.focus();
        press(i);
      }
      const cal = await waitFor(() => calendar(doc), T.dropdownOpenMs * 5);
      if (!cal) return fail("The calendar didn't open.", { readBack: i.value });
      const refused = await toYear(cal, d.year);
      if (refused) return fail(refused, { readBack: i.value });
      const month = cal.querySelector<HTMLElement>(`${MONTH_CELL}.react-datepicker__month-${Number(d.month) - 1}`);
      if (!month) return fail("The calendar shows no months to choose.", { readBack: i.value });
      if (month.getAttribute("aria-disabled") === "true" || /--disabled/.test(month.className)) {
        return fail(`${text(month)} ${d.year} can't be chosen here (outside the dates the page allows).`, {
          readBack: i.value,
        });
      }
      press(month);
      const took = await waitFor(() => i.value === want, T.dropdownSelectMs * 5);
      return took ? { ok: true, readBack: want } : fail("The date wasn't taken.", { readBack: i.value });
    },
  };
}
