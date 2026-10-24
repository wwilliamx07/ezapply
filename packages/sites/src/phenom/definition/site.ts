import { cleanLabel, isVisible, norm, slug, text } from "@ezapply/engine/dom";
import { CONFIRMATION_TEXT, promptOf, standardWaits, visibleTexts } from "@ezapply/engine/standard";
import type { AddButtonSpot, FieldSpot, RowSpot, SiteDefinition, WidgetDriver } from "@ezapply/engine/types";
import { comboboxDriver } from "@ezapply/engine/widgets/combobox";
import { monthPickerDriver } from "@ezapply/engine/widgets/datepicker";
import { fileDriver } from "@ezapply/engine/widgets/file";
import {
  checkboxDriver,
  checkboxGroupDriver,
  dateInputDriver,
  radioDriver,
  selectDriver,
  textDriver,
} from "@ezapply/engine/widgets/native";
import type { FormSchema } from "@ezapply/protocol";
import { siteInfo } from "../../registry.js";

/**
 * Phenom People's apply flow, on an employer's own careers domain (`…/apply?jobSeqNo=…&step=<n>&stepname=<id>`):
 * several steps named like Workday's (My information, My experience, Application questions, Additional application
 * questions, Terms & Conditions, Review), each a react-jsonschema-form (`form.rjsf`) with Next and Previous. Every
 * control has an id that is its path in the form's data (`cntryFields.firstName`, `experienceData[0].fromTo.startDate`)
 * and a `label[for]`; lists are native selects, a school is a typeahead (react-bootstrap-typeahead), work dates are a
 * react-datepicker month picker, rows (work, education, languages, websites) are arrays with "+ Add" and "−" buttons.
 * The resume sits above the form on step 1 (required there: Next is refused with an alert without one) and is parsed
 * into the fields when attached.
 *
 * Built from steps 1 to 3 of one employer's flow, read and filled live with placeholder values (never submitted);
 * steps 4 to 6 weren't seen. See references/components/sites/phenom.md.
 */

const SEL = {
  box: ".phenom-form-container",
  form: ".phenom-form-container form.rjsf",
  control: "input[id]:not([type='hidden']):not(.rbt-input-hint), select[id], textarea[id]",
  // A field's own group: the nearest form group, except the "I currently work here" box, which sits beside the dates.
  group: ".daterangepicker-checkbox, .form-group",
  steps: ".progressbarlist li[atm-id]",
  next: ".phenom-form-container form.rjsf button#next, .phenom-form-container form.rjsf button.btn-next",
  back: ".phenom-form-container form.rjsf button#previous, .phenom-form-container form.rjsf button.btn-prev",
  apply: "a[data-ph-at-id='apply-link']",
  errors: ".error-msg .errorList li",
  resume: ".resume-section",
  attachments: ".addln-object-single-row",
};

const WIDGETS = {
  resume: fileDriver({
    input: (c) => c.querySelector<HTMLInputElement>(".resume-upload-wrapper input[type='file']"),
    names: (c) =>
      [...c.querySelectorAll<HTMLAnchorElement>(".has-resume a.downloadFile")].map(fileName).filter(Boolean),
  }),
  attachments: fileDriver({
    names: (c) => [...c.querySelectorAll<HTMLElement>(".additional-attachment-list li a")].map(text).filter(Boolean),
  }),
  month: monthPickerDriver(),
  date: dateInputDriver(),
  school: comboboxDriver(),
  select: selectDriver({ settled: true }),
  checkbox: checkboxDriver(),
  checkboxes: checkboxGroupDriver(),
  radio: radioDriver(),
  textarea: textDriver("textarea"),
  text: textDriver("text"),
};

