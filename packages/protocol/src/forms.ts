import { z } from "zod";

/** What Claude sees of an application page. Produced by a site adapter in the extension. */

export const PageKind = z.enum(["posting", "auth", "start-choice", "step", "review", "confirmation", "unknown"]);
export type PageKind = z.infer<typeof PageKind>;

export const FieldKind = z.enum([
  "text",
  "textarea",
  "number",
  "password",
  "date",
  "dropdown",
  "typeahead",
  "radio",
  "checkbox",
  "checkbox-group",
  "file",
]);
export type FieldKind = z.infer<typeof FieldKind>;

export const Field = z.object({
  /** Stable within the page: section + automation id (+ #n for repeats). Pass back to fill tools. */
  id: z.string(),
  automationId: z.string().optional(),
  label: z.string(),
  helpText: z.string().optional(),
  required: z.boolean(),
  kind: FieldKind,
  /** Known options (radio, checkbox-group, sometimes dropdowns). */
  options: z.array(z.string()).optional(),
  /** Options only appear after opening or searching: fill_fields returns them on a miss, search_options searches. */
  optionsLazy: z.boolean().optional(),
  dateParts: z.array(z.enum(["MM", "DD", "YYYY"])).optional(),
  multiple: z.boolean().optional(),
  /** Text value, selected option(s), checked state, or uploaded file names. */
  currentValue: z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]),
  error: z.string().optional(),
  /** Deterministic mapping for well-known fields; a suggestion only. */
  hint: z.object({ profileKey: z.string() }).optional(),
});
export type Field = z.infer<typeof Field>;

export const Section = z.object({
  id: z.string(),
  title: z.string(),
  fields: z.array(Field),
  /** A repeatable row (e.g. "Work Experience 2") with its own Delete button: remove_repeatable can remove it. */
  removable: z.boolean().optional(),
  /**
   * A saved item: an entry the page shows as a summary with no fields (Oracle's language tile, its work and
   * education timeline). Its id ends in its kind and number (`languages.item-1`, `….experience-1`).
   */
  saved: z.boolean().optional(),
});
export type Section = z.infer<typeof Section>;

export const PageAction = z.enum(["apply", "apply_manually", "autofill_with_resume", "use_last_application"]);
export type PageAction = z.infer<typeof PageAction>;

export const FormSchema = z.object({
  adapter: z.string(),
  tabId: z.number().int(),
  /** The frame the form was read in, when it's embedded in another site's page (`TabInfo.frames`). */
  frameId: z.number().int().optional(),
  /** The form's own URL: the frame's, for an embedded form. */
  url: z.string(),
  tenant: z.string().optional(),
  pageKind: PageKind,
  step: z
    .object({ index: z.number().int().optional(), total: z.number().int().optional(), title: z.string() })
    .optional(),
  sections: z.array(Section),
  /**
   * Buttons that add rows to repeatable sections. `section` is the heading the button sits under ("Work
   * Experience", "Websites"), since live Workday labels them all just "Add" or "Add Another".
   */
  addButtons: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      section: z.string().optional(),
      /**
       * What pressing it does: `row` adds a row of fields (Workday's Add, Oracle's Add Another Link), `form` opens
       * an inline form whose Save adds the item (Oracle's Add Language), `save` is such a form's Save (`save.*`),
       * `edit` opens a saved item's form again (`edit.*`; adds nothing until that form's Save).
       */
      kind: z.enum(["row", "form", "save", "edit"]).optional(),
    }),
  ),
  /** Page-level actions available (start-choice / posting pages). */
  actions: z.array(PageAction),
  errors: z.array(z.string()),
  /** Notices that aren't errors, such as "resume.pdf successfully uploaded". */
  messages: z.array(z.string()).optional(),
  /** Label of the forward button (e.g. "Save and Continue", "Submit"). */
  nextLabel: z.string().optional(),
  /**
   * A step whose only way on is Submit (Oracle's single-page application, the last section of a multi-page one, any
   * single-page form): the user presses it, so this is where the hand-off happens, as on a review page.
   */
  lastPage: z.boolean().optional(),
  /** Label of the button back to the previous step, when there is one. */
  backLabel: z.string().optional(),
  /**
   * The job the page says it's the application for, as its site's definition reads it: the title in the page's
   * header, a requisition shown on it. Tells which posting a tab belongs to when its URL can't.
   */
  job: z.object({ title: z.string().optional(), reqId: z.string().optional() }).optional(),
});
export type FormSchema = z.infer<typeof FormSchema>;

