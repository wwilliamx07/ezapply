import { siteInfo } from "@ezapply/protocol/sites";
import { cssEscape, isVisible, norm, slug, text } from "../../engine/dom.js";
import {
  ariaError,
  headingBefore,
  isSubmitByText,
  noRepeats,
  promptOf,
  singlePageKind,
  singlePageMessages,
  singleStep,
  standardWaits,
  textOfIds,
  titledJob,
  visibleTexts,
} from "../../engine/standard.js";
import type { FieldSpot, SiteDefinition, WidgetDriver } from "../../engine/types.js";
import { fileDriver } from "../../widgets/file.js";
import { checkboxDriver, checkboxGroupDriver, radioDriver, textDriver } from "../../widgets/native.js";
import { reactSelectDriver } from "../../widgets/react-select.js";

/**
 * Greenhouse job boards (`job-boards.greenhouse.io`, the older `boards.greenhouse.io`, and the embed companies load
 * in a frame): the posting and a one-page application, Submit at the end. Text fields sit in `.text-input-wrapper`s,
 * lists in `.select__container`s (react-select), files in `.file-upload`s (hidden inputs behind "Attach"), choices in
 * fieldsets; prompts are labels tied by `for`. Built from the live pages of four boards and checked on
 * one live (filling, never submitting). See references/components/sites.md.
 */

const SEL = {
  form: "form#application-form, form.application--form",
  text: ".text-input-wrapper",
  select: ".select__container",
  file: ".file-upload",
  group: "fieldset:not(.phone-input)",
  headings: "h2, h3, h4",
  apply: "button[aria-label='Apply'], a[aria-label='Apply']",
  errors: "[role='alert'], .helper-text--error",
};

/** The file names a file field shows once a file is attached, and the button that takes one off. */
const fileNames = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>(".file-upload__filename p, .file-upload__filename .body")]
    .map(text)
    .filter(Boolean);

const WIDGETS = {
  file: fileDriver({
    names: fileNames,
    removeButton: (c, name) =>
      [...c.querySelectorAll<HTMLElement>(".file-upload__filename")]
        .find((row) => text(row).includes(name))
        ?.querySelector<HTMLElement>("button[aria-label='Remove file']") ?? null,
  }),
  // Greenhouse's select holds `menuIsOpen` itself: a key-up in the control opens it, Escape closes it (as does a
  // choice). react-select's own `onMenuOpen` changes nothing there, and its school and discipline lists load only
  // while the menu is open.
  select: reactSelectDriver({
    menu: (p, open) => (p as { onKeyUp?: (e: { code: string }) => void }).onKeyUp?.({ code: open ? "KeyA" : "Escape" }),
  }),
  textarea: textDriver("textarea"),
  text: textDriver("text"),
  checkboxes: checkboxGroupDriver(),
  checkbox: checkboxDriver(),
  radio: radioDriver(),
};

/** Profile hints by the control's id (Greenhouse's own fields) or its prompt (custom questions most boards ask). */
const HINTS_BY_ID: Record<string, string> = {
  first_name: "identity.firstName",
  last_name: "identity.lastName",
  preferred_name: "identity.preferredName",
  email: "contact.email",
  phone: "contact.phone.number",
  country: "contact.phone.countryCode",
  gender: "eeo.gender",
  hispanic_ethnicity: "eeo.hispanicOrLatino",
  race: "eeo.race",
  veteran_status: "eeo.veteranStatus",
  disability_status: "eeo.disability",
};
const HINTS_BY_PROMPT: [RegExp, string][] = [
  [/^linkedin( profile| url)?$/i, "links.linkedin"],
  [/^github( profile| url)?$/i, "links.github"],
  [/^(personal )?(website|portfolio)( url)?$/i, "links.portfolio"],
];

/** The heading above a field within the form (the EEO block's "Voluntary Self-Identification"), else Application. */
function section(container: HTMLElement, form: Element | null): string {
  const h = headingBefore(container, SEL.headings, form);
  return h === "Main" ? "Application" : h;
}

