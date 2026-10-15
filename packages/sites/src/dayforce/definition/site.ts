import { cleanLabel, isVisible, norm, press, slug, text, waitFor } from "@ezapply/engine/dom";
import { CONFIRMATION_TEXT, headingBefore, standardWaits, visibleTexts } from "@ezapply/engine/standard";
import { T } from "@ezapply/engine/timing";
import type { AddButtonSpot, FieldSpot, RowSpot, SiteDefinition, WidgetDriver } from "@ezapply/engine/types";
import { antSelectDriver } from "@ezapply/engine/widgets/antd-select";
import { fileDriver } from "@ezapply/engine/widgets/file";
import {
  checkboxDriver,
  checkboxGroupDriver,
  dateInputDriver,
  radioDriver,
  textDriver,
} from "@ezapply/engine/widgets/native";
import type { FormSchema } from "@ezapply/protocol";
import { siteInfo } from "../../registry.js";

/**
 * Dayforce's candidate portal (`jobs.dayforcehcm.com/<locale>/<client>/<site>/jobs/<id>/apply/manualApplication`): a
 * Next.js app on Ant Design. The application is one antd form (`#jobPostingApplication`) shown a step at a time
 * (Candidate Info, Questionnaire, Submit) with Next and Previous in a footer. Candidate Info holds the Personal
 * Information form (with its own Update and Cancel), Employment History, Education History (and References, where the
 * employer asks) as records added through "Add …" and saved one by one with their Update, and the resume, cover letter
 * and other documents. Every control's id is its path in the form (`jobPostingApplication_personalInfo_firstName`,
 * `…_workHistory_0_title`, `…_sections_0_questionnaire_questions_2_selectedOption`).
 *
 * Built from a saved Candidate Info page (a new candidate's, before anything was added) and, for what that page
 * doesn't show (the questionnaire, records, their read mode and delete dialog, the Submit step), from the portal's own
 * scripts. See references/components/sites.md.
 */

const SEL = {
  root: "#jobPostingApplication",
  item: ".ant-form-item",
  label: ":scope > .ant-form-item-row > .ant-form-item-label label",
  error: ".ant-form-item-explain-error",
  /** A saved or open record (`workhistory-record`, `educationhistory-record`, `reference-record`). */
  record: "form[test-id$='-record']",
  personalInfo: "form#personalInfo",
  addRecord: "button[test-id^='add-'][test-id$='-record']",
  update: "button[test-id$='-update-button']",
  cancel: "button[test-id$='-cancel-button']",
  edit: "button[test-id$='-edit-button']",
  delete: "button[test-id$='-delete-button']",
  deleteOk: "[test-id$='-delete-modal-ok-button']",
  steps: "[test-id^='application-progress-step-']",
  stepTitle: "[test-id='application-step-title']",
  questionnaire: "[test-id='questionnaire-progress']",
  next: "[test-id='application-next-step']",
  back: "[test-id='application-previous-step']",
  submit: "[test-id='application-submit']",
  jobTitle: "[test-id='job-detail-title']",
  jobReq: "[test-id='job-detail-job-req-id']",
  main: "main",
  /** The upload above Personal Information ("Import Resume"): the same file as the Resume section's, left out. */
  importResume: "[test-id='import-resume-section']",
  notices: ".ant-notification-notice-success .ant-notification-notice-message, .ant-message-success",
  errors:
    ".ant-notification-notice-error .ant-notification-notice-message, .ant-message-error, .ant-alert-error .ant-alert-message",
};

/** An upload list's entry: its file's name. */
const nameOf = (item: Element) => {
  const el = item.querySelector(".ant-upload-list-item-name");
  return el ? norm(el.getAttribute("title")) || text(el) : "";
};

/** The files in a field's upload list, once uploaded (not while going, nor when failed). */
const uploadedItems = (c: HTMLElement) => [
  ...c.querySelectorAll<HTMLElement>(
    ".ant-upload-list-item:not(.ant-upload-list-item-uploading):not(.ant-upload-list-item-error)",
  ),
];

const WIDGETS = {
  file: fileDriver({
    names: (c) => uploadedItems(c).map(nameOf).filter(Boolean),
    removeButton: (c, name) =>
      uploadedItems(c)
        .find((i) => nameOf(i) === name)
        ?.querySelector<HTMLElement>("[test-id$='-delete-icon-button'], .ant-upload-list-item-actions button") ?? null,
  }),
  select: antSelectDriver(),
  radio: radioDriver(),
  checkboxes: checkboxGroupDriver(),
  checkbox: checkboxDriver(),
  date: dateInputDriver(),
  textarea: textDriver("textarea"),
  number: textDriver("number", "input.ant-input-number-input"),
  text: textDriver("text"),
};