export const FillValue = z.union([z.string(), z.array(z.string()), z.boolean()]);
export type FillValue = z.infer<typeof FillValue>;

export const FillAction = z.object({ fieldId: z.string(), value: FillValue });
export type FillAction = z.infer<typeof FillAction>;

export const FillResult = z.object({
  fieldId: z.string(),
  ok: z.boolean(),
  readBack: z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]).optional(),
  error: z.string().optional(),
  /** Options seen when the requested one could not be matched (the closest, when there were many). */
  availableOptions: z.array(z.string()).optional(),
  /** How many options there were, when `availableOptions` holds only the closest. */
  optionCount: z.number().int().optional(),
  /** Typeahead entries that matched no option, each with the options its search showed. */
  unmatched: z.array(z.object({ value: z.string(), suggestions: z.array(z.string()) })).optional(),
  /** Typeahead entries for which Workday selected an option itself that isn't an exact match. */
  inexact: z.array(z.object({ value: z.string(), selected: z.string() })).optional(),
});
export type FillResult = z.infer<typeof FillResult>;

/** Result of removing selected values or attached files from a field. */
export const RemoveResult = z.object({
  fieldId: z.string(),
  ok: z.boolean(),
  /** Labels or file names that were removed. */
  removed: z.array(z.string()),
  /** What the field still holds afterwards. */
  remaining: z.array(z.string()),
  /** Requested values that matched nothing in the field. */
  notFound: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type RemoveResult = z.infer<typeof RemoveResult>;

/** Result of deleting a repeatable row (a work-history, education or website entry). */
export const RemoveRowResult = z.object({
  sectionId: z.string(),
  ok: z.boolean(),
  /** Title of the row that was removed. */
  removed: z.string().optional(),
  error: z.string().optional(),
});
export type RemoveRowResult = z.infer<typeof RemoveRowResult>;

export const OptionInfo = z.object({
  label: z.string(),
  /** Hierarchical prompts: choosing this opens another level. */
  hasChildren: z.boolean().optional(),
});
export type OptionInfo = z.infer<typeof OptionInfo>;

export const NextResult = z.object({
  /** The step index, title or page kind changed. */
  advanced: z.boolean(),
  pageKind: PageKind,
  step: z
    .object({ index: z.number().int().optional(), total: z.number().int().optional(), title: z.string() })
    .optional(),
  errors: z.array(z.string()),
  messages: z.array(z.string()).optional(),
  refusedReason: z.string().optional(),
});
export type NextResult = z.infer<typeof NextResult>;

export const BackResult = z.object({
  /** The page moved to an earlier step. */
  moved: z.boolean(),
  pageKind: PageKind,
  step: z
    .object({ index: z.number().int().optional(), total: z.number().int().optional(), title: z.string() })
    .optional(),
  errors: z.array(z.string()),
  refusedReason: z.string().optional(),
});
export type BackResult = z.infer<typeof BackResult>;

export const UploadFile = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});
export type UploadFile = z.infer<typeof UploadFile>;

/**
 * What a debugged form call brings back besides its result, in the bridge response's `debug`: always the adapter's
 * trace (every query, event, wait and branch, the page's state, its DOM changes, errors and requests during the
 * call), and the page's markup as asked: `before` the call, `after` it, and at each field that `failures`, with a
 * screenshot of the tab after a call that had one when the tab is on screen.
 */
