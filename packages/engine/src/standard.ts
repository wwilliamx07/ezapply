import type { FormSchema, PageKind } from "@ezapply/protocol";
import { cleanLabel, cssEscape, isVisible, norm, settle, text } from "./dom.js";
import { T } from "./timing.js";
import type { SiteWaits } from "./types.js";

/**
 * Helpers for the common case: a site whose form is plain HTML and ARIA, with labels tied to their controls. Site
 * definitions use them where they fit and their own code where they don't.
 */

/** The text of the elements an `aria-labelledby` or `aria-describedby` names, in order. */
export function textOfIds(doc: Document, ids: string | null | undefined): string {
  return (ids ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => text(doc.getElementById(id)))
    .filter(Boolean)
    .join(" ");
}

/**
 * A control's prompt: its `<label for>`, a wrapping label, `aria-labelledby`, `aria-label`, then the legend of its
 * fieldset. Required marks ("*", "✱") are dropped.
 */
export function promptOf(control: Element): string {
  const doc = control.ownerDocument;
  const id = control.getAttribute("id");
  const byFor = id ? doc.querySelector(`label[for="${cssEscape(id)}"]`) : null;
  const candidates = [
    text(byFor),
    textOfIds(doc, control.getAttribute("aria-labelledby")),
    control.getAttribute("aria-label") ?? "",
    text(control.closest("fieldset")?.querySelector("legend")),
  ];
  return cleanLabel(candidates.find((c) => norm(c)) ?? "").replace(/\s*[✱*]\s*$/, "");
}

/** The label of one option of a radio or checkbox group: its `<label for>`, the label around it, or its value. */
export function choiceLabel(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const byFor = input.id ? doc.querySelector(`label[for="${cssEscape(input.id)}"]`) : null;
  return cleanLabel(text(byFor ?? input.closest("label")) || input.getAttribute("aria-label") || input.value);
}

/** The text of the last heading before an element in the page (a section title), or "Main". */
export function headingBefore(el: Element, headings: string, within?: Element | null): string {
  const scope = within ?? el.ownerDocument;
  const before = [...scope.querySelectorAll<HTMLElement>(headings)].filter(
    (h) => Boolean(h.compareDocumentPosition(el) & 4 /* FOLLOWING */) && isVisible(h),
  );
  return norm(text(before.at(-1))).slice(0, 80) || "Main";
}

const SUBMIT = /^\s*(submit|send)(\s+(my\s+)?application)?\s*$/i;

/** A button, link or input that submits an application: `type=submit`, or labelled "Submit (application)". */
export function isSubmitByText(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  if (control.matches("button[type='submit'], input[type='submit']")) return true;
  const label = norm(`${text(control)} ${control.getAttribute("aria-label") ?? ""}`);
  return SUBMIT.test(text(control)) || /^submit\b/i.test(label);
}

/** "Thank you for applying" and its variants, on a page without the form. */
export const CONFIRMATION_TEXT =
  /thank you for (applying|your application|your interest)|application (has been |was )?(successfully )?(submitted|received)|we('ve| have) received your application|you('ve| have) (successfully )?applied/i;

/**
 * The page kind of a single-page application site: the form on screen is the step whose only way on is Submit;
 * without it, a page saying thanks is the confirmation, one with an apply button is the posting.
 */
export function singlePageKind(doc: Document, fieldCount: number, applyButton: Element | null): PageKind {
  if (fieldCount > 0) return "step";
  if (CONFIRMATION_TEXT.test(norm(doc.body.textContent).slice(0, 20000))) return "confirmation";
  if (applyButton) return "posting";
  return "unknown";
}

/** The visible text of the elements matching `selector`, once each (errors, notices). */
export function visibleTexts(doc: Document, selector: string): string[] {
  const out = new Set<string>();
  for (const el of doc.querySelectorAll(selector)) {
    const t = text(el);
    if (t && isVisible(el)) out.add(t.slice(0, 300));
  }
  return [...out];
}

/** A field's error: the element its `aria-errormessage` or `aria-describedby` names, when it's invalid. */
export function ariaError(control: Element | null): string | undefined {
  if (!control) return undefined;
  if (control.getAttribute("aria-invalid") !== "true") return undefined;
  const doc = control.ownerDocument;
  const t =
    textOfIds(doc, control.getAttribute("aria-errormessage")) ||
    textOfIds(doc, control.getAttribute("aria-describedby"));
  return t ? t.slice(0, 300) : undefined;
}

/** The step of a single-page application: one step, titled by the page. */
export function singleStep(title: string): FormSchema["step"] {
  return { title: title || "Application" };
}

/** `FormSchema.job` from the job title a page shows; nothing when it shows none. */
export function titledJob(title: string): FormSchema["job"] {
  const t = title.replace(/\s+/g, " ").trim();
  return t ? { title: t } : undefined;
}

/** The standard waits, for a site whose own aren't different: settle after each thing, for as long as its waits say. */
export const standardWaits: SiteWaits = {
  afterField: (doc) => settle(doc, T.afterFieldQuietMs, T.afterFieldMaxMs),
  afterRow: (doc) => settle(doc, T.rowQuietMs, T.rowMaxMs),
  afterStep: (doc) => settle(doc, T.stepQuietMs, T.stepMaxMs),
  afterAction: (doc) => settle(doc, T.pageActionQuietMs, T.pageActionMaxMs),
};

/** What the engine says on a site whose whole application is one page with Submit at the end. */
export function singlePageMessages(): import("./types.js").Messages {
  return {
    noNextButton: "No Submit button found.",
    noBackButton: "This application is one page: there is no earlier step.",
    submitIsNext: () =>
      "The only way forward is Submit: the whole application is on this page. The user reviews it and presses Submit.",
    refuseNext: (kind) => (kind === "confirmation" ? "The application was already submitted." : undefined),
    noSearch: "search_options applies to lists and search fields.",
    cantRemove: (kind) =>
      `remove_items works on file fields and lists that take several values; this is a ${kind} field. Use fill_fields to change it.`,
  };
}

/** Repeat rules for a site with no rows to add or delete. */
export const noRepeats: import("./types.js").RepeatRules = {
  noun: "row",
  added: (doc) => doc.querySelectorAll("input, select, textarea").length,
  removed: (doc) => doc.querySelectorAll("input, select, textarea").length,
  deleteButton: async () => null,
  confirmRemoval: async () => {},
};
