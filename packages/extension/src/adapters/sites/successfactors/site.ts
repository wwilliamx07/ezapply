import type { FormSchema } from "@ezapply/protocol";
import { siteInfo } from "@ezapply/protocol/sites";
import { isVisible, norm, slug, text, win } from "../../engine/dom.js";
import { CONFIRMATION_TEXT, singleStep, standardWaits, textOfIds } from "../../engine/standard.js";
import type { AddButtonSpot, FieldSpot, RowSpot, SiteDefinition, WidgetDriver } from "../../engine/types.js";
import { checkboxDriver, checkboxGroupDriver, radioDriver, selectDriver, textDriver } from "../../widgets/native.js";
import { ui5DatePickerDriver } from "../../widgets/ui5-datepicker.js";
import { attachmentDriver, picklistDriver, picklistFieldName } from "./widgets.js";

/**
 * SAP SuccessFactors Recruiting's application (`career17.sapsf.com/career?company=…&career_job_req_id=…`, or
 * `…/portalcareer?_s.crb=…` once signed in): one page of collapsible sections (My Documents, Profile Information, the
 * background lists such as Outside Work Experience and Formal Education, Job-Specific Information) with Save and
 * Apply at the foot. Apply submits it. Built with SuccessFactors' own framework (juic): every element's id starts with
 * its component's (`141:_input`), numbered as the page renders, so ids say nothing stable; the fields' `name`s and
 * the sections' titles do. The background lists are rows of fields, added with Add and removed with Remove.
 *
 * Built from a saved application of a signed-in candidate (the profile and two lists filled from an earlier one) and
 * the page's own scripts. See references/components/sites.md.
 */

const SEL = {
  root: "#rcmJobApplicationCtr",
  section: ".rcmFormSectionContent",
  field: ".RCMFormField",
  label: ":scope > label.rcmFormFieldLabel",
  error: ".rcmValidationMsgArea",
  row: ".rcmSectionComponent",
  rowNumber: ".rowNumTextAcc",
  deleteIcon: "[id$='_deleteIcon']",
  addRow: ".addRowButton",
  submit: "[id$='_submitBtn']",
  notices: "#confirmationMsg",
  reqId: "#career_job_req_id",
  main: "#rmkContent, [role='main']",
};

const WIDGETS = {
  attachment: attachmentDriver(),
  picklist: picklistDriver(),
  date: ui5DatePickerDriver(),
  textarea: textDriver("textarea"),
  select: selectDriver(),
  radio: radioDriver(),
  checkboxes: checkboxGroupDriver(),
  checkbox: checkboxDriver(),
  // `type=currency` on a pay field, besides text.
  text: textDriver("text", "input[data-testid='sfTextField'], input[type='text'], input:not([type])"),
};

/** Profile hints by a text field's `name` (the candidate profile's standard fields), or a list's field name. */
const HINTS: Record<string, string> = {
  firstname: "identity.firstName",
  middlename: "identity.middleName",
  lastname: "identity.lastName",
  prefname: "identity.preferredName",
  candidatename: "identity.fullName",
  address: "contact.address.line1",
  address2: "contact.address.line2",
  city: "contact.address.city",
  zip: "contact.address.postalCode",
  cellphone: "contact.phone.number",
  contactemail: "contact.email",
  // Lists, by the field name their component holds (the markup has none).
  country: "contact.address.country",
  state: "contact.address.region",
};

/** A `name` that reads as one (`firstName`, `customExptSal`); not a background list's numbered `VFLD1`. */
const nameKey = (name: string | null | undefined) =>
  name && /^[A-Za-z][A-Za-z0-9]+$/.test(name) && !/^vfld\d+$/i.test(name) ? name : undefined;

/**
 * Hidden on the page: by itself or an element between it and its section's content. Not by the section: a collapsed
 * section's fields are still the application's, and filling them needs no expanding.
 */
function hidden(el: Element, stop: Element | null): boolean {
  const w = win(el);
  for (let e: Element | null = el; e && e !== stop; e = e.parentElement) {
    const h = e as HTMLElement;
    if (h.hidden || h.classList.contains("displayNone") || h.style?.display === "none") return true;
    if (w.getComputedStyle(h).display === "none") return true;
  }
  return false;
}

const shown = (el: Element | null | undefined): el is HTMLElement =>
  Boolean(el) && isVisible(el as Element) && !(el as Element).closest(".displayNone");

/** A section's title: its heading (`<n>:headerLabel`), which its content names. */
function sectionTitle(content: Element): string {
  return textOfIds(content.ownerDocument, content.getAttribute("aria-labelledby")) || "Application";
}

/** The rows of a section's list: each layout with its "Row number n" beside it. */
const rowsIn = (content: Element) =>
  [...content.querySelectorAll<HTMLElement>(SEL.row)].filter((r) =>
    r.parentElement?.querySelector(`:scope > ${SEL.rowNumber}`),
  );

