import type { Field, FieldKind, FormSchema, PageAction, PageKind } from "@ezapply/protocol";
import { oracleTenant } from "@ezapply/protocol/oracle";
import { cleanLabel, cssEscape, isVisible, norm, slug, text } from "../common/dom.js";
import { hintFor, SEL, TEXT } from "./selectors.js";

export type PageSchema = Omit<FormSchema, "tabId">;

export interface FieldRef {
  field: Field;
  container: HTMLElement;
}

/** A saved repeatable item (a language tile, a work or education entry on the timeline). */
export interface ItemRef {
  title: string;
  el: HTMLElement;
  kind: "tile" | "timeline";
}

export interface Extraction {
  schema: PageSchema;
  fields: Map<string, FieldRef>;
  /** Add buttons and the Save buttons of open inline forms, by id. */
  addButtons: Map<string, HTMLElement>;
  /** Saved items that can be deleted, by section id. */
  rows: Map<string, ItemRef>;
}

// ---- page level ---------------------------------------------------------------------------------

const visibleButtons = (scope: ParentNode) =>
  [...scope.querySelectorAll<HTMLElement>("button, [role='button'], a, input[type='submit']")].filter(isVisible);

const labelOf = (b: Element) =>
  norm(`${text(b) || b.getAttribute("aria-label") || b.getAttribute("title") || (b as HTMLInputElement).value || ""}`);

const enabled = (b: HTMLElement) => !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true";

export function isSubmitControl(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  if (control.matches(SEL.submitButton)) return true;
  const label = norm(
    `${text(control)} ${control.getAttribute("aria-label") ?? ""} ${(control as HTMLInputElement).value ?? ""}`,
  );
  return TEXT.submit.test(text(control)) || /^submit\b/i.test(label);
}

/** The forward button: the flow's Next, or the Next of the email step. Submit when that's all there is. */
export function nextButton(doc: Document): HTMLElement | null {
  const byQa = [...doc.querySelectorAll<HTMLElement>(SEL.nextButton)].find(isVisible);
  if (byQa) return byQa;
  const nav = [...doc.querySelectorAll<HTMLElement>(SEL.pagination)].flatMap((p) => visibleButtons(p));
  return (
    nav.find((b) => TEXT.next.test(labelOf(b))) ??
    [...doc.querySelectorAll<HTMLElement>(SEL.submitButton)].find(isVisible) ??
    nav.find((b) => isSubmitControl(b)) ??
    null
  );
}

/** The flow's Previous button (multi-page flow, from the second section). */
export function backButton(doc: Document): HTMLElement | null {
  const nav = [...doc.querySelectorAll<HTMLElement>(SEL.pagination)].flatMap((p) => visibleButtons(p));
  return nav.find((b) => enabled(b) && TEXT.back.test(labelOf(b))) ?? null;
}

/**
 * The flow's sections on screen. The pre-section ("Import your profile": LinkedIn and Indeed import, no
 * fields of ours) is left out.
 */
const visibleSections = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>(SEL.section)].filter((s) => isVisible(s) && !s.closest(SEL.preSection));

/**
 * The step: the one section on screen in the multi-page flow (its title, and "step 2 of 4" from the flow's hidden
 * heading), or, in the single-page flow, all sections at once (their titles joined, no index).
 */
export function stepInfo(doc: Document): FormSchema["step"] {
  const sections = visibleSections(doc);
  if (!sections.length) return undefined;
  const titles = sections.map(sectionTitle).filter(Boolean);
  if (sections.length > 1) return { title: titles.join(" · ") || "Application" };
  const m = /step (\d+) of (\d+)/i.exec(text(doc.querySelector(SEL.flowHeading)));
  return {
    title: titles[0] || "Application",
    ...(m ? { index: Number(m[1]), total: Number(m[2]) } : {}),
  };
}

