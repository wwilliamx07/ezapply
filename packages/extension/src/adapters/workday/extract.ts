import type { Field, FieldKind, FormSchema, PageAction, PageKind } from "@ezapply/protocol";
import { cleanLabel, cssEscape, isVisible, norm, slug, text } from "./dom.js";
import { hintKey, PROFILE_HINTS, SEL } from "./selectors.js";

export type PageSchema = Omit<FormSchema, "tabId">;

export interface FieldRef {
  field: Field;
  container: HTMLElement;
}

export interface Extraction {
  schema: PageSchema;
  fields: Map<string, FieldRef>;
  addButtons: Map<string, HTMLElement>;
}

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

export function isSubmitControl(el: Element | null): boolean {
  const control = el?.closest?.("button, [role='button'], input[type='submit'], a");
  if (!control) return false;
  const label = norm(
    `${text(control)} ${control.getAttribute("aria-label") ?? ""} ${(control as HTMLInputElement).value ?? ""}`,
  );
  const auto = control.getAttribute("data-automation-id") ?? "";
  if (SUBMIT_TEXT.test(text(control)) || /^submit\b/i.test(label)) return true;
  // The forward button on the review step submits the application whatever its label.
  return /next|footer/i.test(auto) && isReviewStep(control.ownerDocument);
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

export function pageErrors(doc: Document): string[] {
  const out = new Set<string>();
  for (const el of doc.querySelectorAll(SEL.errors)) {
    const t = text(el);
    if (t && isVisible(el)) out.add(t.slice(0, 300));
  }
  return [...out];
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

export function extract(doc: Document, url: string): Extraction {
  const fields = new Map<string, FieldRef>();
  const sections = new Map<string, { id: string; title: string; fields: Field[] }>();
  const containers = [...doc.querySelectorAll<HTMLElement>(SEL.fieldContainer)].filter(
    // Skip containers nested in another container (composite widgets).
    (c) => isVisible(c) && !c.parentElement?.closest(SEL.fieldContainer),
  );
  const repeats = new Map<string, number>();

  for (const container of containers) {
    const kind = fieldKind(container);
    if (!kind) continue;
    const automationId = container.getAttribute("data-automation-id") ?? undefined;
    const label = fieldLabel(container, kind);
    const sectionTitle = sectionTitleOf(container);
    const sectionId = slug(sectionTitle);
    const baseKey = automationId ? automationId.replace(/^formField-/, "") : slug(label);
    let id = `${sectionId}.${baseKey}`;
    const seen = repeats.get(id) ?? 0;
    repeats.set(id, seen + 1);
    if (seen > 0) id = `${id}#${seen + 1}`;

    const field: Field = {
      id,
      ...(automationId ? { automationId } : {}),
      label,
      required: isRequired(container),
      kind,
      currentValue: currentValue(container, kind),
    };
    const help = text(container.querySelector(SEL.helpText));
    if (help && help !== label) field.helpText = help.slice(0, 500);
    const options = knownOptions(container, kind);
    if (options) field.options = options;
    if (kind === "dropdown" || kind === "typeahead") field.optionsLazy = true;
    if (kind === "date") field.dateParts = dateParts(container);
    if (kind === "typeahead" || kind === "file") field.multiple = isMultiple(container, kind);
    const error = fieldError(container);
    if (error) field.error = error;
    if (automationId) {
      const hint = PROFILE_HINTS[hintKey(automationId)];
      if (hint) field.hint = { profileKey: hint };
    }

    fields.set(id, { field, container });
    const section = sections.get(sectionId) ?? { id: sectionId, title: sectionTitle, fields: [] };
    section.fields.push(field);
    sections.set(sectionId, section);
  }

  const addButtons = new Map<string, HTMLElement>();
  for (const b of doc.querySelectorAll<HTMLElement>(SEL.addButton)) {
    if (!isVisible(b)) continue;
    const label = norm(b.getAttribute("aria-label")) || text(b) || "Add";
    let id = `add.${slug(label)}`;
    for (let n = 2; addButtons.has(id); n++) id = `add.${slug(label)}#${n}`;
    addButtons.set(id, b);
  }

  const next = nextButton(doc);
  const step = stepInfo(doc);
  const schema: PageSchema = {
    adapter: "workday",
    url,
    tenant: tenantOf(url),
    pageKind: detectPage(doc, fields.size),
    ...(step ? { step } : {}),
    sections: [...sections.values()],
    addButtons: [...addButtons.entries()].map(([id, el]) => ({
      id,
      label: norm(el.getAttribute("aria-label")) || text(el),
    })),
    actions: pageActions(doc),
    errors: pageErrors(doc),
    ...(next ? { nextLabel: text(next) } : {}),
  };
  return { schema, fields, addButtons };
}

function tenantOf(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

export function fieldKind(c: HTMLElement): FieldKind | null {
  if (c.querySelector(SEL.fileDropZone) || c.querySelector('input[type="file"]')) return "file";
  const labels = [...c.querySelectorAll("input")].map((i) => (i.getAttribute("aria-label") ?? "").toLowerCase());
  if (labels.includes("year") || labels.includes("month")) return "date";
  if (c.querySelector(SEL.multiSelect)) return "typeahead";
  if (c.querySelector('button[aria-haspopup="listbox"]')) return "dropdown";
  const radios = c.querySelectorAll('input[type="radio"]');
  if (radios.length > 0) return "radio";
  const boxes = c.querySelectorAll('input[type="checkbox"]');
  if (boxes.length > 1) return "checkbox-group";
  if (boxes.length === 1) return "checkbox";
  if (c.querySelector("textarea")) return "textarea";
  if (c.querySelector('input[type="password"]')) return "password";
  if (c.querySelector('input[type="number"]')) return "number";
  if (
    c.querySelector("input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='url']")
  )
    return "text";
  return null;
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

function currentValue(c: HTMLElement, kind: FieldKind): Field["currentValue"] {
  switch (kind) {
    case "text":
    case "number":
    case "textarea":
      return (c.querySelector("input, textarea") as HTMLInputElement | null)?.value ?? "";
    case "password":
      return (c.querySelector("input") as HTMLInputElement | null)?.value ? "••••" : "";
    case "dropdown": {
      const t = text(c.querySelector('button[aria-haspopup="listbox"]'));
      return /^select one$|^select$|^$/i.test(t) ? null : t;
    }
    case "typeahead": {
      const items = [...c.querySelectorAll(SEL.selectedChips)].map(text).filter(Boolean);
      return [...new Set(items)];
    }
    case "radio": {
      const checked = [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
        (r) => r.checked || r.getAttribute("aria-checked") === "true",
      );
      return checked ? optionLabel(checked) : null;
    }
    case "checkbox": {
      const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]');
      return Boolean(box && (box.checked || box.getAttribute("aria-checked") === "true"));
    }
    case "checkbox-group":
      return [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        .filter((b) => b.checked || b.getAttribute("aria-checked") === "true")
        .map(optionLabel);
    case "date": {
      const part = (l: string) =>
        (c.querySelector(`input[aria-label="${l}" i]`) as HTMLInputElement | null)?.value?.trim() ?? "";
      const [y, m, d] = [part("Year"), part("Month"), part("Day")];
      if (!y && !m && !d) return null;
      return [y, m?.padStart(2, "0"), d?.padStart(2, "0")].filter(Boolean).join("-");
    }
    case "file":
      return [...c.querySelectorAll(SEL.fileItem)].map(text).filter(Boolean);
  }
}

export function optionLabel(input: HTMLInputElement): string {
  const id = input.id;
  const byFor = id ? input.ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`) : null;
  const wrap = input.closest("label");
  return cleanLabel(text(byFor ?? wrap) || input.getAttribute("aria-label") || input.value);
}

function knownOptions(c: HTMLElement, kind: FieldKind): string[] | undefined {
  if (kind === "radio") return [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(optionLabel);
  if (kind === "checkbox-group")
    return [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(optionLabel);
  return undefined;
}

function dateParts(c: HTMLElement): ("MM" | "DD" | "YYYY")[] {
  const has = (l: string) => Boolean(c.querySelector(`input[aria-label="${l}" i]`));
  return [
    ...(has("Month") ? (["MM"] as const) : []),
    ...(has("Day") ? (["DD"] as const) : []),
    ...(has("Year") ? (["YYYY"] as const) : []),
  ];
}

function isMultiple(c: HTMLElement, kind: FieldKind): boolean {
  if (kind === "file") return Boolean((c.querySelector('input[type="file"]') as HTMLInputElement | null)?.multiple);
  const ms = c.querySelector(SEL.multiSelect);
  return (
    ms?.getAttribute("data-uxi-multiselect-singleselect") === "false" ||
    ms?.getAttribute("aria-multiselectable") === "true"
  );
}

function fieldError(c: HTMLElement): string | undefined {
  const err = c.querySelector(SEL.errors);
  if (err && text(err)) return text(err).slice(0, 300);
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
