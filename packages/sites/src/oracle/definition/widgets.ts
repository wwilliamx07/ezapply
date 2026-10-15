import { cleanLabel, cssEscape, isVisible, press, settle, text } from "@ezapply/engine/dom";
import { T } from "@ezapply/engine/timing";
import type { FillOutcome, WidgetDriver } from "@ezapply/engine/types";
import { toggleButtonsDriver } from "@ezapply/engine/widgets/buttons";
import { fileDriver } from "@ezapply/engine/widgets/file";
import {
  checkboxDriver,
  checkboxGroupDriver,
  passwordDriver,
  radioDriver,
  type TextOptions,
  textDriver,
} from "@ezapply/engine/widgets/native";
import { comboDriver, leave } from "./combo.js";
import { dateDriver } from "./date.js";
import { checkboxLabel, isSubmitControl } from "./page.js";
import { SEL, TEXT } from "./selectors.js";

/**
 * Oracle's widgets, by the name the site gives a form row's widget (`page.ts`, `rowWidget`): cx-select lists and
 * the date lists made of them, pills (one choice or several), native radios and checkboxes, attachments, and plain
 * inputs. The lists and dates are Oracle's own; the rest are the shared drivers. Knockout binds the inputs, so a
 * value that didn't take isn't retried through React's handlers, and a box that didn't change isn't pressed again
 * through its label.
 */

/** A radio's label: what its `aria-labelledby` names, its `<label for>`, its `aria-label`, or its value. */
function radioLabel(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const byLabelledBy = input
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => text(doc.getElementById(id)))
    .find(Boolean);
  const byFor = input.id ? text(doc.querySelector(`label[for="${cssEscape(input.id)}"]`)) : "";
  return cleanLabel(byLabelledBy || byFor || input.getAttribute("aria-label") || input.value);
}

/** The files a file field holds, once each. */
function attachedFiles(c: HTMLElement): { name: string; row: HTMLElement }[] {
  return [...c.querySelectorAll<HTMLElement>(SEL.fileName)]
    .map((n) => ({ name: text(n), row: n.closest<HTMLElement>(SEL.fileRow) ?? n }))
    .filter((f) => f.name);
}

/** Press the confirm button of a delete/remove confirmation, if one appeared. */
export async function confirmRemoval(doc: Document): Promise<void> {
  const dialog = [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].find(
    (d) => isVisible(d) && /delete|remove/i.test(text(d)),
  );
  const button = dialog
    ? [...dialog.querySelectorAll<HTMLElement>("button,[role='button']")].find(
        (b) => isVisible(b) && TEXT.confirmRemoval.test(text(b)),
      )
    : undefined;
  if (button && !isSubmitControl(button)) {
    press(button);
    await settle(doc, T.removeQuietMs, T.removeMaxMs);
  }
}

const file = fileDriver({
  names: (c) => attachedFiles(c).map((f) => f.name),
  // Only a newly shown file counts: a same-named file from the candidate's profile must not pass.
  entries: (c) => attachedFiles(c).map((f) => ({ name: f.name, el: f.row })),
  dropZone: (_c, input) => input?.closest<HTMLElement>(SEL.upload) ?? null,
  removeButton: (c, name) => {
    const row = attachedFiles(c).find((f) => f.name === name)?.row;
    const button =
      row?.querySelector<HTMLElement>(SEL.fileRemove) ??
      (row?.matches(SEL.fileRow)
        ? row.querySelector<HTMLElement>("button:not(.attachment-upload-button__download)")
        : null);
    return button && !isSubmitControl(button) ? button : null;
  },
  confirmRemoval,
  multiple: (c) => Boolean(c.closest(SEL.miscBlock)),
});

/** Pills: short option lists as toggle buttons. */
const pill = {
  buttons: SEL.pill,
  label: (b: HTMLElement) => text(b.querySelector(SEL.pillName) ?? b),
  pressed: (b: HTMLElement) =>
    b.getAttribute("aria-pressed") === "true" || b.classList.contains("cx-select-pill-section--selected"),
};

const typed: TextOptions = { leave, react: false };

/** Widgets the adapter can't drive yet (JET comboboxes, the multi-select): reported so they're seen. */
const unsupported: WidgetDriver = {
  kind: "typeahead",
  is: (c) => Boolean(c.querySelector(SEL.unsupported)),
  value: () => [],
  fill: async (): Promise<FillOutcome> => ({
    ok: false,
    error: "This kind of field isn't supported on Oracle pages. Ask the user to fill it.",
  }),
};

export const ORACLE_WIDGETS = {
  date: dateDriver,
  pills: toggleButtonsDriver(pill),
  pillsMulti: toggleButtonsDriver({ ...pill, multiple: true }),
  radio: radioDriver({ label: radioLabel, fallback: "label" }),
  list: comboDriver,
  unsupported,
  checkboxes: checkboxGroupDriver({ label: checkboxLabel, fallback: "none" }),
  checkbox: checkboxDriver({ fallback: "none" }),
  textarea: textDriver("textarea", { ...typed, selector: "textarea:not([tabindex='-1'])" }),
  password: passwordDriver,
  number: textDriver("number", typed),
  text: textDriver("text", { ...typed, selector: "input:not([type='hidden'])" }),
  file,
} satisfies Record<string, WidgetDriver>;

export type OracleWidget = keyof typeof ORACLE_WIDGETS;
