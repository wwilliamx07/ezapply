import type { FillValue, OptionInfo } from "@ezapply/protocol";
import { blur, key, matchOption, norm, press, setNativeValue, settle, text, waitFor } from "../dom.js";
import { T } from "../timing.js";
import type { FillOutcome, WidgetDriver } from "../types.js";

/**
 * A search-as-you-type field whose suggestions appear in a list (a location): type the value, wait for the
 * suggestions, choose one. `input` finds the text input in the field container; `options` the suggestions on screen
 * for it (by default the `role=option`s of the listbox its `aria-controls` names, else of the nearest listbox).
 */
export interface ComboboxSpec {
  input?: (c: HTMLElement) => HTMLInputElement | null;
  options?: (c: HTMLElement, input: HTMLInputElement) => HTMLElement[];
  /** What the field shows once a suggestion is chosen, when not the input's value. */
  value?: (c: HTMLElement, input: HTMLInputElement) => string;
}

const ariaOptions = (c: HTMLElement, input: HTMLInputElement) => {
  const doc = input.ownerDocument;
  const id = input.getAttribute("aria-controls") ?? input.getAttribute("aria-owns");
  const list =
    (id ? doc.getElementById(id) : null) ??
    c.querySelector("[role='listbox']") ??
    doc.querySelector("[role='listbox']");
  return list ? [...list.querySelectorAll<HTMLElement>("[role='option']")] : [];
};

export function comboboxDriver(spec: ComboboxSpec = {}): WidgetDriver {
  const input = spec.input ?? ((c: HTMLElement) => c.querySelector<HTMLInputElement>("input[role='combobox']"));
  const options = spec.options ?? ariaOptions;
  const shown = (c: HTMLElement, i: HTMLInputElement) => norm(spec.value ? spec.value(c, i) : i.value);
  const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

  /**
   * Type the query, and wait until the suggestions differ from those before. A search can bring the same
   * suggestions as the last one: once the wait is over, the suggestions on screen are used (each is matched against
   * the value anyway).
   */
  async function suggest(c: HTMLElement, i: HTMLInputElement, query: string): Promise<HTMLElement[]> {
    const before = options(c, i).map(text).join("\u0001");
    i.focus();
    i.dispatchEvent(
      new (i.ownerDocument.defaultView as Window & typeof globalThis).FocusEvent("focusin", { bubbles: true }),
    );
    setNativeValue(i, query);
    // Some fields search on key events, not input (Lever's location field, seen live): the last key as typed.
    key(i, query.slice(-1));
    await waitFor(() => {
      const now = options(c, i);
      return now.length && now.map(text).join("\u0001") !== before ? now : null;
    }, T.typeaheadResultsMs);
    await settle(i.ownerDocument, T.typeaheadResultsQuietMs, T.typeaheadResultsMaxMs);
    return options(c, i);
  }

  return {
    kind: "typeahead",
    is: (c) => Boolean(input(c)),
    value: (c) => {
      const i = input(c);
      const v = i ? shown(c, i) : "";
      return v ? [v] : [];
    },
    multiple: () => false,
    lazyOptions: true,
    search: async (c, query): Promise<OptionInfo[]> => {
      const i = input(c);
      if (!i) return [];
      const found = (await suggest(c, i, query)).map((o) => ({ label: text(o) })).filter((o) => o.label);
      key(i, "Escape");
      return found;
    },
    fill: async (c, value: FillValue) => {
      const i = input(c);
      if (!i) return fail("No input found in the field.");
      const wanted = Array.isArray(value) ? String(value[0] ?? "") : String(value);
      const found = await suggest(c, i, wanted);
      const labels = found.map(text);
      const idx = matchOption(wanted, labels);
      if (idx < 0) {
        key(i, "Escape");
        blur(i);
        return fail(`No suggestion matches "${wanted}".`, {
          readBack: [],
          unmatched: [{ value: wanted, suggestions: labels.slice(0, 15) }],
        });
      }
      const option = found[idx] as HTMLElement;
      press(option);
      const label = labels[idx] as string;
      await waitFor(() => shown(c, i) !== "" && options(c, i).length === 0, T.dropdownSelectMs);
      await settle(i.ownerDocument, T.typeaheadSelectQuietMs, T.typeaheadSelectMaxMs);
      const readBack = shown(c, i);
      return readBack ? { ok: true, readBack: [readBack] } : fail(`"${label}" wasn't taken.`, { readBack: [] });
    },
  };
}