/** The row an element is in, as its list's title and place ("Outside Work Experience 2"), if it's in one. */
function rowOf(el: Element, content: Element): { title: string; row: HTMLElement } | undefined {
  const row = el.closest<HTMLElement>(SEL.row);
  if (!row) return undefined;
  const n = rowsIn(content).indexOf(row);
  return n < 0 ? undefined : { title: `${sectionTitle(content)} ${n + 1}`, row };
}

/** An element's text without SAP's icon font glyphs (private-use characters: Add's plus, Remove's bin). */
const plain = (el: Element | null) => norm(text(el).replace(/[-]/g, ""));

/** The prompt: the label without its required mark. */
const promptOf = (label: Element | null) =>
  plain(label)
    .replace(/^\*\s*/, "")
    .replace(/\s*\*$/, "");

/** The control a field holds, by kind, with the element named by its `name` or `aria-required`. */
function controlOf(field: HTMLElement): { driver: WidgetDriver; control: Element } | undefined {
  const one = (sel: string) => field.querySelector(sel);
  const attach = one(".attachWrapper");
  if (attach) return { driver: WIDGETS.attachment, control: attach };
  const pick = one("input.rcmpaginatedselectinput");
  if (pick) return { driver: WIDGETS.picklist, control: pick };
  const date = one("[ui5-date-picker]");
  if (date) return { driver: WIDGETS.date, control: date };
  const area = one("textarea");
  if (area) return { driver: WIDGETS.textarea, control: area };
  const select = one("select");
  if (select) return { driver: WIDGETS.select, control: select };
  const radios = field.querySelectorAll("input[type='radio']");
  if (radios.length) return { driver: WIDGETS.radio, control: radios[0] as Element };
  const boxes = field.querySelectorAll("input[type='checkbox']");
  if (boxes.length > 1) return { driver: WIDGETS.checkboxes, control: boxes[0] as Element };
  if (boxes.length === 1) return { driver: WIDGETS.checkbox, control: boxes[0] as Element };
  const input = one("input[data-testid='sfTextField'], input[type='text'], input:not([type])");
  if (input) return { driver: WIDGETS.text, control: input };
  return undefined;
}

function fields(doc: Document): FieldSpot[] {
  const root = doc.querySelector(SEL.root);
  if (!root) return [];
  const out: FieldSpot[] = [];
  for (const content of root.querySelectorAll(SEL.section)) {
    const title = sectionTitle(content);
    for (const field of content.querySelectorAll<HTMLElement>(SEL.field)) {
      if (hidden(field, content)) continue;
      const found = controlOf(field);
      if (!found) continue; // A value shown as text (the account's username).
      const { driver, control } = found;
      const label = field.querySelector(SEL.label);
      const prompt = promptOf(label) || norm(control.getAttribute("aria-label"));
      const row = rowOf(field, content);
      const name = control.getAttribute("name");
      const readOnly = control.matches("input[readonly], input[disabled], textarea[readonly], textarea[disabled]");
      // Rows hold a list's numbered fields (`VFLD1`), whose meaning only their labels give: no hints there.
      const hintKey = row
        ? undefined
        : (nameKey(name) ?? (driver === WIDGETS.picklist ? picklistFieldName(field) : undefined));
      const hint = readOnly || !hintKey ? undefined : HINTS[hintKey.toLowerCase()];
      const error = [...field.querySelectorAll(SEL.error)]
        .filter(shown)
        .map(text)
        .filter(Boolean)
        .join(" ")
        .slice(0, 300);
      out.push({
        container: field,
        driver,
        key: nameKey(name) ?? (slug(prompt).slice(0, 40) || "field"),
        label: prompt || "Field",
        section: row?.title ?? title,
        required: Boolean(label?.querySelector(".requiredField")) || control.getAttribute("aria-required") === "true",
        ...(readOnly ? { help: "Read-only on this page." } : {}),
        ...(error ? { error } : {}),
        ...(hint ? { hint } : {}),
      });
    }
  }
  return out;
}

function addButtons(doc: Document): AddButtonSpot[] {
  const root = doc.querySelector(SEL.root);
  if (!root) return [];
  const out: AddButtonSpot[] = [];
  // A list's Add appends a row of fields; it's hidden once the list has as many rows as it takes. Offered in a
  // collapsed section too, like its fields.
  for (const el of root.querySelectorAll<HTMLElement>(SEL.addRow)) {
    const content = el.closest(SEL.section);
    if (!content || hidden(el, content)) continue;
    const section = sectionTitle(content);
    out.push({ el, key: `add.${slug(section)}`, label: plain(el) || "Add", section, kind: "row" });
  }
  return out;
}

function rows(doc: Document): RowSpot[] {
  const root = doc.querySelector(SEL.root);
  if (!root) return [];
  const out: RowSpot[] = [];
  for (const content of root.querySelectorAll(SEL.section)) {
    for (const row of rowsIn(content)) {
      // A required list's last row has its Remove hidden.
      const icon = row.querySelector(SEL.deleteIcon);
      const button = icon?.querySelector<HTMLElement>("[role='button']");
      if (!button || hidden(button, row)) continue;
      const title = rowOf(row, content)?.title ?? sectionTitle(content);
      out.push({ sectionId: slug(title), title, el: row.parentElement ?? row, button });
    }
  }
  return out;
}

