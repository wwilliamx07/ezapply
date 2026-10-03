import { siteInfo } from "@ezapply/protocol/sites";
import { cleanLabel, isVisible, norm, slug, text } from "../../engine/dom.js";
import {
  ariaError,
  isSubmitByText,
  noRepeats,
  singlePageKind,
  singlePageMessages,
  singleStep,
  standardWaits,
  visibleTexts,
} from "../../engine/standard.js";
import type { FieldSpot, SiteDefinition, WidgetDriver } from "../../engine/types.js";
import { toggleButtonsDriver } from "../../widgets/buttons.js";
import { comboboxDriver } from "../../widgets/combobox.js";
import { fileDriver } from "../../widgets/file.js";
import { checkboxDriver, checkboxGroupDriver, radioDriver, textDriver } from "../../widgets/native.js";

/**
 * Ashby's hosted job boards (`jobs.ashbyhq.com/<organization>/<job>`): the posting, and its application under the
 * Application tab (`…/application`), one React page with Submit at the end. Each question is an
 * `.ashby-application-form-field-entry` (stable class names) with a `label[for]`; text inputs and textareas, Yes/No
 * toggle buttons, radio and checkbox groups, a location field that suggests places as you type, and file inputs.
 * Built from a live application page (2026-10-03) and checked on one live (filling, never submitting). Uploads send
 * the file to Ashby at once, so they weren't tried live.
 */

const SEL = {
  form: "#form, .ashby-application-form-container",
  entry: ".ashby-application-form-field-entry",
  title: ".ashby-application-form-question-title, label",
  consent: ".ashby-application-form-texting-consent-description",
  apply: "a, button",
  errors: "[role='alert'], .ashby-application-form-field-entry [class*='errorMessage']",
};

/** The file a file field holds, as Ashby shows it: a name with an extension, once attached. */
const fileNames = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>("p, span, a, div")]
    .filter((el) => el.children.length === 0)
    .map(text)
    .filter((t) => /\.(pdf|docx?|txt|rtf|odt|pages)$/i.test(t));

const WIDGETS = {
  file: fileDriver({ names: fileNames }),
  location: comboboxDriver(),
  textarea: textDriver("textarea"),
  text: textDriver("text"),
  yesNo: toggleButtonsDriver("button[aria-pressed]"),
  radio: radioDriver(),
  checkboxes: checkboxGroupDriver(),
  checkbox: checkboxDriver(),
};
// The order decides an entry's kind: an entry holding a phone number and its texting consent is the phone number
// (the consent is a field of its own, below); Yes/No buttons hide a checkbox, so they come before checkboxes.
const ORDER: WidgetDriver[] = [
  WIDGETS.file,
  WIDGETS.location,
  WIDGETS.textarea,
  WIDGETS.text,
  WIDGETS.yesNo,
  WIDGETS.radio,
  WIDGETS.checkboxes,
  WIDGETS.checkbox,
];

/** Profile hints by Ashby's own field paths, and by prompt for the questions boards commonly add. */
const HINTS_BY_PATH: Record<string, string> = {
  _systemfield_name: "identity.fullName",
  _systemfield_email: "contact.email",
  _systemfield_location: "contact.address.city",
};
const HINTS_BY_PROMPT: [RegExp, string][] = [
  [/^phone( number)?$/i, "contact.phone.number"],
  [/^linkedin( profile| url)?$/i, "links.linkedin"],
  [/^github( profile| url)?$/i, "links.github"],
  [/^(personal )?(website|portfolio)( url)?$/i, "links.portfolio"],
];

function fields(doc: Document): FieldSpot[] {
  const form = doc.querySelector(SEL.form);
  if (!form) return [];
  const out: FieldSpot[] = [];
  for (const entry of form.querySelectorAll<HTMLElement>(SEL.entry)) {
    if (!isVisible(entry)) continue;
    const consent = entry.querySelector<HTMLElement>(SEL.consent);
    // The consent's Yes and No sit beside its text, in a group of their own.
    const consentGroup = consent
      ? (entry.querySelector("input[type='radio']")?.closest("label")?.parentElement ?? null)
      : null;
    const driver = ORDER.find((w) => w.is(entry) && !(w === WIDGETS.radio && consent));
    if (!driver) continue;
    const path = entry.getAttribute("data-field-path") ?? "";
    const label = cleanLabel(text(entry.querySelector(SEL.title))) || path;
    const control = entry.querySelector<HTMLElement>("input:not([type='hidden']), textarea");
    const error = ariaError(control);
    const hint = HINTS_BY_PATH[path] ?? HINTS_BY_PROMPT.find(([re]) => re.test(label))?.[1];
    out.push({
      container: entry,
      driver,
      // Ashby's own fields by their path (`_systemfield_email` → `email`); a board's questions by their prompt.
      key: path.startsWith("_systemfield_") ? path.slice("_systemfield_".length) : slug(label).slice(0, 40),
      label,
      section: "Application",
      required: Boolean(control?.hasAttribute("required")) || /\*$/.test(norm(text(entry.querySelector(SEL.title)))),
      ...(error ? { error } : {}),
      ...(hint ? { hint } : {}),
    });
    // A phone number's texting consent: its own question (Yes or No), asked by the text beside it.
    if (consent && consentGroup) {
      out.push({
        container: consentGroup,
        driver: WIDGETS.radio,
        key: "texting-consent",
        label: norm(text(consent.querySelector("p"))).slice(0, 200) || "Texting consent",
        section: "Application",
        required: false,
      });
    }
  }
  return out;
}

const submitButton = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>("button")].find((b) => isVisible(b) && isSubmitByText(b)) ?? null;
const applyButton = (doc: Document) =>
  doc.querySelector(SEL.entry)
    ? null
    : ([...doc.querySelectorAll<HTMLElement>(SEL.apply)].find(
        (b) => isVisible(b) && /^apply( for this job)?$/i.test(text(b)),
      ) ?? null);

export const ashby: SiteDefinition = {
  info: siteInfo("ashby") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: ORDER,
  fields,
  addButtons: () => [],
  rows: () => [],
  page: {
    kind: (doc, _url, count) => singlePageKind(doc, count, applyButton(doc)),
    step: (doc) => (doc.querySelector(SEL.entry) ? singleStep(norm(text(doc.querySelector("h1")))) : undefined),
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
