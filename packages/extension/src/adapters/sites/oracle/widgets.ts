import type { FieldKind } from "@ezapply/protocol";
import type { WidgetDriver } from "../../engine/types.js";
import { fillField, listCombo, removeItems, searchCombo, uploadFile } from "./fill.js";
import { comboInput, currentValue, dateParts, knownOptions } from "./page.js";
import { SEL } from "./selectors.js";

/**
 * Oracle's widgets, by kind. The site decides each field's kind from its form row (`page.ts`, `rowKind`), so these
 * are looked up by kind rather than by recognising a container. The fillers and readers are `fill.ts` and
 * `page.ts`, unchanged since they were the Oracle adapter's own.
 */

function driver(kind: FieldKind, is: (c: HTMLElement) => boolean, more: Partial<WidgetDriver> = {}): WidgetDriver {
  return {
    kind,
    is,
    value: (c) => currentValue(c, kind),
    options: (c) => knownOptions(c, kind),
    fill: (c, value, { strict }) => fillField({ field: { kind }, container: c }, value, strict),
    ...more,
  };
}

const remove: WidgetDriver["remove"] = (c, values, field) => removeItems({ field, container: c }, values);
const has = (selector: string) => (c: HTMLElement) => Boolean(c.querySelector(selector));

export const ORACLE_WIDGETS: Partial<Record<FieldKind, WidgetDriver>> = {
  date: driver("date", (c) => c.matches(SEL.dateRow) || has(SEL.datePart)(c), { dateParts }),
  // Pills: one choice, or several with +/− icons; native radios too.
  radio: driver("radio", (c) => has(SEL.pills)(c) || has('input[type="radio"]')(c)),
  "checkbox-group": driver(
    "checkbox-group",
    (c) => has(SEL.pillMultiIcon)(c) || c.querySelectorAll('input[type="checkbox"]').length > 1,
    { multiple: () => true, remove },
  ),
  dropdown: driver("dropdown", (c) => Boolean(comboInput(c)), {
    lazyOptions: true,
    list: listCombo,
    search: searchCombo,
  }),
  // Widgets the adapter can't drive yet (JET comboboxes, the multi-select): reported so they're seen.
  typeahead: driver("typeahead", has(SEL.unsupported)),
  checkbox: driver("checkbox", (c) => c.querySelectorAll('input[type="checkbox"]').length === 1),
  textarea: driver("textarea", has("textarea:not([tabindex='-1'])")),
  password: driver("password", has('input[type="password"]')),
  number: driver("number", has('input[type="number"]')),
  text: driver("text", has("input")),
  file: driver("file", (c) => has(SEL.upload)(c) || has('input[type="file"]')(c), {
    multiple: (c) => Boolean(c.closest(SEL.miscBlock)),
    upload: uploadFile,
    remove,
  }),
};