/** Profile hints by the id's last part, lowercased, outside records. The email is the account's when signed in. */
const HINTS: Record<string, string> = {
  firstname: "identity.firstName",
  middlename: "identity.middleName",
  lastname: "identity.lastName",
  email: "contact.email",
  confirmemail: "contact.email",
  linkedinurl: "links.linkedin",
  mobilephone: "contact.phone.number",
  confirmmobilephone: "contact.phone.number",
  mobilephonecountrycode: "contact.phone.countryCode",
  confirmmobilephonecountrycode: "contact.phone.countryCode",
  address1: "contact.address.line1",
  address2: "contact.address.line2",
  city: "contact.address.city",
  postalcode: "contact.address.postalCode",
  countrycode: "contact.address.country",
  statecode: "contact.address.region",
};

/** Hints inside a record, by its list and the id's last part. */
const RECORD_HINTS: Record<string, Record<string, string>> = {
  workHistory: {
    title: "work[].title",
    companyname: "work[].company",
    effectivestart: "work[].start",
    effectiveend: "work[].end",
    iscurrent: "work[].end (null = current)",
    description: "work[].highlights",
  },
  educationHistory: {
    schoolname: "education[].school",
    degreename: "education[].degree",
    majorname: "education[].field",
    gpa: "education[].gpa",
    effectivestart: "education[].start",
    effectiveend: "education[].end",
  },
};

/** The parts of a questionnaire answer's id that say nothing about the question: its prompt names it instead. */
const GENERIC_KEYS = new Set(["selectedoption", "selectedoptionids", "answertext", "ischecked", "answerfollowup"]);

/** The id's last part (`jobPostingApplication_personalInfo_firstName` → `firstName`), when it names the field. */
function idKey(id: string | null | undefined): string | undefined {
  const last = (id ?? "").split("_").pop() ?? "";
  return /^[A-Za-z][A-Za-z0-9]{1,}$/.test(last) && !GENERIC_KEYS.has(last.toLowerCase()) ? last : undefined;
}

const visibleIn = (scope: ParentNode, selector: string) =>
  [...scope.querySelectorAll<HTMLElement>(selector)].find(isVisible) ?? null;

/** The step bar's current step, its place and how many there are. */
function currentStep(doc: Document): { el: HTMLElement; index: number; total: number } | undefined {
  const all = [...doc.querySelectorAll<HTMLElement>(SEL.steps)];
  const el = all.find((s) => s.getAttribute("aria-current") === "step" || s.matches(".ant-steps-item-active"));
  return el ? { el, index: all.indexOf(el) + 1, total: all.length } : undefined;
}

/** The step's title ("Candidate Info"), with the questionnaire's place in it ("Questionnaire 2 of 3"). */
function stepTitle(doc: Document): string {
  const step = currentStep(doc);
  const title =
    text(visibleIn(doc, SEL.stepTitle)) || text(step?.el.querySelector(".ant-steps-item-title")) || "Application";
  const progress = text(visibleIn(doc, SEL.questionnaire));
  return progress && !title.includes(progress) ? `${title} (${progress})` : title;
}

/** A record's list ("Employment History"), its place in it (from its id: `workHistory-0` is 1), and its list's id. */
function recordOf(form: Element, root: Element): { list: string; n: number; name: string; listId: string } {
  const listId = (form.id || "").replace(/-\d+$/, "");
  const n = Number(/-(\d+)$/.exec(form.id)?.[1] ?? "0") + 1;
  const list = headingBefore(form, "h2", root).replace(/\s*\*$/, "");
  return { list, n, name: `${list} ${n}`, listId };
}

/** The section a control is in: its record ("Employment History 1"), else the heading above it, else the step. */
function sectionOf(el: Element, root: Element, step: string): string {
  const record = el.closest(SEL.record);
  if (record) return recordOf(record, root).name;
  const heading = headingBefore(el, "h2", root);
  return heading === "Main" ? step : heading.replace(/\s*\*$/, "");
}

/** Elements matching `selector` that belong to this form item, not to one nested in it (a follow-up question). */
const own = <E extends Element>(item: HTMLElement, selector: string) =>
  [...item.querySelectorAll<E>(selector)].filter((el) => el.closest(SEL.item) === item);

