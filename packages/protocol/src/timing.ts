/**
 * The waits the form adapters use, in milliseconds. Each site owns its waits: its registry entry (`sites.ts`)
 * says how long each one is, and the adapter's engine only waits where the site's definition says. These are the
 * standard values a site starts from (measured on Workday, the first site). The companion reads the user's
 * overrides from `autofill-timing.yaml`, resolves them against the site's own waits, and sends the result with
 * every form call. A "quiet" wait ends once the page has stopped changing for that long; its "max" ends it
 * regardless. Other waits end as soon as what they wait for happens, so they only cost their full length when it
 * doesn't.
 */
export const STANDARD_WAITS = {
  pollMs: 50,
  afterFieldQuietMs: 120,
  afterFieldMaxMs: 1500,
  textCheckMs: 30,
  dropdownOthersClosedMs: 200,
  dropdownAfterEscapeMs: 500,
  dropdownOpenMs: 200,
  dropdownOpenRetryMs: 200,
  dropdownSelectMs: 200,
  dropdownSelectRetryMs: 200,
  dropdownCloseKeyMs: 50,
  dropdownEscapeCloseMs: 300,
  dropdownClosedMs: 200,
  typeaheadFocusQuietMs: 150,
  typeaheadFocusMaxMs: 1000,
  typeaheadResultsMs: 4000,
  typeaheadResultsRetryMs: 2000,
  typeaheadNoResultsMs: 2000,
  typeaheadClearMs: 1000,
  typeaheadResultsQuietMs: 150,
  typeaheadResultsMaxMs: 1500,
  typeaheadMenuQuietMs: 300,
  typeaheadMenuMaxMs: 2500,
  typeaheadOptionsMs: 2500,
  typeaheadSelectQuietMs: 250,
  typeaheadSelectMaxMs: 2000,
  checkMs: 1000,
  dateDigitMs: 15,
  datePartMs: 40,
  dateQuietMs: 150,
  dateMaxMs: 1500,
  uploadMs: 8000,
  uploadDropMs: 20000,
  removeMs: 1500,
  removeKeyMs: 800,
  removeQuietMs: 150,
  removeMaxMs: 1500,
  addRowMs: 4000,
  removeRowMs: 1500,
  removeRowConfirmMs: 2500,
  rowQuietMs: 200,
  rowMaxMs: 2000,
  stepMs: 12000,
  stepFieldsMs: 3000,
  stepQuietMs: 300,
  stepMaxMs: 4000,
  pageActionQuietMs: 400,
  pageActionMaxMs: 8000,
} as const;

export type TimingKey = keyof typeof STANDARD_WAITS;
export type Timing = Record<TimingKey, number>;

/** What each wait is for, written into `autofill-timing.yaml` next to it. */
export const TIMING_DOCS: Record<TimingKey, string> = {
  pollMs: "how often a wait checks again (not scaled)",
  afterFieldQuietMs: "after each field: wait for the page to be quiet this long",
  afterFieldMaxMs: "after each field: but never longer than this",
  textCheckMs: "text field: pause before checking the value took",
  dropdownOthersClosedMs: "dropdown: wait for another dropdown's list to close before opening",
  dropdownAfterEscapeMs: "dropdown: then, after pressing Escape on it, wait this long",
  dropdownOpenMs: "dropdown: wait for its list to appear after the click",
  dropdownOpenRetryMs: "dropdown: wait again after the fallback click (then 'Could not open the dropdown')",
  dropdownSelectMs: "dropdown: wait for the chosen option to show on the button",
  dropdownSelectRetryMs: "dropdown: wait again after the fallback click on the option",
  dropdownCloseKeyMs: "dropdown: pause after Escape before checking the list closed",
  dropdownEscapeCloseMs: "dropdown, nothing chosen: wait for Escape to close its list, then click its button",
  dropdownClosedMs: "dropdown: wait for its list to disappear",
  typeaheadFocusQuietMs: "typeahead (skills, school…): after clicking into it, wait for quiet",
  typeaheadFocusMaxMs: "typeahead: but never longer than this",
  typeaheadResultsMs: "typeahead: wait for this search's results",
  typeaheadResultsRetryMs: "typeahead: wait again after pressing Enter a second way",
  typeaheadNoResultsMs: "typeahead: how long 'No Items.' must stay to count as no results",
  typeaheadClearMs: "typeahead (Oracle): after clearing a search that didn't run, wait before typing it again",
  typeaheadResultsQuietMs: "typeahead: after the results show, wait for quiet",
  typeaheadResultsMaxMs: "typeahead: but never longer than this",
  typeaheadMenuQuietMs: "typeahead: after opening its menu (nested menus, list_options), wait for quiet",
  typeaheadMenuMaxMs: "typeahead: but never longer than this",
  typeaheadOptionsMs: "typeahead: wait for options to be on screen before picking one",
  typeaheadSelectQuietMs: "typeahead: after picking an option, wait for quiet",
  typeaheadSelectMaxMs: "typeahead: but never longer than this",
  checkMs: "radio and checkbox: wait for the click to take",
  dateDigitMs: "date: pause between typed digits",
  datePartMs: "date: pause after each part (month, day, year)",
  dateQuietMs: "date: after all parts, wait for quiet",
  dateMaxMs: "date: but never longer than this",
  uploadMs: "upload: wait for the file to show in the field",
  uploadDropMs: "upload: wait again after dropping it on the drop zone instead",
  removeMs: "remove_items: wait for an entry to go after each attempt",
  removeKeyMs: "remove_items: wait after the Delete / Backspace fallback",
  removeQuietMs: "remove_items: after each removal, wait for quiet",
  removeMaxMs: "remove_items: but never longer than this",
  addRowMs: "add_repeatable: wait for the new row's fields",
  removeRowMs: "remove_repeatable: wait for the row to go",
  removeRowConfirmMs: "remove_repeatable: wait again after confirming a dialog",
  rowQuietMs: "rows: after adding or removing one, wait for quiet",
  rowMaxMs: "rows: but never longer than this",
  stepMs: "go_next / go_back: wait for the step to change (or errors to show)",
  stepFieldsMs: "go_next / go_back (Workday): then wait for the new step's fields to show (not on review)",
  stepQuietMs: "go_next / go_back: then wait for quiet",
  stepMaxMs: "go_next / go_back: but never longer than this",
  pageActionQuietMs: "page_action (Apply…): wait for quiet",
  pageActionMaxMs: "page_action: but never longer than this",
};

/**
 * Resolve overrides against a site's own waits (`base`). A value that is set is used as written; `scale`
 * multiplies the site's values for the rest (not pollMs), so "scale: 0.5" with one wait set explicitly keeps that
 * one. Unknown keys and bad values fall back to the site's value.
 */
export function resolveTiming(base: Timing, overrides?: Partial<Record<string, unknown>> | null, scale = 1): Timing {
  const out = { ...base };
  for (const key of Object.keys(STANDARD_WAITS) as TimingKey[]) {
    const v = overrides?.[key];
    const set = typeof v === "number" && Number.isFinite(v) && v >= 0;
    const value = set ? v : key === "pollMs" ? base[key] : base[key] * scale;
    out[key] = key === "pollMs" ? Math.max(1, Math.round(value)) : Math.round(value);
  }
  return out;
}
