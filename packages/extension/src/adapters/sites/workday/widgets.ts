import { cleanLabel, cssEscape, text } from "../../engine/dom.js";
import type { WidgetDriver } from "../../engine/types.js";
import { fileDriver } from "../../widgets/file.js";
import { checkboxDriver, checkboxGroupDriver, passwordDriver, radioDriver, textDriver } from "../../widgets/native.js";
import { dateDriver } from "./date.js";
import { dropdownDriver } from "./dropdown.js";
import { removeItems } from "./remove.js";
import { SEL } from "./selectors.js";
import { typeaheadDriver } from "./typeahead.js";

/**
 * Workday's widgets, in the order a field's kind is decided (the first that recognises a container): a file drop
 * zone, a split date, a prompt (typeahead), a listbox dropdown, radios, checkboxes, then plain inputs. The date,
 * prompt and dropdown are Workday's own; the rest are the shared drivers, with React's handlers as the fallback
 * when a press doesn't take (Workday's controls are React's).
 */

/** A radio's or checkbox's label: its `<label for>`, the label around it, its `aria-label`, or its value. */
function optionLabel(input: HTMLInputElement): string {
  const id = input.id;
  const byFor = id ? input.ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`) : null;
  const wrap = input.closest("label");
  return cleanLabel(text(byFor ?? wrap) || input.getAttribute("aria-label") || input.value);
}

/**
 * The files attached to a file field, once each: `name` from the file-name element, `row` the element
 * holding it and its delete button. A row and the name inside it both match the file hooks, so rows are
 * used only when a tenant shows no separate name element.
 */
function attachedFiles(c: Element): { name: string; row: HTMLElement; nameEl: HTMLElement }[] {
  const names = [...c.querySelectorAll<HTMLElement>(SEL.fileName)];
  const found = names.length
    ? names.map((n) => ({ nameEl: n, row: n.closest<HTMLElement>(SEL.fileRow) ?? n.parentElement ?? n }))
    : [...c.querySelectorAll<HTMLElement>(SEL.fileItem)]
        .filter((el, _, all) => !all.some((o) => o !== el && o.contains(el)))
        .map((el) => ({ nameEl: el, row: el }));
  return found.map((f) => ({ ...f, name: text(f.nameEl) })).filter((f) => f.name);
}

const file: WidgetDriver = {
  ...fileDriver({
    input: (c) => c.querySelector<HTMLInputElement>(SEL.fileInput),
    names: (c) => attachedFiles(c).map((f) => f.name),
    // Only a newly shown file counts: a same-named file left from a previous application must not pass.
    entries: (c) => attachedFiles(c).map((f) => ({ name: f.name, el: f.nameEl })),
    dropZone: (c) => c.querySelector<HTMLElement>(SEL.fileDropZone),
    reactDrop: true,
  }),
  is: (c) => Boolean(c.querySelector(SEL.fileDropZone) || c.querySelector('input[type="file"]')),
  remove: (c, values) =>
    removeItems(
      c,
      () =>
        attachedFiles(c).map((f) => ({
          label: f.name,
          el: f.row,
          remove: f.row.querySelector<HTMLElement>(SEL.fileRemove),
        })),
      values,
    ),
};

const choice = { label: optionLabel, fallback: "react" } as const;

export const WORKDAY_WIDGETS: readonly WidgetDriver[] = [
  file,
  dateDriver,
  typeaheadDriver,
  dropdownDriver,
  radioDriver(choice),
  checkboxGroupDriver(choice),
  checkboxDriver({ fallback: "react" }),
  textDriver("textarea"),
  passwordDriver,
  textDriver("number"),
  textDriver(
    "text",
    "input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='url']",
  ),
];