/** Profile hints by the last part of a control's id, lowercased (Phenom's own fields). */
const HINTS: Record<string, string> = {
  firstname: "identity.firstName",
  middlename: "identity.middleName",
  lastname: "identity.lastName",
  addressline1: "contact.address.line1",
  addressline2: "contact.address.line2",
  city: "contact.address.city",
  region: "contact.address.region",
  postalcode: "contact.address.postalCode",
  email: "contact.email",
  country: "contact.address.country",
  countryphonecode: "contact.phone.countryCode",
  phonenumber: "contact.phone.number",
  devicetype: "contact.phone.type",
};

/**
 * An uploaded resume's name, from its download link: the link's `download` attribute, else the `fileName` in its
 * URL, else its `aria-label` ("Download resume.pdf"), else its text. Some tenants show only "Download" as the
 * link's text, which read as the file's name made every upload look missing (the page had parsed the resume into
 * the fields) and offered "Download" for removal.
 */
function fileName(a: HTMLAnchorElement): string {
  const attr = a.getAttribute("download")?.trim();
  if (attr) return attr;
  try {
    const param = new URL(a.getAttribute("href") ?? "", a.ownerDocument.baseURI).searchParams.get("fileName")?.trim();
    if (param) return param;
  } catch {
    // No URL: the label or the text.
  }
  const label = a
    .getAttribute("aria-label")
    ?.replace(/^\s*download\b\s*/i, "")
    .trim();
  return label || text(a);
}

/** A heading without its trailing colon, and an array's "Add …" legend as the list's name. */
const title = (s: string) =>
  cleanLabel(s)
    .replace(/\s*:\s*$/, "")
    .replace(/^add\s+/i, "");

/** A fieldset's legend when it reads as a heading ("Skills :"), not a data path (`cntryFields`, `jsqData`). */
function legendOf(fs: Element): string | undefined {
  const legend = fs.querySelector(":scope > legend");
  if (!legend || legend.id === "__title") return undefined;
  const t = title(text(legend));
  return /\s/.test(t) || /^[A-Z][a-z]+$/.test(t) ? t : undefined;
}

/** A list's name: the description under its legend ("Work experience :"), else the legend ("Add education"). */
function arrayTitle(arr: Element): string {
  const description = arr.querySelector(":scope > .field-description");
  return title(text(description) || text(arr.querySelector(":scope > legend"))) || "Rows";
}

/** The rows of a list, in order. */
const itemsOf = (arr: Element) => [...arr.querySelectorAll<HTMLElement>(":scope > .array-item")];

/** The section a control is in: its row ("Work experience 2"), else the nearest heading-like legend, else the step. */
function sectionOf(control: Element, step: string): string {
  const item = control.closest<HTMLElement>(".array-item");
  const arr = item?.closest("fieldset.field-array");
  if (item && arr) return `${arrayTitle(arr)} ${itemsOf(arr).indexOf(item) + 1}`;
  for (let fs = control.closest("fieldset"); fs; fs = fs.parentElement?.closest("fieldset") ?? null) {
    const t = legendOf(fs);
    if (t) return t;
  }
  return step;
}

