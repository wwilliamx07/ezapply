import { cleanLabel, isVisible, norm, slug, text } from "@ezapply/engine/dom";
import type { AddButtonSpot, FieldSpot, RowSpot, SectionSpot, WidgetDriver } from "@ezapply/engine/types";
import type { FieldKind, FormSchema, PageAction, PageKind } from "@ezapply/protocol";
import { hintKey, PROFILE_HINTS, SEL } from "./selectors.js";

/**
 * Where things are on a Workday page: its fields and their prompts, sections, rows, add buttons, the page kind,
 * the step, errors, and the buttons. The engine (`@ezapply/engine`) reads the page through these; `widgets.ts`
 * says how each kind of field reads and fills.
 */

const SUBMIT_TEXT = /^\s*submit(\s+application)?\s*$/i;

// ---- page level ---------------------------------------------------------------------------------

export function nextButton(doc: Document): HTMLElement | null {
  const byId = [...doc.querySelectorAll<HTMLElement>(SEL.nextButton)].find(isVisible);
  if (byId) return byId;
  const nav = [...doc.querySelectorAll<HTMLElement>("button")].filter(
    (b) => isVisible(b) && /^(next|save and continue|continue|submit)$/i.test(text(b)),
  );
  return nav.at(-1) ?? null;
}

/** The button back to the previous step: by automation id, else a visible button reading Back or Previous. */
export function backButton(doc: Document): HTMLElement | null {
  const byId = [...doc.querySelectorAll<HTMLElement>(SEL.backButton)].find(isVisible);
  if (byId) return byId;
  return (
    [...doc.querySelectorAll<HTMLElement>("button")].find((b) => isVisible(b) && /^(back|previous)$/i.test(text(b))) ??
    null
  );
}

export function isSubmitControl(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  const label = norm(
    `${text(control)} ${control.getAttribute("aria-label") ?? ""} ${(control as HTMLInputElement).value ?? ""}`,
  );
  const auto = control.getAttribute("data-automation-id") ?? "";
  if (SUBMIT_TEXT.test(text(control)) || /^submit\b/i.test(label)) return true;
  // The forward button on the review step submits the application whatever its label. The footer's Back
  // (`pageFooterBackButton`, seen live) is in the footer too, and isn't it.
  return /next|footer/i.test(auto) && !/back|previous/i.test(auto) && isReviewStep(control.ownerDocument);
}

function isReviewStep(doc: Document): boolean {
  const active = text(doc.querySelector(SEL.progressActive));
  return /review/i.test(active);
}

export function stepInfo(doc: Document): FormSchema["step"] {
  const bar = doc.querySelector(SEL.progressBar);
  if (!bar) return undefined;
  const steps = [...doc.querySelectorAll(SEL.progressStep)];
  const active = doc.querySelector(SEL.progressActive);
  const activeLi = active?.closest("li") ?? active;
  const index = activeLi ? steps.indexOf(activeLi as Element) : -1;
  const title = cleanStepTitle(text(active)) || "Application";
  return {
    title,
    ...(index >= 0 ? { index: index + 1 } : {}),
    ...(steps.length ? { total: steps.length } : {}),
  };
}

function cleanStepTitle(s: string): string {
  return s
    .replace(/current step \d+ of \d+/i, "")
    .replace(/step \d+ of \d+/i, "")
    .trim();
}

/**
 * A notice in an alert region that isn't an error. Live Workday announces "resume.pdf successfully uploaded" in
 * the same `role="alert"` region as validation errors; counted as an error it ended go_next's wait at once.
 */
export function isNotice(t: string): boolean {
  return /\bsuccess(fully)?\b/i.test(t) && !/\b(fail|error|could not|unable|invalid|required)/i.test(t);
}

function alerts(doc: Document): string[] {
  const out = new Set<string>();
  for (const el of doc.querySelectorAll(SEL.errors)) {
    const t = text(el);
    if (t && isVisible(el)) out.add(t.slice(0, 300));
  }
  return [...out];
}

export function pageErrors(doc: Document): string[] {
  return alerts(doc).filter((t) => !isNotice(t));
}

/** Notices shown in alert regions (see isNotice). */
export function pageMessages(doc: Document): string[] {
  return alerts(doc).filter(isNotice);
}

