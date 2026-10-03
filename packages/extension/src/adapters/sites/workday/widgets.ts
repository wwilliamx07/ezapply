import type { FieldKind } from "@ezapply/protocol";
import type { WidgetDriver } from "../../engine/types.js";
import { fillField, listDropdown, listTypeahead, removeItems, searchTypeahead, uploadFile } from "./fill.js";
import { currentValue, dateParts, isMultiple, knownOptions } from "./page.js";
import { SEL } from "./selectors.js";

/**
 * Workday's widgets, in the order a field's kind is decided (the first that recognises a container): a file drop
 * zone, a split date, a prompt (typeahead), a listbox dropdown, radios, checkboxes, then plain inputs. The
 * fillers and readers are `fill.ts` and `page.ts`, unchanged since they were the Workday adapter's own.
 */

const inputLabels = (c: HTMLElement) =>
  [...c.querySelectorAll("input")].map((i) => (i.getAttribute("aria-label") ?? "").toLowerCase());

const textInput = "input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='url']";

/** A driver whose reading and filling are `page.ts`'s and `fill.ts`'s for its kind. */
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

export const WORKDAY_WIDGETS: readonly WidgetDriver[] = [
  driver("file", (c) => Boolean(c.querySelector(SEL.fileDropZone) || c.querySelector('input[type="file"]')), {
    multiple: (c) => isMultiple(c, "file"),
    upload: uploadFile,
    remove,
  }),
  driver("date", (c) => inputLabels(c).includes("year") || inputLabels(c).includes("month"), { dateParts }),
  driver("typeahead", (c) => Boolean(c.querySelector(SEL.multiSelect)), {
    lazyOptions: true,
    multiple: (c) => isMultiple(c, "typeahead"),
    list: listTypeahead,
    search: searchTypeahead,
    remove,
  }),
  driver("dropdown", (c) => Boolean(c.querySelector('button[aria-haspopup="listbox"]')), {
    lazyOptions: true,
    list: listDropdown,
  }),
  driver("radio", (c) => c.querySelectorAll('input[type="radio"]').length > 0),
  driver("checkbox-group", (c) => c.querySelectorAll('input[type="checkbox"]').length > 1),
  driver("checkbox", (c) => c.querySelectorAll('input[type="checkbox"]').length === 1),
  driver("textarea", (c) => Boolean(c.querySelector("textarea"))),
  driver("password", (c) => Boolean(c.querySelector('input[type="password"]'))),
  driver("number", (c) => Boolean(c.querySelector('input[type="number"]'))),
  driver("text", (c) => Boolean(c.querySelector(textInput))),
];