/** A section's title: its own heading (single-page flow), else the titles of its blocks. */
function sectionTitle(section: HTMLElement): string {
  const own = text(section.querySelector(SEL.sectionTitle));
  if (own) return own;
  return [...section.querySelectorAll(SEL.blockTitle)]
    .filter(isVisible)
    .map(text)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

/** Messages in alert regions that report progress or success, not a problem. */
export function isNotice(t: string): boolean {
  return (
    // "Saved" is announced after an inline item is saved (seen live).
    /^(done|saved|uploading\.*)$/i.test(t) ||
    (/\bsuccess(fully)?\b/i.test(t) && !/\b(fail|error|could not|unable|invalid|required)/i.test(t))
  );
}

function alerts(doc: Document): { text: string; progress: boolean }[] {
  const seen = new Set<string>();
  const out: { text: string; progress: boolean }[] = [];
  for (const el of doc.querySelectorAll(SEL.errors)) {
    const t = text(el);
    // A dialog wrapper is an alert region whose (closed) dialog is hidden inside it.
    const shown = isVisible(el) && (el.children.length === 0 || [...el.children].some(isVisible));
    if (!t || seen.has(t) || !shown) continue;
    seen.add(t);
    out.push({ text: t.slice(0, 300), progress: Boolean(el.closest(SEL.progressAlert)) });
  }
  return out;
}

export function pageErrors(doc: Document): string[] {
  return alerts(doc)
    .filter((a) => !a.progress && !isNotice(a.text))
    .map((a) => a.text);
}

export function pageMessages(doc: Document): string[] {
  return alerts(doc)
    .filter((a) => a.progress || isNotice(a.text))
    .map((a) => a.text);
}

/** The visible button for a page action, if any. */
export function actionButton(doc: Document, action: PageAction): HTMLElement | null {
  if (action === "use_last_application") {
    const overlay = [...doc.querySelectorAll<HTMLElement>(SEL.profileChoice)].find(isVisible);
    return overlay ? (visibleButtons(overlay).find((b) => TEXT.useMyProfile.test(labelOf(b))) ?? null) : null;
  }
  if (action === "apply") {
    if (inFlow(doc)) return null;
    return visibleButtons(doc).find((b) => TEXT.apply.test(labelOf(b)) && !isSubmitControl(b)) ?? null;
  }
  return null;
}

export function pageActions(doc: Document): PageAction[] {
  return (["apply", "use_last_application"] as const).filter((a) => actionButton(doc, a));
}

const inFlow = (doc: Document) => visibleSections(doc).length > 0;

export function detectPage(doc: Document, url: string, fieldCount: number): PageKind {
  const bodyText = norm(doc.body.textContent).slice(0, 20000);
  if (!inFlow(doc) && fieldCount === 0 && (/\/thank-you(\/|$|\?)/i.test(url) || TEXT.confirmation.test(bodyText))) {
    return "confirmation";
  }
  const password = [...doc.querySelectorAll('input[type="password"]')].some(isVisible);
  const auth = [...doc.querySelectorAll(SEL.auth)].some(isVisible);
  if (password || auth || /\/apply\/email(\/|$|\?)/i.test(url)) return "auth";
  if (actionButton(doc, "use_last_application")) return "start-choice";
  if (inFlow(doc) || fieldCount > 0) return "step";
  if (actionButton(doc, "apply")) return "posting";
  return "unknown";
}

// ---- fields -------------------------------------------------------------------------------------

interface Candidate {
  container: HTMLElement;
  kind: FieldKind;
  /** Where the id comes from: the control's id without its render counter, or the label. */
  key: string;
  label: string;
  required: boolean;
  /** The row whose label, help text and error describe the field. */
  row: HTMLElement;
}

/** An id without Knockout's render counter (`lastName-39` → `lastName`), which changes when the form re-renders. */
const stripCounter = (id: string) => id.replace(/-label$/, "").replace(/-\d+$/, "");

function rowLabel(row: HTMLElement): string {
  const label = row.querySelector<HTMLElement>(SEL.rowLabel);
  const t = label?.querySelector(SEL.rowLabelText) ?? label;
  if (t && text(t)) return cleanLabel(text(t).replace(/\*$/, ""));
  const aria =
    row.querySelector("[aria-label]:not(button)")?.getAttribute("aria-label") ??
    row.querySelector("ul[aria-label]")?.getAttribute("aria-label");
  return cleanLabel(aria ?? "");
}

function rowKey(row: HTMLElement): string {
  const label = row.querySelector<HTMLElement>(SEL.rowLabel);
  const qa = row.querySelector("[data-qa]")?.getAttribute("data-qa");
  const control = row.querySelector<HTMLElement>("input:not([type='radio']), textarea");
  return stripCounter(
    label?.getAttribute("for") || label?.id || qa || control?.id || control?.getAttribute("name") || "",
  );
}

function rowRequired(row: HTMLElement): boolean {
  if (row.querySelector(SEL.requiredLabel)) return true;
  return Boolean(row.querySelector('input[aria-required="true"], textarea[aria-required="true"], [required]'));
}

function rowKind(row: HTMLElement): FieldKind | null {
  if (row.matches(SEL.dateRow) || row.querySelector(SEL.datePart)) return "date";
  const pills = row.querySelector(SEL.pills);
  if (pills) return pills.querySelector(SEL.pillMultiIcon) ? "checkbox-group" : "radio";
  if (row.querySelector('input[type="radio"]')) return "radio";
  if (row.querySelector(SEL.comboInput)) return "dropdown";
  // Before the text check: these hold text inputs that typing alone doesn't fill.
  if (row.querySelector(SEL.unsupported)) return "typeahead";
  const boxes = row.querySelectorAll('input[type="checkbox"]');
  if (boxes.length > 1) return "checkbox-group";
  if (boxes.length === 1) return "checkbox";
  if (row.querySelector("textarea:not([tabindex='-1'])")) return "textarea";
  if (row.querySelector('input[type="password"]')) return "password";
  if (row.querySelector('input[type="number"]')) return "number";
  if (
    row.querySelector(
      "input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='url']",
    )
  ) {
    return "text";
  }
  return null;
}

function checkboxLabel(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const label =
    (input.id ? doc.querySelector(`label[for="${cssEscape(input.id)}"]`) : null) ??
    input.closest("label") ??
    input.parentElement?.querySelector(SEL.checkboxLabel);
  const t = label?.querySelector(SEL.checkboxText) ?? label;
  return cleanLabel(text(t) || input.getAttribute("aria-label") || "");
}

/** The name of a file field: "Drop Resume Here" → "Resume", "Upload Cover Letter" → "Cover Letter". */
function uploadLabel(upload: HTMLElement): string {
  const drop = text(upload.querySelector(SEL.uploadDropLabel))
    .replace(/^drop\s+/i, "")
    .replace(/\s+here$/i, "");
  const button = text(upload.querySelector(SEL.uploadButtonLabel)).replace(/^upload\s+/i, "");
  const tag = upload.closest("resume-upload-button")
    ? "Resume"
    : upload.closest("cover-letter-upload-button")
      ? "Cover Letter"
      : "";
  const name = tag || drop || button || "Attachment";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Every field on the page, in document order. */
function candidates(doc: Document): Candidate[] {
  const out: Candidate[] = [];
  const rows = [...doc.querySelectorAll<HTMLElement>(SEL.row)].filter(
    (r) => !r.querySelector(SEL.row) && isVisible(r) && !r.matches(SEL.botTrap) && !r.querySelector(SEL.botTrap),
  );
  for (const row of rows) {
    const label = rowLabel(row);
    const required = rowRequired(row);
    const phone = row.querySelector<HTMLElement>(SEL.phoneRow);
    if (phone) {
      const prefix = phone.querySelector<HTMLElement>(SEL.phonePrefix);
      const number = phone.querySelector<HTMLElement>(SEL.phoneNumber);
      if (prefix)
        out.push({
          container: prefix,
          kind: "dropdown",
          key: "phoneCountryCode",
          label: `${label}: country code`,
          required,
          row,
        });
      if (number) out.push({ container: number, kind: "text", key: "phoneNumber", label, required, row });
      continue;
    }
    const kind = rowKind(row);
    if (!kind) continue;
    if (kind === "checkbox") {
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
      const boxLabel = checkboxLabel(box);
      out.push({
        container: row,
        kind,
        key: stripCounter(box.id) || slug(boxLabel),
        label: boxLabel || label,
        required,
        row,
      });
      continue;
    }
    out.push({ container: row, kind, key: rowKey(row), label, required, row });
  }
  // Agreement checkboxes that sit in no form row (job alerts).
  for (const box of doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (box.closest(SEL.row)) continue;
    const container = (box.closest("label")?.parentElement ?? box.parentElement) as HTMLElement | null;
    const label = checkboxLabel(box);
    const shown = box.id ? doc.querySelector(`label[for="${cssEscape(box.id)}"]`) : box.closest("label");
    if (!container || !label || !isVisible(shown ?? container)) continue;
    const required = Boolean(box.required || box.getAttribute("aria-required") === "true");
    out.push({
      container,
      kind: "checkbox",
      key: stripCounter(box.id) || slug(label),
      label,
      required,
      row: container,
    });
  }
  // Attachments: the resume and cover letter buttons, and the additional documents block.
  for (const upload of doc.querySelectorAll<HTMLElement>(SEL.upload)) {
    if (!isVisible(upload)) continue;
    const container = (upload.closest(SEL.miscBlock)?.querySelector(".apply-flow-block__form-list") ??
      upload.closest(SEL.uploadSection) ??
      upload.parentElement) as HTMLElement | null;
    if (!container || out.some((c) => c.container === container)) continue;
    const label = uploadLabel(upload);
    const input = upload.querySelector<HTMLInputElement>('input[type="file"]');
    const required = Boolean(
      upload.querySelector(SEL.uploadRequired) || input?.getAttribute("aria-required") === "true",
    );
    out.push({ container, kind: "file", key: slug(label), label, required, row: container });
  }
  return out.sort((a, b) => (a.container.compareDocumentPosition(b.container) & 4 ? -1 : 1));
}

/** The block a field sits in ("Contact Information", "Application Questions"), else its section or the page. */
function blockTitle(el: HTMLElement): string {
  const block = el.closest<HTMLElement>(SEL.block);
  const title = text(block?.querySelector(SEL.blockTitle));
  if (title) return title.slice(0, 80);
  const section = el.closest<HTMLElement>(SEL.section);
  return (section ? sectionTitle(section) : "").slice(0, 80) || "Main";
}

function helpText(row: HTMLElement, label: string): string | undefined {
  const ids = row.querySelector(SEL.rowLabel)?.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
  const help = ids
    .filter((id) => id.startsWith("instructionsText-"))
    .map((id) => text(row.ownerDocument.getElementById(id)))
    .filter(Boolean)
    .join(" ");
  return help && help !== label ? help.slice(0, 500) : undefined;
}

export function fieldError(row: HTMLElement): string | undefined {
  const own = [...row.querySelectorAll(SEL.rowError)].map(text).find(Boolean);
  if (own) return own.slice(0, 300);
  const invalid = row.querySelector('[aria-invalid="true"]');
  const describedBy = invalid?.getAttribute("aria-describedby");
  if (describedBy) {
    const t = describedBy
      .split(/\s+/)
      .map((id) => text(row.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (t) return t.slice(0, 300);
  }
  return undefined;
}

export function extract(doc: Document, url: string): Extraction {
  const fields = new Map<string, FieldRef>();
  const sections = new Map<string, { id: string; title: string; fields: Field[]; removable?: boolean }>();
  const repeats = new Map<string, number>();

  for (const c of candidates(doc)) {
    const sectionTitle = blockTitle(c.container);
    const sectionId = slug(sectionTitle);
    // Screening questions are keyed by long numbers; their label reads better and is as stable.
    const base = !c.key || /^\d/.test(c.key) ? slug(c.label).slice(0, 40) : c.key;
    let id = `${sectionId}.${base}`;
    const seen = repeats.get(id) ?? 0;
    repeats.set(id, seen + 1);
    if (seen > 0) id = `${id}#${seen + 1}`;

    const field: Field = {
      id,
      label: c.label || base,
      required: c.required,
      kind: c.kind,
      currentValue: currentValue(c.container, c.kind),
    };
    const help = helpText(c.row, c.label);
    const readOnly = c.kind === "text" && c.container.querySelector("input[readonly]");
    if (readOnly) field.helpText = [help, "Read-only on this page."].filter(Boolean).join(" ");
    else if (help) field.helpText = help;
    const options = knownOptions(c.container, c.kind);
    if (options) field.options = options;
    if (c.kind === "dropdown") field.optionsLazy = true;
    if (c.kind === "date") field.dateParts = dateParts(c.container);
    if (c.kind === "file") field.multiple = Boolean(c.container.closest(SEL.miscBlock));
    if (c.kind === "checkbox-group") field.multiple = true;
    const error = fieldError(c.row);
    if (error) field.error = error;
    const hint = hintFor(c.key);
    if (hint) field.hint = { profileKey: hint };

    fields.set(id, { field, container: c.container });
    const section = sections.get(sectionId) ?? { id: sectionId, title: sectionTitle, fields: [] };
    section.fields.push(field);
    sections.set(sectionId, section);
  }

  // Saved items (a language, a license, a work or education entry) are summaries, not fields: each is a
  // section of its own, removable when it has a delete control.
  const rows = new Map<string, ItemRef>();
  for (const item of savedItems(doc)) {
    const blockId = slug(blockTitle(item.el));
    let id = `${blockId}.${item.kind === "timeline" ? timelineColumn(item.el) : "item"}-1`;
    for (let n = 2; rows.has(id) || sections.has(id); n++) id = id.replace(/-\d+$/, `-${n}`);
    rows.set(id, item);
    sections.set(id, { id, title: `${blockTitle(item.el)}: ${item.title}`, fields: [], removable: true });
  }

  const addButtons = new Map<string, HTMLElement>();
  const addInfo: { id: string; label: string; section?: string }[] = [];
  for (const b of doc.querySelectorAll<HTMLElement>(SEL.addButton)) {
    if (!isVisible(b) || !enabled(b) || b.classList.contains(SEL.addButtonHidden)) continue;
    const label = labelOf(b) || "Add";
    const key = slug(label.replace(/^add\s+(another\s+)?/i, "")) || slug(blockTitle(b));
    let id = `add.${key}`;
    for (let n = 2; addButtons.has(id); n++) id = `add.${key}#${n}`;
    addButtons.set(id, b);
    addInfo.push({ id, label, section: blockTitle(b) });
  }
  // An open inline form is added by its Save button: offered like an add button, named after its block.
  for (const b of doc.querySelectorAll<HTMLElement>(SEL.inlineSave)) {
    if (!isVisible(b)) continue;
    const section = blockTitle(b);
    let id = `save.${slug(section)}`;
    for (let n = 2; addButtons.has(id); n++) id = `save.${slug(section)}#${n}`;
    addButtons.set(id, b);
    addInfo.push({ id, label: labelOf(b) || "Save", section });
  }

  const next = nextButton(doc);
  const back = backButton(doc);
  const step = stepInfo(doc);
  const messages = pageMessages(doc);
  const tenant = oracleTenant(url);
  const schema: PageSchema = {
    adapter: "oracle",
    url,
    ...(tenant ? { tenant } : {}),
    pageKind: detectPage(doc, url, fields.size),
    ...(step ? { step } : {}),
    sections: [...sections.values()],
    addButtons: addInfo,
    actions: pageActions(doc),
    errors: pageErrors(doc),
    ...(messages.length ? { messages } : {}),
    ...(next ? { nextLabel: labelOf(next) } : {}),
    ...(back ? { backLabel: labelOf(back) } : {}),
  };
  return { schema, fields, addButtons, rows };
}

function timelineColumn(el: HTMLElement): string {
  return el.closest(SEL.timelineExperiences) ? "experience" : "education";
}

/** Saved tiles with a delete button, and every timeline entry (its delete button shows on hover). */
export function savedItems(doc: Document): ItemRef[] {
  const tiles = [...doc.querySelectorAll<HTMLElement>(SEL.tile)]
    .filter((t) => isVisible(t) && t.querySelector(SEL.tileDelete))
    .map((el) => ({
      el,
      kind: "tile" as const,
      title: [text(el.querySelector(SEL.tileTitle)), text(el.querySelector(SEL.tileSubtitle))]
        .filter(Boolean)
        .join(", ")
        .slice(0, 120),
    }));
  const timeline = [...doc.querySelectorAll<HTMLElement>(SEL.timelineItem)].filter(isVisible).map((el) => ({
    el,
    kind: "timeline" as const,
    title: [text(el.querySelector(SEL.timelineTitle)), text(el.querySelector(SEL.timelineSubtitle))]
      .filter(Boolean)
      .join(", ")
      .slice(0, 120),
  }));
  return [...tiles, ...timeline];
}

// ---- values -------------------------------------------------------------------------------------

export const pillButtons = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(SEL.pill)];
export const pillLabel = (b: HTMLElement) => text(b.querySelector(SEL.pillName) ?? b);
export const pillPressed = (b: HTMLElement) =>
  b.getAttribute("aria-pressed") === "true" || b.classList.contains("cx-select-pill-section--selected");

export function radioLabel(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const byLabelledBy = input
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => text(doc.getElementById(id)))
    .find(Boolean);
  const byFor = input.id ? text(doc.querySelector(`label[for="${cssEscape(input.id)}"]`)) : "";
  return cleanLabel(byLabelledBy || byFor || input.getAttribute("aria-label") || input.value);
}

export const isChecked = (i: HTMLInputElement) => i.checked || i.getAttribute("aria-checked") === "true";

export function comboInput(c: HTMLElement): HTMLInputElement | null {
  return c.querySelector<HTMLInputElement>(SEL.comboInput);
}

/** The files a file field holds, once each. */
export function attachedFiles(c: HTMLElement): { name: string; row: HTMLElement }[] {
  return [...c.querySelectorAll<HTMLElement>(SEL.fileName)]
    .map((n) => ({ name: text(n), row: n.closest<HTMLElement>(SEL.fileRow) ?? n }))
    .filter((f) => f.name);
}

/** The date parts a date row has, in its own order (month, day, year). */
export function datePartInputs(c: HTMLElement): { part: "MM" | "DD" | "YYYY"; input: HTMLInputElement }[] {
  const out: { part: "MM" | "DD" | "YYYY"; input: HTMLInputElement }[] = [];
  for (const el of c.querySelectorAll<HTMLElement>(SEL.datePart)) {
    const input = comboInput(el) ?? el.querySelector<HTMLInputElement>("input");
    if (!input) continue;
    const cls = el.className;
    const part = /--month/.test(cls) ? "MM" : /--day/.test(cls) ? "DD" : /--year/.test(cls) ? "YYYY" : null;
    if (part) out.push({ part, input });
  }
  return out;
}

function dateParts(c: HTMLElement): ("MM" | "DD" | "YYYY")[] {
  return datePartInputs(c).map((p) => p.part);
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A month as the page shows it ("March", "Mar", "3", "03") → 1–12, or 0 when it isn't one. */
export function monthNumber(s: string): number {
  const v = norm(s).toLowerCase();
  if (/^\d{1,2}$/.test(v)) return Number(v) >= 1 && Number(v) <= 12 ? Number(v) : 0;
  const i = MONTHS.findIndex((m) => v.length >= 3 && m.startsWith(v.replace(/\.$/, "")));
  return i + 1;
}

export function monthNames(m: number): string[] {
  const name = MONTHS[m - 1] ?? "";
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return [cap, cap.slice(0, 3), String(m).padStart(2, "0"), String(m)];
}

/** The date as YYYY, YYYY-MM or YYYY-MM-DD from what its parts show; null when all are empty. */
export function dateValue(c: HTMLElement): string | null {
  const parts = datePartInputs(c);
  const get = (p: "MM" | "DD" | "YYYY") => norm(parts.find((x) => x.part === p)?.input.value);
  const [y, mRaw, d] = [get("YYYY"), get("MM"), get("DD")];
  if (!y && !mRaw && !d) return null;
  const m = mRaw ? String(monthNumber(mRaw) || mRaw) : "";
  return [y, m, d]
    .filter(Boolean)
    .map((v, i) => (i === 0 ? v : v.padStart(2, "0")))
    .join("-");
}

function currentValue(c: HTMLElement, kind: FieldKind): Field["currentValue"] {
  switch (kind) {
    case "text":
    case "number":
    case "textarea":
      return (
        c.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea:not([tabindex='-1']), input")?.value ?? ""
      );
    case "password":
      return c.querySelector<HTMLInputElement>("input")?.value ? "••••" : "";
    case "dropdown": {
      const v = norm(comboInput(c)?.value);
      return v || null;
    }
    case "radio": {
      const pills = pillButtons(c);
      if (pills.length) {
        const on = pills.find(pillPressed);
        return on ? pillLabel(on) : null;
      }
      const checked = [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(isChecked);
      return checked ? radioLabel(checked) : null;
    }
    case "checkbox-group": {
      const pills = pillButtons(c);
      if (pills.length) return pills.filter(pillPressed).map(pillLabel);
      return [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(isChecked).map(checkboxLabel);
    }
    case "checkbox": {
      const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]');
      return Boolean(box && isChecked(box));
    }
    case "date":
      return dateValue(c);
    case "file":
      return attachedFiles(c).map((f) => f.name);
    case "typeahead":
      return [];
  }
}

function knownOptions(c: HTMLElement, kind: FieldKind): string[] | undefined {
  if (kind !== "radio" && kind !== "checkbox-group") return undefined;
  const pills = pillButtons(c);
  if (pills.length) return pills.map(pillLabel);
  if (kind === "radio") return [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(radioLabel);
  return [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(checkboxLabel);
}
