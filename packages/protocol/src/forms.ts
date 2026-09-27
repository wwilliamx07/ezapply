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
  /** Options only appear after opening/searching: use list_options or search_options. */
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
});
export type Section = z.infer<typeof Section>;

export const PageAction = z.enum(["apply", "apply_manually", "autofill_with_resume", "use_last_application"]);
export type PageAction = z.infer<typeof PageAction>;

export const FormSchema = z.object({
  adapter: z.string(),
  tabId: z.number().int(),
  url: z.string(),
  tenant: z.string().optional(),
  pageKind: PageKind,
  step: z
    .object({ index: z.number().int().optional(), total: z.number().int().optional(), title: z.string() })
    .optional(),
  sections: z.array(Section),
  /** Buttons that add rows to repeatable sections ("Add Work Experience"). */
  addButtons: z.array(z.object({ id: z.string(), label: z.string() })),
  /** Page-level actions available (start-choice / posting pages). */
  actions: z.array(PageAction),
  errors: z.array(z.string()),
  /** Label of the forward button (e.g. "Save and Continue", "Submit"). */
  nextLabel: z.string().optional(),
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
  /** Options seen when the requested one could not be matched. */
  availableOptions: z.array(z.string()).optional(),
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

export const OptionInfo = z.object({
  label: z.string(),
  /** Hierarchical prompts: choosing this opens another level. */
  hasChildren: z.boolean().optional(),
});
export type OptionInfo = z.infer<typeof OptionInfo>;

export const NextResult = z.object({
  advanced: z.boolean(),
  pageKind: PageKind,
  step: z
    .object({ index: z.number().int().optional(), total: z.number().int().optional(), title: z.string() })
    .optional(),
  errors: z.array(z.string()),
  refusedReason: z.string().optional(),
});
export type NextResult = z.infer<typeof NextResult>;

export const UploadFile = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});
export type UploadFile = z.infer<typeof UploadFile>;

const TabParam = z.object({ tabId: z.number().int().optional() });

/** Extension-served form methods (added to ExtensionApi). */
export const FormMethods = {
  "form.get": { params: TabParam, result: FormSchema },
  "form.listOptions": { params: TabParam.extend({ fieldId: z.string() }), result: z.array(OptionInfo) },
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
  "form.addRepeatable": {
    params: TabParam.extend({ addButtonId: z.string() }),
    result: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  "form.next": { params: TabParam, result: NextResult },
  "form.pageAction": {
    params: TabParam.extend({ action: PageAction }),
    result: z.object({ ok: z.boolean(), pageKind: PageKind, error: z.string().optional() }),
  },
  "tab.screenshot": {
    params: TabParam,
    result: z.object({ tabId: z.number().int(), pngBase64: z.string() }),
  },
};