/** The last part of the id, without row indexes, when it reads as a name (`firstName`, `LISTENING`); else none. */
function idKey(id: string): string | undefined {
  const last = (id.split(".").pop() ?? "").replace(/\[\d+\]/g, "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]{2,}$/.test(last)) return undefined;
  return last === last.toUpperCase() ? last.toLowerCase() : last;
}

function promptFor(control: Element): string {
  const own = control.closest("label");
  return (own ? cleanLabel(text(own)) : "") || promptOf(control);
}

function driverOf(control: Element): WidgetDriver {
  if (control.closest(".react-datepicker-wrapper")) return WIDGETS.month;
  if (control.getAttribute("role") === "combobox") return WIDGETS.school;
  if (control.matches("select")) return WIDGETS.select;
  if (control.matches("textarea")) return WIDGETS.textarea;
  const type = control.getAttribute("type");
  if (type === "checkbox") return WIDGETS.checkbox;
  if (type === "date" || type === "month") return WIDGETS.date;
  return WIDGETS.text;
}

/**
 * The options of one question, for a radio or checkbox: react-jsonschema-form puts them in `.field-radio-group` or
 * `.checkboxes` (id: the field's path) under the question's `label[for]`, each option a wrapping label. Else the
 * `.form-group` holding them all. A lone checkbox (an agreement, "I currently work here") is no group. Why: read one
 * by one, every option was a field of its own whose container was the whole `.form-group`, so the checkbox driver
 * read and ticked the first option whichever was asked for (a live tenant's education question got "Doctorate", and
 * every option read as ticked), radios fell to the text driver ("Yes" and "No" as text fields), and the question
 * itself was never read.
 */
function choiceGroup(control: HTMLElement, group: HTMLElement): HTMLElement | undefined {
  const type = control.getAttribute("type");
  if (type !== "radio" && type !== "checkbox") return undefined;
  const own = control.closest<HTMLElement>(".field-radio-group, .checkboxes, [role='radiogroup'], [role='group']");
  const box = own && group.contains(own) ? own : group;
  return type === "radio" || box.querySelectorAll("input[type='checkbox']").length > 1 ? box : undefined;
}

/** A group's question: its `label[for]`, the group's own label (one around no option), or its fieldset's legend. */
function groupPrompt(box: HTMLElement, group: HTMLElement): string {
  const byFor = box.id ? promptOf(box) : "";
  if (byFor) return byFor;
  const label = [...group.querySelectorAll("label")].find(
    (l) => !l.querySelector("input") && (box === group || !box.contains(l)),
  );
  const legend = box.closest("fieldset")?.querySelector(":scope > legend");
  return cleanLabel(text(label) || text(legend)).replace(/\s*[✱*]\s*$/, "");
}

function currentStep(doc: Document): { li: Element; index: number; total: number } | undefined {
  const seen = new Map<string, Element>();
  for (const li of doc.querySelectorAll(SEL.steps)) {
    const id = li.getAttribute("atm-id") ?? "";
    if (!li.closest(".slick-cloned") && !seen.has(id)) seen.set(id, li);
  }
  const all = [...seen.values()];
  const li = all.find((l) => l.getAttribute("aria-current") === "step");
  return li ? { li, index: all.indexOf(li) + 1, total: all.length } : undefined;
}

const stepTitle = (doc: Document) => {
  const s = currentStep(doc);
  return s ? norm(text(s.li.querySelector(".title")) || s.li.getAttribute("atm-value")) : "Application";
};

function fields(doc: Document): FieldSpot[] {
  const form = doc.querySelector(SEL.form);
  if (!form) return [];
  const step = stepTitle(doc);
  const out: FieldSpot[] = [];
  // Each question with options is one field, however many inputs it has.
  const grouped = new Set<HTMLElement>();
  // The resume, above the form on step 1.
  const resume = doc.querySelector<HTMLElement>(`${SEL.box} ${SEL.resume}`);
  if (resume && WIDGETS.resume.is(resume)) {
    out.push({
      container: resume,
      driver: WIDGETS.resume,
      key: "resume",
      label: "Resume",
      section: step,
      required: true,
    });
  }
  for (const control of form.querySelectorAll<HTMLElement>(SEL.control)) {
    const id = control.id;
    if (control.matches("input[type='file']")) {
      const container = control.closest<HTMLElement>(SEL.attachments) ?? control.parentElement;
      if (!container) continue;
      const heading = text(form.querySelector(".addln-attach-header"));
      out.push({
        container,
        driver: WIDGETS.attachments,
        key: "attachments",
        label: title(heading) || "Attachments",
        section: sectionOf(control, step),
        required: false,
      });
      continue;
    }
    const group = control.closest<HTMLElement>(SEL.group);
    if (!group || !isVisible(group)) continue;
    const choices = choiceGroup(control, group);
    if (choices) {
      if (grouped.has(choices)) continue;
      grouped.add(choices);
      const inputs = [...choices.querySelectorAll<HTMLInputElement>("input[type='radio'], input[type='checkbox']")];
      const prompt = groupPrompt(choices, group) || choices.id || inputs[0]?.name || "";
      const section = sectionOf(choices, step);
      const error =
        text(choices.id ? doc.getElementById(`${choices.id}-errorMsg`) : null) ||
        text(group.querySelector(".error-detail li"));
      out.push({
        container: choices,
        driver: control.getAttribute("type") === "radio" ? WIDGETS.radio : WIDGETS.checkboxes,
        key: idKey(choices.id) ?? (slug(prompt).slice(0, 40) || slug(inputs[0]?.name ?? "choice")),
        label: prompt,
        section,
        required:
          inputs.some((i) => i.hasAttribute("required") || i.getAttribute("aria-required") === "true") ||
          Boolean(group.querySelector(":scope > label .required, label[for] .required")),
        ...(error ? { error: error.slice(0, 300) } : {}),
      });
      continue;
    }
    const driver = driverOf(control);
    // Drivers that look inside their container need one holding just this control; the others take the control.
    const container = [WIDGETS.checkbox, WIDGETS.month, WIDGETS.school, WIDGETS.date].includes(driver)
      ? group
      : control;
    const section = sectionOf(control, step);
    const prompt = promptFor(control) || id;
    // A field under a heading outside the rows can be labelled by its instruction alone ("Separate each skill with a
    // comma." under "Skills"): the heading says what it is.
    const named =
      section === step || control.closest(".array-item") || norm(prompt).toLowerCase().includes(section.toLowerCase());
    const label = named ? prompt : `${section}: ${prompt}`;
    const key = idKey(id);
    const error = text(doc.getElementById(`${id}-errorMsg`)) || text(group.querySelector(".error-detail li"));
    const hint = key && !control.closest(".array-item") ? HINTS[key.toLowerCase()] : undefined;
    out.push({
      container,
      driver,
      key: key ?? (slug(prompt).slice(0, 40) || slug(id)),
      label,
      section,
      required:
        control.hasAttribute("required") ||
        control.getAttribute("aria-required") === "true" ||
        Boolean(group.querySelector(":scope > label .required, label[for] .required")),
      ...(error ? { error: error.slice(0, 300) } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

function addButtons(doc: Document): AddButtonSpot[] {
  return [...doc.querySelectorAll<HTMLElement>(`${SEL.form} button.array-button-add`)].filter(isVisible).map((el) => {
    const arr = el.closest("fieldset.field-array");
    const list = arr ? arrayTitle(arr) : "Rows";
    return {
      el,
      key: `add.${slug(list)}`,
      label: el.getAttribute("aria-label") || title(text(el).replace(/^\+\s*/, "")),
      section: list,
      kind: "row" as const,
    };
  });
}

function rows(doc: Document): RowSpot[] {
  const out: RowSpot[] = [];
  for (const arr of doc.querySelectorAll(`${SEL.form} fieldset.field-array`)) {
    const list = arrayTitle(arr);
    for (const [i, item] of itemsOf(arr).entries()) {
      const button = item.querySelector<HTMLElement>("button.array-button-remove");
      if (!button) continue;
      const name = `${list} ${i + 1}`;
      out.push({ sectionId: slug(name), title: name, el: item, button });
    }
  }
  return out;
}

/** Submit by its words: Phenom's Next is a `type=submit` button too, so the type says nothing. */
function isSubmit(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  const words = norm(
    `${text(control)} ${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("value") ?? ""}`,
  );
  return /^submit\b/i.test(words) || /\bsubmit (my )?application\b/i.test(words);
}

const visibleIn = (doc: Document, selector: string) =>
  [...doc.querySelectorAll<HTMLElement>(selector)].find(isVisible) ?? null;

/** The way forward: Next, or on the last step its Submit (which `next` then refuses). */
function nextButton(doc: Document): HTMLElement | null {
  return (
    visibleIn(doc, SEL.next) ??
    [...doc.querySelectorAll<HTMLElement>(`${SEL.form} button`)].find((b) => isVisible(b) && isSubmit(b)) ??
    null
  );
}

/** "Software Developer Intern (R-0000000001)" in the page's header: the job's title and requisition. */
function job(doc: Document): FormSchema["job"] {
  const t = norm(text(doc.querySelector(`${SEL.box} .job-summary .job-title`)));
  if (!t) return undefined;
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(t);
  return m ? { title: m[1] as string, reqId: m[2] as string } : { title: t };
}

export const phenom: SiteDefinition = {
  info: siteInfo("phenom") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: Object.values(WIDGETS),
  fields,
  addButtons,
  rows,
  page: {
    kind: (doc, _url, count) => {
      if (currentStep(doc)?.li.getAttribute("atm-id") === "applicationReview") return "review";
      if (count > 0 || doc.querySelector(SEL.form)) return "step";
      if (CONFIRMATION_TEXT.test(norm(doc.body.textContent).slice(0, 20000))) return "confirmation";
      return visibleIn(doc, SEL.apply) ? "posting" : "unknown";
    },
    step: (doc) => {
      const s = currentStep(doc);
      return s ? { index: s.index, total: s.total, title: stepTitle(doc) } : undefined;
    },
    job,
    stepKey: (doc, url) => `${currentStep(doc)?.li.getAttribute("atm-id") ?? ""}|${url}`,
    errors: (doc) => visibleTexts(doc, SEL.errors),
    messages: () => [],
    actions: (doc) => (!doc.querySelector(SEL.form) && visibleIn(doc, SEL.apply) ? ["apply"] : []),
    actionButton: (doc, action) => (action === "apply" ? visibleIn(doc, SEL.apply) : null),
    next: nextButton,
    // Step 1 won't go on without a resume, and says so in an alert, which stops the page until it's dismissed.
    nextBlocked: (doc) => {
      const resume = doc.querySelector<HTMLElement>(`${SEL.box} ${SEL.resume}`);
      if (currentStep(doc)?.li.getAttribute("atm-id") !== "personalInformation" || !resume) return undefined;
      return (WIDGETS.resume.value(resume) as string[]).length
        ? undefined
        : "The page won't go on without a resume: upload_file it to the resume field first (the page then fills " +
            "fields from it: check them).";
    },
    back: (doc) => visibleIn(doc, SEL.back),
    label: (b) => norm(text(b)) || b.getAttribute("aria-label") || "",
    isSubmit,
  },
  repeat: {
    noun: "row",
    added: (doc) => doc.querySelectorAll(`${SEL.form} .array-item`).length,
    removed: (doc) => doc.querySelectorAll(`${SEL.form} .array-item`).length,
    deleteButton: async (row) => row.button ?? row.el.querySelector<HTMLElement>("button.array-button-remove"),
    confirmRemoval: async () => {},
  },
  // Dependent fields appear as earlier ones are answered (the region list after the country, a source's details,
  // a follow-up question after "Yes"), so fills go in page order.
  fill: { order: "page" },
  waits: standardWaits,
  messages: {
    noNextButton: "No Next button found.",
    noBackButton: "This is the first step: there is no Previous button.",
    submitIsNext: () =>
      "The way forward is Submit: this is the last step. The user reviews the application and presses Submit.",
    refuseNext: (kind) =>
      kind === "review"
        ? "This is the review step: the user checks the application and presses Submit."
        : kind === "confirmation"
          ? "The application was already submitted."
          : undefined,
    noSearch: "search_options applies to the school field and other search fields.",
    cantRemove: (kind) =>
      `remove_items works on file fields; this is a ${kind} field. Use fill_fields to change it, or remove_repeatable for a row.`,
  },
};