export function pageActions(doc: Document): PageAction[] {
  const actions: PageAction[] = [];
  if (doc.querySelector(SEL.applyButton)) actions.push("apply");
  if (doc.querySelector(SEL.applyManually)) actions.push("apply_manually");
  if (doc.querySelector(SEL.autofillWithResume)) actions.push("autofill_with_resume");
  if (doc.querySelector(SEL.useLastApplication)) actions.push("use_last_application");
  return actions;
}

export function detectPage(doc: Document, fieldCount: number): PageKind {
  const hasProgress = Boolean(doc.querySelector(SEL.progressBar));
  const bodyText = norm(doc.body.textContent).slice(0, 20000);
  if (
    doc.querySelector(SEL.confirmation) ||
    (!hasProgress &&
      fieldCount === 0 &&
      /application (has been |was )?(successfully )?submitted|thank you for (applying|your application)/i.test(
        bodyText,
      ))
  ) {
    return "confirmation";
  }
  // The sign-in page is step 1 of the apply flow, so it has a progress bar too.
  const password = [...doc.querySelectorAll('input[type="password"]')].some(isVisible);
  const authStep = /sign in|create account/i.test(text(doc.querySelector(SEL.progressActive)));
  if (password || authStep || doc.querySelector(SEL.auth)) return "auth";
  if (doc.querySelector(SEL.applyManually) || doc.querySelector(SEL.autofillWithResume)) return "start-choice";
  if (hasProgress) {
    const next = nextButton(doc);
    if ((next && SUBMIT_TEXT.test(text(next))) || isReviewStep(doc)) return "review";
    return "step";
  }
  if (fieldCount > 0) return "step";
  if (doc.querySelector(SEL.postingHeader) || doc.querySelector(SEL.applyButton)) return "posting";
  return "unknown";
}

// ---- fields -------------------------------------------------------------------------------------

/** Field containers: each `formField-*` on screen, not one nested in another (composite widgets). */
const containers = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>(SEL.fieldContainer)].filter(
    (c) => isVisible(c) && !c.parentElement?.closest(SEL.fieldContainer),
  );

