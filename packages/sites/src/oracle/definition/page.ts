import { cleanLabel, cssEscape, isVisible, norm, slug, text } from "@ezapply/engine/dom";
import type { AddButtonSpot, FieldSpot, RowSpot, SectionSpot, WidgetDriver } from "@ezapply/engine/types";
import type { FormSchema, PageAction, PageKind } from "@ezapply/protocol";
import { hintFor, SEL, TEXT } from "./selectors.js";
import type { OracleWidget } from "./widgets.js";

/**
 * Where things are on an Oracle Recruiting Cloud page: its fields and their prompts (form rows, the phone's two
 * halves, agreements, attachments), blocks, saved items, add and Save buttons, the page kind, the step, errors,
 * and the buttons. The engine (`@ezapply/engine`) reads the page through these; `widgets.ts` says how each widget
 * reads and fills.
 */

/** A saved repeatable item (a language tile, a work or education entry on the timeline). */
export interface ItemRef {
  title: string;
  el: HTMLElement;
  kind: "tile" | "timeline";
}

// ---- page level ---------------------------------------------------------------------------------

const visibleButtons = (scope: ParentNode) =>
  [...scope.querySelectorAll<HTMLElement>("button, [role='button'], a, input[type='submit']")].filter(isVisible);

export const labelOf = (b: Element) =>
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

/**
 * The job title, from the flow's hidden heading ("Firmware Engineering Co-op application, step 1 of 4",
 * seen live). Nothing when the heading is worded otherwise (another language): never a guess.
 */
export function jobInfo(doc: Document): FormSchema["job"] {
  const m = /^(.+?)\s+application,\s*step \d+ of \d+$/i.exec(text(doc.querySelector(SEL.flowHeading)));
  return m?.[1] ? { title: m[1].trim() } : undefined;
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
  /** Which of Oracle's widgets it is. */
  widget: OracleWidget;
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

/** The widget a form row holds, by what's in it. */
function rowWidget(row: HTMLElement): OracleWidget | null {
  if (row.matches(SEL.dateRow) || row.querySelector(SEL.datePart)) return "date";
  const pills = row.querySelector(SEL.pills);
  if (pills) return pills.querySelector(SEL.pillMultiIcon) ? "pillsMulti" : "pills";
  if (row.querySelector('input[type="radio"]')) return "radio";
  if (row.querySelector(SEL.comboInput)) return "list";
  // Before the text check: these hold text inputs that typing alone doesn't fill.
  if (row.querySelector(SEL.unsupported)) return "unsupported";
  const boxes = row.querySelectorAll('input[type="checkbox"]');
  if (boxes.length > 1) return "checkboxes";
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

/** An agreement's or a checkbox option's label. */
export function checkboxLabel(input: HTMLInputElement): string {
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
          widget: "list",
          key: "phoneCountryCode",
          label: `${label}: country code`,
          required,
          row,
        });
      if (number) out.push({ container: number, widget: "text", key: "phoneNumber", label, required, row });
      continue;
    }
    const widget = rowWidget(row);
    if (!widget) continue;
    if (widget === "checkbox") {
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
      const boxLabel = checkboxLabel(box);
      out.push({
        container: row,
        widget,
        key: stripCounter(box.id) || slug(boxLabel),
        label: boxLabel || label,
        required,
        row,
      });
      continue;
    }
    out.push({ container: row, widget, key: rowKey(row), label, required, row });
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
      widget: "checkbox",
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
    out.push({ container, widget: "file", key: slug(label), label, required, row: container });
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

/** Every field on the page, in page order, each with the driver for its widget. */
export function oracleFields(doc: Document, widgets: Record<OracleWidget, WidgetDriver>): FieldSpot[] {
  const out: FieldSpot[] = [];
  for (const c of candidates(doc)) {
    const driver = widgets[c.widget];
    // Screening questions are keyed by long numbers; their label reads better and is as stable.
    const key = !c.key || /^\d/.test(c.key) ? slug(c.label).slice(0, 40) : c.key;
    const help = helpText(c.row, c.label);
    const readOnly = c.widget === "text" && c.container.querySelector("input[readonly]");
    const helpShown = readOnly ? [help, "Read-only on this page."].filter(Boolean).join(" ") : help;
    const error = fieldError(c.row);
    const hint = hintFor(c.key);
    out.push({
      container: c.container,
      driver,
      key,
      label: c.label || key,
      section: blockTitle(c.container),
      required: c.required,
      ...(helpShown ? { help: helpShown } : {}),
      ...(error ? { error } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

/** How many form rows are on screen: an add button that opens a form or a link row adds some. */
export function visibleRowCount(doc: Document): number {
  return [...doc.querySelectorAll(SEL.row)].filter(isVisible).length;
}

/**
 * Saved items (a language, a license, a work or education entry) are summaries, not fields: each is a section of
 * its own, removable when it has a delete control (`languages.item-1`, `work-and-education-history.experience-1`).
 */
export function oracleRows(doc: Document, sections: ReadonlyMap<string, SectionSpot>): RowSpot[] {
  const out: RowSpot[] = [];
  const taken = new Set(sections.keys());
  for (const item of savedItems(doc)) {
    const blockId = slug(blockTitle(item.el));
    let id = `${blockId}.${item.kind === "timeline" ? timelineColumn(item.el) : "item"}-1`;
    for (let n = 2; taken.has(id); n++) id = id.replace(/-\d+$/, `-${n}`);
    taken.add(id);
    out.push({
      sectionId: id,
      title: item.title,
      sectionTitle: `${blockTitle(item.el)}: ${item.title}`,
      el: item.el,
      saved: true,
    });
  }
  return out;
}

/** The add buttons, and the Save button of an open inline form, offered like an add button named after its block. */
export function oracleAddButtons(doc: Document): AddButtonSpot[] {
  const out: AddButtonSpot[] = [];
  for (const b of doc.querySelectorAll<HTMLElement>(SEL.addButton)) {
    if (!isVisible(b) || !enabled(b) || b.classList.contains(SEL.addButtonHidden)) continue;
    const label = labelOf(b) || "Add";
    const key = slug(label.replace(/^add\s+(another\s+)?/i, "")) || slug(blockTitle(b));
    // Add Another Link adds a link row at once; the others open an inline form.
    out.push({ el: b, key: `add.${key}`, label, section: blockTitle(b), kind: b.matches(SEL.addRow) ? "row" : "form" });
  }
  for (const b of doc.querySelectorAll<HTMLElement>(SEL.inlineSave)) {
    if (!isVisible(b)) continue;
    const section = blockTitle(b);
    out.push({ el: b, key: `save.${slug(section)}`, label: labelOf(b) || "Save", section, kind: "save" });
  }
  return out;
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