export const DebugRequest = z.object({
  before: z.boolean().optional(),
  after: z.boolean().optional(),
  failures: z.boolean().optional(),
});
export type DebugRequest = z.infer<typeof DebugRequest>;

/**
 * `timing`: the adapter's waits for this call (see timing.ts), resolved by the companion from the workspace's
 * `autofill-timing.yaml`. Absent (an older companion): the adapter's defaults.
 * `frameId`: act on that frame of the tab (an application embedded in another site's page, from
 * `TabInfo.frames`) instead of the tab's own page. `tab.screenshot` always takes the whole tab.
 * `debug`: debug mode is on for this call (see `DebugRequest`). An older extension ignores it and answers
 * without a trace.
 */
const TabParam = z.object({
  tabId: z.number().int().optional(),
  frameId: z.number().int().optional(),
  timing: z.record(z.string(), z.number()).optional(),
  debug: DebugRequest.optional(),
});

/** Extension-served form methods (added to ExtensionApi). */
export const FormMethods = {
  "form.get": { params: TabParam, result: FormSchema },
  "form.searchOptions": {
    params: TabParam.extend({ fieldId: z.string(), query: z.string() }),
    result: z.array(OptionInfo),
  },
  "form.fill": { params: TabParam.extend({ fills: z.array(FillAction).min(1) }), result: z.array(FillResult) },
  "form.upload": { params: TabParam.extend({ fieldId: z.string(), file: UploadFile }), result: FillResult },
  /** Remove selected values (multi-select) or attached files (file field); no `values` = all. */
  "form.remove": {
    params: TabParam.extend({ fieldId: z.string(), values: z.array(z.string()).min(1).optional() }),
    result: RemoveResult,
  },
  /** Delete a repeatable row by its section id (a section get_form marks `removable`). */
  "form.removeRepeatable": { params: TabParam.extend({ sectionId: z.string() }), result: RemoveRowResult },
  "form.addRepeatable": {
    params: TabParam.extend({ addButtonId: z.string() }),
    result: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  "form.next": { params: TabParam, result: NextResult },
  "form.back": { params: TabParam, result: BackResult },
  "form.pageAction": {
    params: TabParam.extend({ action: PageAction }),
    result: z.object({ ok: z.boolean(), pageKind: PageKind, error: z.string().optional() }),
  },
  /**
   * Watch the tab for the application's confirmation page until the tab closes: the user presses Submit after the
   * hand-off, with no form call to see the result. `url` is the application's (its frame's, when embedded): only a
   * confirmation on its host counts. The extension reports it with `posting.submitted`, credited to `postingId`.
   * Asked again for the same tab, it replaces the watch.
   */
  "tab.watchSubmit": {
    params: z.object({ tabId: z.number().int(), url: z.string(), postingId: z.string() }),
    result: z.object({}),
  },
  "tab.screenshot": {
    params: TabParam,
    result: z.object({ tabId: z.number().int(), pngBase64: z.string() }),
  },
  /**
   * Turn on focus emulation for the application tab before a form call (`chrome.debugger`): the page runs visible
   * and focused where it is, so the browser doesn't throttle it (hidden tabs' timers run about once a second, and
   * every adapter wait is a timer) and widgets that track focus get it. Nothing is switched or raised.
   * `emulated`: it's on. `hidden`: the page still reports `document.visibilityState === "hidden"` (only when
   * emulation couldn't run). `focused`: `document.hasFocus()` (the top page's, with `frameId`, under emulation;
   * else whether the browser window has focus); absent when the page can't be read.
   */
  "tab.show": {
    params: TabParam,
    result: z.object({
      tabId: z.number().int(),
      emulated: z.boolean(),
      hidden: z.boolean(),
      focused: z.boolean().optional(),
    }),
  },
};
