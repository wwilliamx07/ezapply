import { siteInfo } from "@ezapply/protocol/sites";
import { cleanLabel, isVisible, norm, slug, text } from "../../engine/dom.js";
import {
  ariaError,
  choiceLabel,
  headingBefore,
  isSubmitByText,
  noRepeats,
  singlePageKind,
  singlePageMessages,
  singleStep,
  standardWaits,
  visibleTexts,
} from "../../engine/standard.js";
import type { FieldSpot, SiteDefinition, WidgetDriver } from "../../engine/types.js";
import { comboboxDriver } from "../../widgets/combobox.js";
import { fileDriver } from "../../widgets/file.js";
import { checkboxDriver, checkboxGroupDriver, radioDriver, selectDriver, textDriver } from "../../widgets/native.js";

/**
 * Lever's hosted postings (`jobs.lever.co/<company>/<id>`): the posting, and its application on `…/apply`, one
 * server-rendered page with Submit at the end. Each question is an `.application-question` with an
 * `.application-label`; native inputs, selects, radio and checkbox groups; a location field that suggests places as
 * you type. Built from a live application page (2026-10-03) and checked on one live (filling, never submitting).
 * The resume input sends the file to Lever to read at once, so it wasn't tried live. See
 * references/components/sites.md.
 */

const SEL = {
  form: "form#application-form",
  question: ".application-question",
  label: ".application-label",
  headings: "h4",
  location: "input.location-input",
  locationResults: ".dropdown-results > div, .dropdown-results [role='option']",
  apply: "a.postings-btn[href$='/apply'], a[href$='/apply'].template-btn-submit",
  errors: ".error-message, .application-error, [role='alert']",
};

const WIDGETS = {
  file: fileDriver({
    names: (c) => [...c.querySelectorAll<HTMLElement>(".filename")].map(text).filter(Boolean),
  }),
  location: comboboxDriver({
    input: (c) => c.querySelector<HTMLInputElement>(SEL.location),
    options: (c) => [...c.querySelectorAll<HTMLElement>(SEL.locationResults)].filter(isVisible),
  }),
  select: selectDriver(),
  radio: radioDriver(),
  checkboxes: checkboxGroupDriver(),
  checkbox: checkboxDriver(),
  textarea: textDriver("textarea"),
  text: textDriver("text"),
};
// The order decides a question's kind: a location's field before plain text, groups before single boxes.
const ORDER: WidgetDriver[] = [
  WIDGETS.file,
  WIDGETS.location,
  WIDGETS.select,
  WIDGETS.radio,
  WIDGETS.checkboxes,
  WIDGETS.checkbox,
  WIDGETS.textarea,
  WIDGETS.text,
];

/** Profile hints by the control's name. */
const HINTS: Record<string, string> = {
  name: "identity.fullName",
  email: "contact.email",
  phone: "contact.phone.number",
  location: "contact.address.city",
  "urls[LinkedIn]": "links.linkedin",
  "urls[GitHub]": "links.github",
  "urls[Portfolio]": "links.portfolio",
};

/** A question's prompt: its label without the required mark ("✱"); a custom question's sits in `.text`. */
function prompt(q: HTMLElement): string {
  const label = q.querySelector<HTMLElement>(`${SEL.label} .text`) ?? q.querySelector<HTMLElement>(SEL.label);
  if (!label) return "";
  const copy = label.cloneNode(true) as HTMLElement;
  for (const mark of copy.querySelectorAll(".required")) mark.remove();
  return cleanLabel(copy.textContent).replace(/\s*✱\s*$/, "");
}

function fields(doc: Document): FieldSpot[] {
  const form = doc.querySelector(SEL.form);
  if (!form) return [];
  const out: FieldSpot[] = [];
  for (const q of form.querySelectorAll<HTMLElement>(SEL.question)) {
    if (!isVisible(q)) continue;
    const driver = ORDER.find((w) => w.is(q));
    if (!driver) continue;
    const control = q.querySelector<HTMLElement>("input:not([type='hidden']), select, textarea");
    const name = control?.getAttribute("name") ?? "";
    // A lone checkbox (a consent) may have no question label: its own label is the question.
    const box = driver.kind === "checkbox" ? q.querySelector<HTMLInputElement>("input[type='checkbox']") : null;
    const label = prompt(q) || (box ? choiceLabel(box) : "") || name;
    // Custom and survey questions (`cards[<uuid>][field0]`, `surveysResponses[<uuid>]…`) are keyed by their prompt;
    // Lever's own by their name.
    const key =
      !name || /^(cards|surveysResponses)\[/.test(name) ? slug(label).slice(0, 40) : slug(name.replace(/[[\]]+/g, "-"));
    const error = ariaError(control);
    const hint = HINTS[name];
    out.push({
      container: q,
      driver,
      key,
      label,
      section: headingBefore(q, SEL.headings, form),
      required: Boolean(q.querySelector(".required")) || Boolean(control?.hasAttribute("required")),
      ...(error ? { error } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

const submitButton = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>(`${SEL.form} button, ${SEL.form} [type='submit'], #btn-submit`)].find(
    (b) => isVisible(b) && isSubmitByText(b),
  ) ?? null;
const applyButton = (doc: Document) =>
  doc.querySelector(SEL.form) ? null : ([...doc.querySelectorAll<HTMLElement>(SEL.apply)].find(isVisible) ?? null);

export const lever: SiteDefinition = {
  info: siteInfo("lever") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: ORDER,
  fields,
  addButtons: () => [],
  rows: () => [],
  page: {
    kind: (doc, _url, count) => singlePageKind(doc, count, applyButton(doc)),
    step: (doc) =>
      doc.querySelector(SEL.form) ? singleStep(norm(text(doc.querySelector(".posting-headline h2")))) : undefined,
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
