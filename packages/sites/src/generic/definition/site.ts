import { cleanLabel, cssEscape, isVisible, norm, slug, text } from "@ezapply/engine/dom";
import {
  ariaError,
  headingBefore,
  isSubmitByText,
  noRepeats,
  singlePageKind,
  singlePageMessages,
  singleStep,
  standardWaits,
  textOfIds,
  titledJob,
} from "@ezapply/engine/standard";
import type { FieldSpot, SiteDefinition, WidgetDriver } from "@ezapply/engine/types";
import { fileDriver } from "@ezapply/engine/widgets/file";
import {
  checkboxDriver,
  checkboxGroupDriver,
  dateInputDriver,
  radioDriver,
  selectDriver,
  textDriver,
} from "@ezapply/engine/widgets/native";
import { GENERIC } from "../../registry.js";

/**
 * An application form on an employer's own page (`GENERIC` in `../../registry.ts`): a plain HTML `<form>` posted to
 * the employer's server, with none of a provider's markup. Read from what standard HTML says, never from a site's
 * class names: the form is the page's `<form>` that holds an email field and either a file field or at least four
 * labelled fields (never one with a password field: sign-in and account forms stay the user's); its fields are its
 * native controls, each prompted by its label (`for` or wrapping), `aria-labelledby`, `aria-label` or placeholder,
 * and hinted by its `autocomplete` token. Custom widgets (ARIA comboboxes, home-made dropdowns) and pages without a
 * `<form>` aren't read: a control it can't place is counted in a message, for the user to fill. One page with Submit
 * at the end. See references/components/sites.md, "Employer's own forms".
 */

/** Input types that are buttons or carry nothing to fill: never fields. Search and password inputs are never filled. */
const NOT_FIELDS = new Set(["hidden", "submit", "button", "reset", "image", "search", "password"]);
const FILE = 'input[type="file"]';
/** ARIA widgets in place of native controls: not read, counted for the user. */
const CUSTOM =
  "[role='combobox'], [role='listbox'], [role='radiogroup'], [role='checkbox'], [role='switch'], [role='textbox'], " +
  "[role='spinbutton'], [contenteditable=''], [contenteditable='true']";
const HEADINGS = "h1, h2, h3, h4, h5, h6";

const fileInput = (c: HTMLElement) =>
  c.matches(FILE) ? (c as HTMLInputElement) : c.querySelector<HTMLInputElement>(FILE);

const WIDGETS = {
  file: fileDriver({ input: fileInput, names: (c) => [...(fileInput(c)?.files ?? [])].map((f) => f.name) }),
  select: selectDriver(),
  date: dateInputDriver(),
  number: textDriver("number"),
  textarea: textDriver("textarea"),
  text: textDriver("text"),
  radio: radioDriver(),
  checkboxes: checkboxGroupDriver(),
  checkbox: checkboxDriver(),
};

/** Profile hints by the HTML `autocomplete` token: a standard, which many forms set. */
const HINTS_BY_AUTOCOMPLETE: Record<string, string> = {
  "given-name": "identity.firstName",
  "additional-name": "identity.middleName",
  "family-name": "identity.lastName",
  name: "identity.fullName",
  email: "contact.email",
  tel: "contact.phone.number",
  "tel-national": "contact.phone.number",
  "tel-country-code": "contact.phone.countryCode",
  "address-level2": "contact.address.city",
  "address-level1": "contact.address.region",
  "postal-code": "contact.address.postalCode",
  country: "contact.address.country",
  "country-name": "contact.address.country",
};
/** Profile hints by the control's name or its prompt, as the boards' forms ask them. */
const HINTS_BY_TEXT: [RegExp, string][] = [
  [/^(first|given) ?name$|^fname$/i, "identity.firstName"],
  [/^(last|family) ?name$|^surname$|^lname$/i, "identity.lastName"],
  [/^(full |your )?name$/i, "identity.fullName"],
  [/^e-?mail( address)?$/i, "contact.email"],
  [/^(phone|telephone|mobile|cell)( (phone|number))?$/i, "contact.phone.number"],
  [/^linkedin( profile| url)?$/i, "links.linkedin"],
  [/^github( profile| url)?$/i, "links.github"],
  [/^(personal )?(website|portfolio)( url)?$/i, "links.portfolio"],
];

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Choice = HTMLInputElement;