/** The control a form item's driver fills, by what the item holds, with the element whose id names it. */
function controlOf(item: HTMLElement): { driver: WidgetDriver; container: HTMLElement; named: Element } | undefined {
  const first = <E extends HTMLElement>(sel: string) => own<E>(item, sel)[0];
  const radios = first(".ant-radio-group");
  if (radios) return { driver: WIDGETS.radio, container: item, named: radios };
  const group = first(".ant-checkbox-group");
  if (group) return { driver: WIDGETS.checkboxes, container: item, named: group };
  const select = first(".ant-select");
  if (select) return { driver: WIDGETS.select, container: item, named: select.querySelector("input") ?? select };
  const box = first<HTMLInputElement>("input[type='checkbox']");
  if (box) return { driver: WIDGETS.checkbox, container: item, named: box };
  const date = first<HTMLInputElement>("input[type='date']");
  if (date) return { driver: WIDGETS.date, container: item, named: date };
  const area = first<HTMLTextAreaElement>("textarea");
  if (area) return { driver: WIDGETS.textarea, container: area, named: area };
  const number = first<HTMLInputElement>("input.ant-input-number-input");
  if (number) return { driver: WIDGETS.number, container: number, named: number };
  const input = own<HTMLInputElement>(
    item,
    "input:not([type]), input[type='text'], input[type='email'], input[type='tel']",
  ).filter((i) => !i.closest(".ant-select"))[0];
  if (input) return { driver: WIDGETS.text, container: input, named: input };
  return undefined;
}

function promptOf(item: HTMLElement, named: Element): string {
  const label = item.querySelector(SEL.label);
  return (
    cleanLabel(text(label)) ||
    cleanLabel(label?.getAttribute("title")) ||
    norm(named.getAttribute("aria-label")) ||
    norm(item.closest("fieldset")?.querySelector("legend")?.getAttribute("aria-label")) ||
    cleanLabel(text(own(item, ".ant-checkbox-wrapper")[0])) ||
    ""
  );
}