/** Apply, by its hook (`<n>:_submitBtn`) or its words. Save keeps a draft and isn't Submit. */
function isSubmit(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  if (control.matches(SEL.submit)) return true;
  const words = norm(
    `${text(control)} ${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("value") ?? ""}`,
  );
  return /^(apply|submit)( now| application)?$/i.test(words);
}

/** The job: the heading's title ("Operations Analyst (1000)") without the requisition, which the page also keeps. */
function job(doc: Document): FormSchema["job"] {
  const heading = text(doc.querySelector(`${SEL.root} h1`));
  const field = doc.querySelector<HTMLInputElement>(SEL.reqId)?.value?.trim();
  const shownReq = /\(([^()]+)\)\s*$/.exec(heading)?.[1]?.trim();
  const reqId = field || shownReq;
  const suffix = reqId ? `(${reqId})` : "";
  const title = suffix && heading.endsWith(suffix) ? heading.slice(0, -suffix.length).trim() : heading;
  if (!title && !reqId) return undefined;
  return { ...(title ? { title } : {}), ...(reqId ? { reqId } : {}) };
}

/** The page's notices (`#confirmationMsg`: "… uploaded successfully"), split by whether they're errors. */
function notices(doc: Document, errors: boolean): string[] {
  const box = doc.querySelector(SEL.notices);
  if (!box || !shown(box)) return [];
  const t = text(box);
  if (!t) return [];
  const isError = Boolean(box.querySelector("[class*='error' i], [class*='Error']"));
  return isError === errors ? [t.slice(0, 300)] : [];
}

/** Field errors, with the field's prompt where the message doesn't name it, and the page's error notices. */
function errors(doc: Document): string[] {
  const out = new Set<string>();
  for (const spot of fields(doc)) {
    if (spot.error) out.add(spot.error.includes(spot.label) ? spot.error : `${spot.label}: ${spot.error}`);
  }
  for (const t of notices(doc, true)) out.add(t);
  return [...out];
}

/** The page's own text, without its notes (the welcome above the form thanks the candidate for their interest). */
function mainText(doc: Document): string {
  const main = doc.querySelector(SEL.main) ?? doc.body;
  const notes = [...main.querySelectorAll("[role='note']")].map((n) => n.textContent ?? "");
  let t = main.textContent ?? "";
  for (const n of notes) t = t.replace(n, " ");
  return norm(t).slice(0, 20000);
}

export const successfactors: SiteDefinition = {
  info: siteInfo("successfactors") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: Object.values(WIDGETS),
  fields,
  addButtons,
  rows,
  page: {
    kind: (doc, _url, count) => {
      if (doc.querySelector(SEL.root) && count > 0) return "step";
      const password = [...doc.querySelectorAll("input[type='password']")].some((i) => isVisible(i));
      if (password) return "auth";
      if (CONFIRMATION_TEXT.test(mainText(doc))) return "confirmation";
      return doc.querySelector(SEL.root) ? "step" : "unknown";
    },
    step: (doc) => singleStep(job(doc)?.title ?? ""),
    job,
    stepKey: (_doc, url) => url,
    errors,
    messages: (doc) => notices(doc, false),
    actions: () => [],
    actionButton: () => null,
    next: (doc) => [...doc.querySelectorAll<HTMLElement>(SEL.submit)].find(shown) ?? null,
    back: () => null,
    label: (b) => plain(b) || b.getAttribute("aria-label") || "",
    isSubmit,
  },
  repeat: {
    noun: "row",
    // An Add makes more fields; a Remove fewer rows (no dialog: the row goes at once, read from the page's script).
    added: (doc) => doc.querySelector(SEL.root)?.querySelectorAll(SEL.field).length ?? 0,
    removed: (doc) => doc.querySelector(SEL.root)?.querySelectorAll(SEL.rowNumber).length ?? 0,
    deleteButton: async (row) =>
      row.button?.isConnected
        ? row.button
        : (row.el.querySelector<HTMLElement>(`${SEL.deleteIcon} [role='button']`) ?? null),
    confirmRemoval: async () => {},
  },
  // A list can wait for the one above it (Province/ State after Country), so fills go in page order.
  fill: { order: "page" },
  waits: standardWaits,
  messages: {
    noNextButton: "No Apply button found.",
    noBackButton: "This application is one page: there is no earlier step.",
    submitIsNext: () =>
      "The only way forward is Apply, which submits the application: the whole application is on this page. The user reviews it and presses Apply.",
    refuseNext: (kind) => (kind === "confirmation" ? "The application was already submitted." : undefined),
    noSearch: "search_options applies to lists.",
    cantRemove: (kind) =>
      `remove_items works on documents; this is a ${kind} field. Use fill_fields to change it, or remove_repeatable for a row.`,
  },
};