const isChoice = (c: Control): c is Choice => c.tagName === "INPUT" && (c.type === "radio" || c.type === "checkbox");

/** A label's own text, without the controls inside it (a wrapping label holds its select's options). */
function labelText(label: Element): string {
  const copy = label.cloneNode(true) as Element;
  for (const inner of copy.querySelectorAll("input, select, textarea, button")) inner.remove();
  return norm(copy.textContent);
}

/** Whether a control is on screen: itself, or a label of it (a file input hidden behind its "Attach" label). */
function shown(c: Control): boolean {
  return isVisible(c) || [...(c.labels ?? [])].some(isVisible);
}

/** The form's controls a user fills, in page order, including those tied to it from outside by `form=`. */
function controls(form: HTMLFormElement): Control[] {
  return [...form.elements].filter((e): e is Control => {
    const c = e as Control;
    if (!["INPUT", "SELECT", "TEXTAREA"].includes(c.tagName) || c.disabled) return false;
    return !(c.tagName === "INPUT" && NOT_FIELDS.has(c.type)) && shown(c);
  });
}

/** The raw prompt of one control, required mark included: its label, `aria-labelledby`, `aria-label`, placeholder. */
function rawPrompt(c: Control): string {
  const doc = c.ownerDocument;
  const candidates = [
    [...(c.labels ?? [])].map(labelText).find(Boolean) ?? "",
    textOfIds(doc, c.getAttribute("aria-labelledby")),
    c.getAttribute("aria-label") ?? "",
    c.getAttribute("placeholder") ?? "",
  ];
  return norm(candidates.find((x) => norm(x)) ?? "");
}

const clean = (raw: string) => cleanLabel(raw).replace(/\s*[✱*]\s*$/, "");
const marked = (raw: string) => /[✱*]\s*$/.test(raw);

/** Whether a form is an application: an email field and a file field or four labelled fields, and no password. */
function isApplication(form: HTMLFormElement): boolean {
  const all = [...form.elements] as Control[];
  if (all.some((c) => c.tagName === "INPUT" && c.type === "password")) return false;
  const fields = controls(form);
  const email = fields.some(
    (c) =>
      (c.tagName === "INPUT" && c.type === "email") ||
      /(^|\s)email$/i.test(c.getAttribute("autocomplete") ?? "") ||
      /^e-?mail$/i.test(c.getAttribute("name") ?? ""),
  );
  const file = fields.some((c) => c.tagName === "INPUT" && c.type === "file");
  return email && (file || fields.filter((c) => rawPrompt(c) || isChoice(c)).length >= 4);
}

/** The application form on the page: of those that count, the one with the most fields. */
function applicationForm(doc: Document): HTMLFormElement | null {
  const forms = [...doc.querySelectorAll<HTMLFormElement>("form")].filter((f) => isVisible(f) && isApplication(f));
  return forms.sort((a, b) => controls(b).length - controls(a).length)[0] ?? null;
}

/** The driver for a single control, by its type; undefined for one the generic reader doesn't fill (a time). */
function driverOf(c: Control): WidgetDriver | undefined {
  if (c.tagName === "SELECT") return (c as HTMLSelectElement).multiple ? undefined : WIDGETS.select;
  if (c.tagName === "TEXTAREA") return WIDGETS.textarea;
  switch (c.type) {
    case "text":
    case "email":
    case "tel":
    case "url":
      return WIDGETS.text;
    case "number":
      return WIDGETS.number;
    case "date":
    case "month":
      return WIDGETS.date;
    case "file":
      return WIDGETS.file;
    default:
      return undefined;
  }
}