function fields(doc: Document): FieldSpot[] {
  const root = doc.querySelector(SEL.root);
  if (!root) return [];
  const step = stepTitle(doc);
  const out: FieldSpot[] = [];
  for (const item of root.querySelectorAll<HTMLElement>(SEL.item)) {
    if (!isVisible(item) || item.closest(SEL.importResume)) continue;
    const section = sectionOf(item, root, step);
    const label = item.querySelector(SEL.label);
    const error = own(item, SEL.error).map(text).filter(Boolean).join(" ").slice(0, 300);
    const required = (el: Element) =>
      Boolean(label?.classList.contains("ant-form-item-required")) || el.getAttribute("aria-required") === "true";
    const record = item.closest(SEL.record);
    const hintFor = (key: string | undefined) => {
      if (!key) return undefined;
      const k = key.toLowerCase();
      return record ? RECORD_HINTS[recordOf(record, root).listId]?.[k] : HINTS[k];
    };

    // A file: the resume, cover letter and other documents, each under its own heading.
    const file = own<HTMLInputElement>(item, "input[type='file']")[0];
    if (file) {
      out.push({
        container: item,
        driver: WIDGETS.file,
        key: idKey(file.id) ?? slug(section),
        label: section,
        section,
        required: required(file),
        ...(error ? { error } : {}),
      });
      continue;
    }

    // A phone number: its dialling code (a list without an id of its own) and the number, two fields.
    const phone = own<HTMLElement>(item, ".ant-space-compact")[0];
    const code = phone?.querySelector<HTMLElement>(".ant-select");
    const number = phone?.querySelector<HTMLInputElement>("input.ant-input");
    if (code && number) {
      const prompt = promptOf(item, number);
      const key = idKey(number.id) ?? slug(prompt);
      const codeHint = hintFor(`${key}CountryCode`);
      const numberHint = hintFor(key);
      out.push({
        container: code,
        driver: WIDGETS.select,
        key: `${key}CountryCode`,
        label: `${prompt}: ${norm(code.getAttribute("aria-label")) || "country code"}`,
        section,
        required: required(number),
        ...(codeHint ? { hint: codeHint } : {}),
      });
      out.push({
        container: number,
        driver: WIDGETS.text,
        key,
        label: prompt,
        section,
        required: required(number),
        ...(error ? { error } : {}),
        ...(numberHint ? { hint: numberHint } : {}),
      });
      continue;
    }

    const control = controlOf(item);
    if (!control) continue;
    const prompt = promptOf(item, control.named) || slug(section);
    const key = idKey(control.named.id);
    // Only a text input: a list's search box is read-only whenever the list can't be searched.
    const readOnly = control.driver === WIDGETS.text && control.named.matches("input[readonly]");
    const hint = readOnly ? undefined : hintFor(key);
    out.push({
      container: control.container,
      driver: control.driver,
      key: key ?? (slug(prompt).slice(0, 40) || "field"),
      label: prompt,
      section,
      required: required(control.named),
      ...(readOnly ? { help: "Read-only on this page." } : {}),
      ...(error ? { error } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

/** Whether a record is open for editing: its fields show, with its Update. */
const editing = (record: Element) => Boolean(visibleIn(record, SEL.update));

/** A saved record's summary as the page shows it: its title, employer or school, dates. */
const summaryOf = (record: Element) => norm(text(record)).slice(0, 160);

/** A saved record's kind, as the companion tells work from education among saved items. */
const itemKind = (list: string) =>
  /employ|work|experience/i.test(list) ? "experience" : /education/i.test(list) ? "education" : "item";

function addButtons(doc: Document): AddButtonSpot[] {
  const root = doc.querySelector(SEL.root);
  if (!root) return [];
  const step = stepTitle(doc);
  const out: AddButtonSpot[] = [];
  // "Add Employment History" opens a new record's form, saved with its Update.
  for (const el of root.querySelectorAll<HTMLElement>(SEL.addRecord)) {
    if (!isVisible(el)) continue;
    const section = sectionOf(el, root, step);
    out.push({ el, key: `add.${slug(section)}`, label: text(el) || `Add ${section}`, section, kind: "form" });
  }
  // An open form's Update: Personal Information's, or a record's.
  for (const el of root.querySelectorAll<HTMLElement>(SEL.update)) {
    if (!isVisible(el)) continue;
    const form = el.closest("form");
    const record = form?.matches(SEL.record) ? form : null;
    const section = record ? recordOf(record, root).name : sectionOf(form ?? el, root, step);
    out.push({ el, key: `save.${slug(section)}`, label: text(el) || "Update", section, kind: "save" });
  }
  // Edit on a saved record, or on Personal Information when it shows as a summary: opens its form again.
  for (const el of root.querySelectorAll<HTMLElement>(SEL.edit)) {
    if (!isVisible(el)) continue;
    const record = el.closest(SEL.record);
    const section = record
      ? `${recordOf(record, root).list}: ${summaryOf(record)}`
      : sectionOf(el.closest("form") ?? el, root, step);
    const key = record ? `edit.${slug(recordOf(record, root).name)}` : `edit.${slug(section)}`;
    out.push({ el, key, label: el.getAttribute("aria-label") || "Edit", section, kind: "edit" });
  }
  return out;
}

function rows(doc: Document): RowSpot[] {
  const root = doc.querySelector(SEL.root);
  if (!root) return [];
  const out: RowSpot[] = [];
  for (const record of root.querySelectorAll<HTMLElement>(SEL.record)) {
    if (!isVisible(record)) continue;
    const { list, n, name } = recordOf(record, root);
    if (editing(record)) {
      // An open record: Cancel drops a new one (an edited saved one only goes back to its summary).
      const button = visibleIn(record, SEL.cancel);
      if (button) out.push({ sectionId: slug(name), title: name, el: record, button });
      continue;
    }
    const button = visibleIn(record, SEL.delete);
    if (!button) continue;
    const title = summaryOf(record);
    out.push({
      sectionId: `${slug(list)}.${itemKind(list)}-${n}`,
      title,
      sectionTitle: `${list}: ${title}`,
      el: record,
      saved: true,
      button,
    });
  }
  return out;
}

/** Submit by its hook or its words. Personal Information's and the records' Update are `type=submit` too. */
function isSubmit(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  if (control.matches(SEL.submit)) return true;
  const words = norm(
    `${text(control)} ${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("value") ?? ""}`,
  );
  return /^submit\b/i.test(words) || /\bsubmit (my )?application\b/i.test(words);
}

/** The posting's Apply: by its words, since the posting page wasn't seen ("Apply", aria-label "Apply for <job>"). */
function applyButton(doc: Document): HTMLElement | null {
  const main = doc.querySelector(SEL.main) ?? doc.body;
  return (
    [...main.querySelectorAll<HTMLElement>("a, button")].find(
      (b) => isVisible(b) && (/^apply$/i.test(text(b)) || /^apply for\b/i.test(b.getAttribute("aria-label") ?? "")),
    ) ?? null
  );
}

/** "Req #0000" beside the job's title: the requisition without its prefix. */
function job(doc: Document): FormSchema["job"] {
  const title = text(doc.querySelector(SEL.jobTitle));
  const req = text(doc.querySelector(SEL.jobReq)).replace(/^req(uisition)?\s*(#|no\.?|id)?\s*:?\s*/i, "");
  if (!title && !req) return undefined;
  return { ...(title ? { title } : {}), ...(req ? { reqId: req } : {}) };
}

/** Field errors with their prompts where the message doesn't name the field, and the page's error notices. */
function errors(doc: Document): string[] {
  const root = doc.querySelector(SEL.root);
  const out = new Set<string>();
  for (const el of root?.querySelectorAll<HTMLElement>(SEL.error) ?? []) {
    const message = text(el);
    if (!message || !isVisible(el)) continue;
    const item = el.closest<HTMLElement>(SEL.item);
    const prompt = item ? cleanLabel(text(item.querySelector(SEL.label))) : "";
    out.add((prompt && !message.includes(prompt) ? `${prompt}: ${message}` : message).slice(0, 300));
  }
  for (const t of visibleTexts(doc, SEL.errors)) out.add(t);
  return [...out];
}

export const dayforce: SiteDefinition = {
  info: siteInfo("dayforce") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: Object.values(WIDGETS),
  fields,
  addButtons,
  rows,
  page: {
    kind: (doc, _url, count) => {
      // The last step: the acknowledgement and Submit, for the user.
      if (visibleIn(doc, SEL.submit)) return "review";
      const root = doc.querySelector(SEL.root);
      if (root && count > 0) return "step";
      // The page's own text, not the body's: its scripts carry every message of the portal, thanks included.
      if (CONFIRMATION_TEXT.test(norm(text(doc.querySelector(SEL.main))).slice(0, 20000))) return "confirmation";
      if (root && currentStep(doc)) return "step";
      return applyButton(doc) ? "posting" : "unknown";
    },
    step: (doc) => {
      const s = currentStep(doc);
      return s ? { index: s.index, total: s.total, title: stepTitle(doc) } : undefined;
    },
    job,
    // The URL stays the same through the steps: the step bar and the questionnaire's place say where it is.
    stepKey: (doc, url) =>
      `${currentStep(doc)?.el.getAttribute("test-id") ?? ""}|${text(visibleIn(doc, SEL.questionnaire))}|${url}`,
    errors,
    messages: (doc) => visibleTexts(doc, SEL.notices),
    actions: (doc) => (!doc.querySelector(SEL.root) && applyButton(doc) ? ["apply"] : []),
    actionButton: (doc, action) => (action === "apply" ? applyButton(doc) : null),
    next: (doc) => visibleIn(doc, SEL.next) ?? visibleIn(doc, SEL.submit),
    back: (doc) => visibleIn(doc, SEL.back),
    label: (b) => norm(text(b)) || b.getAttribute("aria-label") || "",
    isSubmit,
  },
  repeat: {
    noun: "record",
    // What an Add or an Edit makes more of: the fields on the page.
    added: (doc) =>
      [
        ...(doc
          .querySelector(SEL.root)
          ?.querySelectorAll(`${SEL.item} input:not([type='hidden']), ${SEL.item} textarea`) ?? []),
      ].filter(isVisible).length,
    removed: (doc) => doc.querySelector(SEL.root)?.querySelectorAll(SEL.record).length ?? 0,
    deleteButton: async (row) =>
      row.button?.isConnected ? row.button : (visibleIn(row.el, SEL.delete) ?? visibleIn(row.el, SEL.cancel)),
    /** Deleting a saved record asks first ("Delete this item from your work history?"). */
    confirmRemoval: async (doc) => {
      const ok = await waitFor(() => visibleIn(doc, SEL.deleteOk), T.removeRowMs);
      if (ok) press(ok);
    },
    /** A refused Update leaves its form open with errors under its fields. */
    saveErrors: (button) =>
      [...(button.closest("form") ?? button.ownerDocument).querySelectorAll(SEL.error)].filter(isVisible).length,
  },
  // Dependent fields appear as earlier ones are answered (the region list after the country, "Please Provide
  // Additional Details" after some sources, a follow-up after an answer), so fills go in page order.
  fill: { order: "page" },
  waits: standardWaits,
  messages: {
    noNextButton: "No Next button found.",
    noBackButton: "This is the first step: there is no Previous button.",
    submitIsNext: () =>
      "The way forward is Submit: this is the last step. The user reviews the application and presses Submit.",
    refuseNext: (kind) =>
      kind === "review"
        ? "This is the Submit step: the user reads the Candidate Acknowledgement, agrees to it and presses Submit."
        : kind === "confirmation"
          ? "The application was already submitted."
          : undefined,
    noSearch: "search_options applies to lists.",
    cantRemove: (kind) =>
      `remove_items works on file fields; this is a ${kind} field. Use fill_fields to change it, or remove_repeatable for a record.`,
  },
};