function spot(container: HTMLElement, control: Element, driver: WidgetDriver, form: Element | null): FieldSpot {
  const doc = container.ownerDocument;
  const id = control.getAttribute("id") ?? "";
  const label = promptOf(control) || id;
  const help = textOfIds(doc, `${id}-description`);
  const error = ariaError(control) || visibleTexts(doc, `#${cssEscape(`${id}-error`)}`)[0];
  const hint = HINTS_BY_ID[id] ?? HINTS_BY_PROMPT.find(([re]) => re.test(label))?.[1];
  return {
    container,
    driver,
    // Custom questions are keyed by long numbers (`question_38624172002`); their prompt reads better and is as stable.
    key: !id || /^question_/.test(id) ? slug(label).slice(0, 40) : id,
    label,
    section: section(container, form),
    required:
      control.getAttribute("aria-required") === "true" ||
      Boolean(container.querySelector("label [aria-hidden='true'], .required")),
    ...(help ? { help: help.slice(0, 500) } : {}),
    ...(error ? { error } : {}),
    ...(hint ? { hint } : {}),
  };
}

/** Every field of the application form, in page order. */
function fields(doc: Document): FieldSpot[] {
  const form = doc.querySelector(SEL.form);
  if (!form) return [];
  const out: { el: HTMLElement; spot: FieldSpot }[] = [];
  const add = (container: HTMLElement, control: Element | null, driver: WidgetDriver) => {
    if (control && isVisible(container)) out.push({ el: container, spot: spot(container, control, driver, form) });
  };
  for (const c of form.querySelectorAll<HTMLElement>(SEL.file)) add(c, c, WIDGETS.file);
  for (const c of form.querySelectorAll<HTMLElement>(SEL.select))
    add(c, c.querySelector("input[role='combobox']"), WIDGETS.select);
  for (const c of form.querySelectorAll<HTMLElement>(SEL.text)) {
    const area = c.querySelector("textarea");
    add(c, area ?? c.querySelector("input.input, input[type='tel']"), area ? WIDGETS.textarea : WIDGETS.text);
  }
  for (const c of form.querySelectorAll<HTMLElement>(SEL.group)) {
    const boxes = c.querySelectorAll("input[type='checkbox']").length;
    const radios = c.querySelectorAll("input[type='radio']").length;
    const driver = radios ? WIDGETS.radio : boxes > 1 ? WIDGETS.checkboxes : boxes === 1 ? WIDGETS.checkbox : null;
    if (driver) add(c, c, driver);
  }
  return out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1)).map((x) => x.spot);
}

const submitButton = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>(`${SEL.form} button`)].find((b) => isVisible(b) && isSubmitByText(b)) ?? null;
const applyButton = (doc: Document) =>
  doc.querySelector(SEL.form) ? null : ([...doc.querySelectorAll<HTMLElement>(SEL.apply)].find(isVisible) ?? null);

export const greenhouse: SiteDefinition = {
  info: siteInfo("greenhouse") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: Object.values(WIDGETS),
  fields,
  addButtons: () => [],
  rows: () => [],
  page: {
    kind: (doc, _url, count) => singlePageKind(doc, count, applyButton(doc)),
    step: (doc) =>
      doc.querySelector(SEL.form) ? singleStep(norm(text(doc.querySelector(".job__title h1")))) : undefined,
    job: (doc) => titledJob(text(doc.querySelector(".job__title h1"))),
    stepKey: (_doc, url) => url,
    errors: (doc) => visibleTexts(doc, SEL.errors),
    messages: () => [],
    actions: (doc) => (applyButton(doc) ? ["apply"] : []),
    actionButton: (doc, action) => (action === "apply" ? applyButton(doc) : null),
    next: submitButton,
    back: () => null,
    label: text,
    isSubmit: isSubmitByText,
  },
  repeat: noRepeats,
  fill: { order: "given" },
  waits: standardWaits,
  messages: singlePageMessages(),
};