/** A profile hint: the control's `autocomplete` token, else its name or prompt. */
function hintOf(c: Control, label: string): string | undefined {
  const tokens = (c.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  const byToken = tokens.map((t) => HINTS_BY_AUTOCOMPLETE[t]).find(Boolean);
  if (byToken) return byToken;
  const name = norm((c.getAttribute("name") ?? "").replace(/[_\-[\]]+/g, " "));
  return HINTS_BY_TEXT.find(([re]) => re.test(name) || re.test(label))?.[1];
}

/** A field's key: its control's name, else its id, else its prompt. */
function keyOf(c: Control, label: string): string {
  const own = c.getAttribute("name") || c.id;
  return own ? slug(own) : slug(label).slice(0, 40);
}

/** The heading above a field within the form, else Application. */
function section(container: HTMLElement, form: HTMLFormElement): string {
  const h = headingBefore(container, HEADINGS, form);
  return h === "Main" ? "Application" : h;
}

/**
 * Where a group of radios or checkboxes sits: the smallest element holding them all and no other choice, grown to
 * its fieldset or ARIA group when that holds no other choice either. Never the form itself (its every control would
 * be the group's, and the form is a submit control to the guard).
 */
function groupContainer(inputs: Choice[], form: HTMLFormElement): HTMLElement | null {
  const first = inputs[0] as Choice;
  let box = first.parentElement;
  while (box && box !== form && !inputs.every((i) => box?.contains(i))) box = box.parentElement;
  const onlyThese = (el: Element) =>
    [...el.querySelectorAll<Choice>("input[type='radio'], input[type='checkbox']")].every((i) => inputs.includes(i));
  if (!box || box === form || !form.contains(box) || !onlyThese(box)) return null;
  const outer = box.closest<HTMLElement>("fieldset, [role='radiogroup'], [role='group']");
  return outer && outer !== form && form.contains(outer) && onlyThese(outer) ? outer : box;
}

/**
 * A group's raw prompt: its fieldset's legend, its ARIA group's label, else the text in its container before its
 * first option (a question in a `<p>` or a bare `<label>` above the choices). Nothing else: a prompt guessed from
 * text outside the group is too often another question's.
 */
function groupPrompt(container: HTMLElement): string {
  const doc = container.ownerDocument;
  const legend = container.matches("fieldset") ? container.querySelector(":scope > legend") : null;
  const aria = textOfIds(doc, container.getAttribute("aria-labelledby")) || container.getAttribute("aria-label");
  if (legend) return norm(legend.textContent);
  if (aria) return norm(aria);
  for (const child of container.children) {
    if (child.querySelector("input, select, textarea") || child.matches("input, select, textarea")) break;
    if (child.matches("label[for]")) continue;
    const t = norm(child.textContent);
    if (t) return t;
  }
  return "";
}

interface Placed {
  el: HTMLElement;
  spot: FieldSpot;
}

/** The form's fields in page order, and how many of its controls couldn't be placed. */
function read(doc: Document): { form: HTMLFormElement | null; spots: FieldSpot[]; skipped: number } {
  const form = applicationForm(doc);
  if (!form) return { form, spots: [], skipped: 0 };
  const out: Placed[] = [];
  let skipped = 0;
  const groups = new Map<string, Choice[]>();

  for (const c of controls(form)) {
    if (isChoice(c)) {
      const key = `${c.type}|${c.name || `#${groups.size}`}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
      continue;
    }
    const driver = driverOf(c);
    const raw = rawPrompt(c);
    if (!driver || !raw) {
      skipped++;
      continue;
    }
    const label = clean(raw);
    const error = ariaError(c);
    const hint = hintOf(c, label);
    out.push({
      el: c,
      spot: {
        container: c,
        driver,
        key: keyOf(c, label),
        label,
        section: section(c, form),
        required: c.required || c.getAttribute("aria-required") === "true" || marked(raw),
        ...(error ? { error } : {}),
        ...(hint ? { hint } : {}),
      },
    });
  }

  for (const inputs of groups.values()) {
    const first = inputs[0] as Choice;
    const lone = inputs.length === 1 && first.type === "checkbox";
    const container = lone ? first : groupContainer(inputs, form);
    // A lone checkbox is its own question (a consent): its label is the prompt.
    const raw = !container ? "" : lone ? rawPrompt(first) : groupPrompt(container);
    if (!container || !raw) {
      skipped++;
      continue;
    }
    const driver = first.type === "radio" ? WIDGETS.radio : lone ? WIDGETS.checkbox : WIDGETS.checkboxes;
    const label = clean(raw);
    const error = inputs.map(ariaError).find(Boolean);
    out.push({
      el: container,
      spot: {
        container,
        driver,
        key: keyOf(first, label),
        label,
        section: section(container, form),
        required:
          inputs.some((i) => i.required || i.getAttribute("aria-required") === "true") ||
          container.getAttribute("aria-required") === "true" ||
          marked(raw),
        ...(error ? { error } : {}),
      },
    });
  }

  const custom = [...form.querySelectorAll(CUSTOM)].filter(
    (el) => isVisible(el) && !el.matches("input, select, textarea") && !el.querySelector("input, select, textarea"),
  );
  skipped += custom.length;
  const spots = out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1)).map((x) => x.spot);
  return { form, spots, skipped };
}