/** Every field on the page: its container, kind (the first of `widgets` that recognises it) and prompt. */
export function workdayFields(doc: Document, widgets: readonly WidgetDriver[]): FieldSpot[] {
  const out: FieldSpot[] = [];
  for (const container of containers(doc)) {
    const driver = widgets.find((w) => w.is(container));
    if (!driver) continue;
    const automationId = container.getAttribute("data-automation-id") ?? undefined;
    const label = fieldLabel(container, driver.kind);
    const help = text(container.querySelector(SEL.helpText));
    const error = fieldError(container);
    const hint = automationId ? PROFILE_HINTS[hintKey(automationId)] : undefined;
    out.push({
      container,
      driver,
      // A bare "formField-" (seen live on the Resume/CV field) gives no key: use the label.
      key: automationId?.replace(/^formField-/, "") || slug(label),
      label,
      section: sectionTitleOf(container),
      required: isRequired(container),
      ...(automationId ? { automationId } : {}),
      ...(help && help !== label ? { help: help.slice(0, 500) } : {}),
      ...(error ? { error } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}

/** How many field containers the page has, shown or not: an added row adds some, a removed one takes some away. */
export function fieldContainerCount(doc: Document): number {
  return doc.querySelectorAll(SEL.fieldContainer).length;
}

/** Each section whose first field sits in a row with its own Delete button. */
export function workdayRows(_doc: Document, sections: ReadonlyMap<string, SectionSpot>): RowSpot[] {
  const out: RowSpot[] = [];
  for (const [sectionId, { title, first }] of sections) {
    const found = rowOf(first, sectionId, title);
    if (found) out.push({ sectionId, title: found.title, el: found.row, button: found.button });
  }
  return out;
}

/**
 * Live Workday labels every add button "Add" (or "Add Another" once a row exists), so each is named by the
 * section heading above it: add.work-experience, add.websites.
 */
export function workdayAddButtons(doc: Document): AddButtonSpot[] {
  const out: AddButtonSpot[] = [];
  for (const b of doc.querySelectorAll<HTMLElement>(SEL.addButton)) {
    if (!isVisible(b)) continue;
    const label = norm(b.getAttribute("aria-label")) || text(b) || "Add";
    const section = addButtonSection(b);
    out.push({
      el: b,
      key: `add.${slug(section ?? label)}`,
      label: norm(b.getAttribute("aria-label")) || text(b),
      ...(section ? { section } : {}),
      kind: "row",
    });
  }
  return out;
}

const HEADING = "h1,h2,h3,h4,h5,legend,[role='heading']";

/**
 * The section an add button belongs to: the last heading before it in the page, outside any field, with a row
 * number dropped ("Work Experience 2" → "Work Experience"). None when that is the step's own title.
 */
function addButtonSection(b: HTMLElement): string | undefined {
  const doc = b.ownerDocument;
  const before = [...doc.querySelectorAll<HTMLElement>(HEADING)].filter(
    (h) =>
      Boolean(h.compareDocumentPosition(b) & 4 /* FOLLOWING */) &&
      !h.closest(SEL.fieldContainer) &&
      !h.closest(SEL.progressBar) &&
      isVisible(h),
  );
  const title = norm(text(before.at(-1)).replace(/\s+\d+$/, ""));
  const stepTitle = stepInfo(doc)?.title;
  return title && title !== stepTitle ? title.slice(0, 80) : undefined;
}

/**
 * The repeatable row a section's fields sit in: the nearest ancestor of its first field that holds a
 * row-delete button of its own (not one inside a field, like a file's delete) and no field of another
 * section. Rows and their delete buttons are best knowledge of Workday's markup, unverified on a live
 * tenant (they sit behind sign-in).
 */
function rowOf(
  container: HTMLElement,
  sectionId: string,
  title: string,
): { title: string; row: HTMLElement; button: HTMLElement } | undefined {
  const doc = container.ownerDocument;
  for (let el = container.parentElement; el && el !== doc.body; el = el.parentElement) {
    const inside = [...el.querySelectorAll<HTMLElement>(SEL.fieldContainer)];
    if (inside.some((c) => slug(sectionTitleOf(c)) !== sectionId)) return undefined;
    const button = [...el.querySelectorAll<HTMLElement>(SEL.rowDelete)].find(
      (b) => isVisible(b) && !b.closest(SEL.fieldContainer) && !isSubmitControl(b),
    );
    if (button) return { title, row: el, button };
  }
  return undefined;
}

function fieldLabel(c: HTMLElement, kind: FieldKind): string {
  const legend = c.querySelector("legend");
  if (legend && (kind === "radio" || kind === "checkbox-group" || kind === "date")) return cleanLabel(text(legend));
  const label = c.querySelector("label");
  if (label && kind !== "checkbox") return cleanLabel(text(label));
  const control = c.querySelector("input, textarea, button");
  const labelledBy = control?.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => c.ownerDocument.getElementById(id))
      .filter((e): e is HTMLElement => e !== null)
      .map(text);
    if (parts.length) return cleanLabel(parts.join(" "));
  }
  if (legend) return cleanLabel(text(legend));
  if (label) return cleanLabel(text(label));
  const aria = control?.getAttribute("aria-label");
  if (aria) return cleanLabel(aria);
  return cleanLabel(text(c).slice(0, 200)) || (c.getAttribute("data-automation-id") ?? "field");
}

function isRequired(c: HTMLElement): boolean {
  if (c.querySelector('[aria-required="true"], [required]')) return true;
  const label = c.querySelector("label, legend");
  return Boolean(label && /\*\s*$/.test(norm(label.textContent)));
}

function sectionTitleOf(c: HTMLElement): string {
  let el: HTMLElement | null = c.parentElement;
  while (el && el !== c.ownerDocument.body) {
    const heading = [...el.children].find((ch) => /^(H2|H3|H4|LEGEND)$/.test(ch.tagName)) as HTMLElement | undefined;
    if (heading && !heading.contains(c)) return text(heading).slice(0, 80);
    if (el.getAttribute("role") === "group") {
      const labelledBy = el.getAttribute("aria-labelledby");
      const lab = labelledBy ? c.ownerDocument.getElementById(labelledBy) : null;
      if (lab) return text(lab).slice(0, 80);
    }
    el = el.parentElement;
  }
  return "Main";
}

export function fieldError(c: HTMLElement): string | undefined {
  const err = [...c.querySelectorAll(SEL.errors)].map(text).find((t) => t && !isNotice(t));
  if (err) return err.slice(0, 300);
  const invalid = c.querySelector('[aria-invalid="true"]');
  const describedBy = invalid?.getAttribute("aria-describedby");
  if (describedBy) {
    const t = describedBy
      .split(/\s+/)
      .map((id) => text(c.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (t) return t.slice(0, 300);
  }
  return undefined;
}