/** Phrases a button that sends an employer's application reads, beyond "Submit": "Apply", "Apply now". */
const APPLY = /^\s*apply\b/i;

/**
 * A control that submits: the standard ones (`isSubmitByText`), a form's default buttons (a `<button>` without a
 * type, an image input), any button reading "Apply…" in a form, and the form element itself, so the guard also
 * blocks a synthetic `submit` event. Broad on purpose: a false positive only blocks a press, never submits.
 */
function isSubmit(el: Element | null): boolean {
  if (!el?.matches) return false;
  if (el.matches("form") || isSubmitByText(el)) return true;
  const control = el.closest("button, input[type='image'], [role='button']");
  if (!control) return false;
  const inForm = (control as HTMLButtonElement).form ?? control.closest("form");
  if (!inForm) return false;
  return control.matches("button:not([type]), input[type='image']") || APPLY.test(text(control));
}

/** The form's Submit: a visible submit control in it, or tied to it by `form=`. */
function submitButton(doc: Document): HTMLElement | null {
  const form = applicationForm(doc);
  if (!form) return null;
  const outside = form.id ? [...doc.querySelectorAll<HTMLElement>(`[form="${cssEscape(form.id)}"]`)] : [];
  const candidates = [...form.querySelectorAll<HTMLElement>("button, input[type='submit'], input[type='image']")];
  return [...candidates, ...outside].find((b) => isVisible(b) && isSubmit(b)) ?? null;
}

/** The job title: the page's first visible `h1`, else its document title. */
function jobTitle(doc: Document): string {
  const h1 = [...doc.querySelectorAll("h1")].find(isVisible);
  return text(h1) || norm(doc.title);
}

/** The form's own alerts: errors the page shows for the whole form. */
function errors(doc: Document): string[] {
  const form = applicationForm(doc);
  if (!form) return [];
  const out = new Set<string>();
  for (const el of form.querySelectorAll("[role='alert']")) {
    const t = text(el);
    if (t && isVisible(el)) out.add(t.slice(0, 300));
  }
  return [...out];
}

export const generic: SiteDefinition = {
  info: GENERIC,
  widgets: Object.values(WIDGETS),
  fields: (doc) => read(doc).spots,
  addButtons: () => [],
  rows: () => [],
  page: {
    kind: (doc, _url, count) => singlePageKind(doc, count, null),
    step: (doc) => (applicationForm(doc) ? singleStep(jobTitle(doc)) : undefined),
    job: (doc) => titledJob(jobTitle(doc)),
    stepKey: (_doc, url) => url,
    errors,
    messages: (doc) => {
      const { skipped } = read(doc);
      if (!skipped) return [];
      const what = skipped === 1 ? "1 control on this form isn't" : `${skipped} controls on this form aren't`;
      return [
        `${what} a plain HTML field with a label (a custom widget, or an input without a prompt), so get_form doesn't list it: ask the user to fill it.`,
      ];
    },
    actions: () => [],
    actionButton: () => null,
    next: submitButton,
    back: () => null,
    label: (b) => text(b) || (b as HTMLInputElement).value || b.getAttribute("aria-label") || "",
    isSubmit,
  },
  repeat: noRepeats,
  fill: { order: "given" },
  waits: standardWaits,
  messages: singlePageMessages(),
};
