import type { FillResult, FillValue, OptionInfo } from "@ezapply/protocol";
import {
  callReact,
  isVisible,
  key,
  matchOption,
  norm,
  parseDate,
  press,
  setNativeValue,
  settle,
  sleep,
  text,
  waitFor,
  win,
} from "../../engine/dom.js";
import { T } from "../../engine/timing.js";
import { branch, note, tracing } from "../../engine/trace.js";
import {
  attachedFiles,
  comboInput,
  datePartInputs,
  dateValue,
  type FieldRef,
  isChecked,
  isSubmitControl,
  monthNames,
  pillButtons,
  pillLabel,
  pillPressed,
  radioLabel,
} from "./page.js";
import { SEL, TEXT } from "./selectors.js";

type Result = Omit<FillResult, "fieldId">;

const fail = (error: string, extra: Partial<Result> = {}): Result => ({ ok: false, error, ...extra });
const same = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** `strict`: options only by `strictIndex` (see `matchOption`); a miss fails with the options seen. */
export async function fillField(ref: FieldRef, value: FillValue, strict = false): Promise<Result> {
  const c = ref.container;
  switch (ref.field.kind) {
    case "text":
    case "number":
    case "textarea":
      return fillText(c, asString(value));
    case "password":
      return fail("Password fields are never filled by ezapply. Ask the user to type it.");
    case "dropdown": {
      const input = await waitFor(() => comboInput(c), T.dropdownOpenMs);
      return input ? fillCombo(input, [asString(value)], strict) : fail("The list didn't load.");
    }
    case "radio":
      return pillButtons(c).length
        ? fillPills(c, [asString(value)], false, strict)
        : fillRadio(c, asString(value), strict);
    case "checkbox-group":
      return fillPills(c, Array.isArray(value) ? value : [asString(value)], true, strict);
    case "checkbox":
      return fillCheckbox(c, value === true || /^(true|yes|checked)$/i.test(String(value)));
    case "date":
      return fillDate(c, asString(value));
    case "file":
      return fail("Use upload_file for file fields.");
    case "typeahead":
      return fail("This kind of field isn't supported on Oracle pages. Ask the user to fill it.");
  }
}

function asString(v: FillValue): string {
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

// ---- text ---------------------------------------------------------------------------------------

/** Leave a control as a person does, so the page validates it: focus moves away. */
function leave(el: HTMLElement): void {
  if (el.ownerDocument.activeElement === el) el.blur();
  else {
    const w = win(el);
    el.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new w.FocusEvent("blur"));
  }
}

/** The same digits: a page that formats what's typed (`416-555-0100` shown as `(416) 555-0100`) took it. */
const sameDigits = (a: string, b: string) => {
  const d = (s: string) => s.replace(/\D/g, "");
  return d(a).length >= 7 && d(a) === d(b);
};

async function fillText(c: HTMLElement, value: string): Promise<Result> {
  const input = c.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "textarea:not([tabindex='-1']), input:not([type='hidden'])",
  );
  if (!input) return fail("No input found in the field.");
  if (input.readOnly) return fail("This field is read-only on the page.", { readBack: input.value });
  input.focus();
  // Knockout's value binding reads the input on change; textInput on input. setNativeValue fires both.
  setNativeValue(input, value);
  leave(input);
  await sleep(T.textCheckMs);
  const took = input.value === value || (input.type === "tel" && sameDigits(input.value, value));
  return took
    ? { ok: true, readBack: input.value }
    : fail("The page did not accept the value.", { readBack: input.value });
}

// ---- cx-select (combobox with a grid of options) ------------------------------------------------

/**
 * The field's input as it is now. Choosing in one list can re-render the lists that depend on it (a city after
 * the province), replacing their inputs; seen live, typing into the old, detached input searched nothing.
 */
function live(input: HTMLInputElement): HTMLInputElement {
  if (input.isConnected || !input.id) return input;
  return (input.ownerDocument.getElementById(input.id) as HTMLInputElement | null) ?? input;
}

/**
 * Whether the input shows the chosen option. A list may label options more fully than the chosen value shows:
 * live, the city option "Kanata, Ontario" reads "Kanata" once chosen, the postal code "K2K 3E9".
 */
function shows(value: string, option: string): boolean {
  const v = norm(value).toLowerCase();
  const o = norm(option).toLowerCase();
  return Boolean(v) && (v === o || (o.startsWith(v) && /^[\s,(–-]/.test(o.slice(v.length))));
}

function comboList(input: HTMLInputElement): HTMLElement | null {
  const id = input.getAttribute("aria-controls") || `${input.id}-listbox`;
  return input.ownerDocument.getElementById(id);
}

function comboOptions(input: HTMLInputElement): HTMLElement[] {
  const list = comboList(input);
  if (!list || !isVisible(list) || list.getAttribute("aria-busy") === "true") return [];
  return [...list.querySelectorAll<HTMLElement>(SEL.comboOption)];
}

const optionText = (o: HTMLElement) => text(o.querySelector(SEL.comboOptionLabel) ?? o);
const signature = (input: HTMLInputElement) => comboOptions(input).map(optionText).join("\u0001");

function noResults(input: HTMLInputElement): boolean {
  const list = comboList(input);
  return Boolean(list && isVisible(list) && list.querySelector(SEL.comboNoResults));
}

function isOpen(input: HTMLInputElement): boolean {
  return input.getAttribute("aria-expanded") === "true" || comboOptions(input).length > 0 || noResults(input);
}

/**
 * Close the list, never pressing Escape on a closed one: cx-select clears its value on Escape while closed.
 * Typed text the list didn't take is put back by the widget itself when the input loses focus.
 */
async function closeCombo(input: HTMLInputElement): Promise<void> {
  if (isOpen(input)) {
    key(input, "Escape");
    await waitFor(() => !isOpen(input), T.dropdownClosedMs);
  }
  leave(input);
  await sleep(T.dropdownCloseKeyMs);
}

/**
 * Open the list: focus the input and press it (the widget loads and shows every option), else its arrow
 * button, else React's handler. Another list left open is closed first, since only the focused one belongs to
 * the field being filled.
 */
async function openCombo(input: HTMLInputElement): Promise<boolean> {
  const doc = input.ownerDocument;
  for (const other of doc.querySelectorAll<HTMLInputElement>(SEL.comboInput)) {
    if (other !== input && isOpen(other)) await closeCombo(other);
  }
  const ready = () => comboOptions(input).length > 0 || noResults(input);
  input.focus();
  if (!ready()) press(input);
  if (await waitFor(ready, T.dropdownOpenMs)) return true;
  const toggle = doc.getElementById(`${input.id}-toggle-button`);
  if (toggle && !isOpen(input)) press(toggle);
  else callReact(input, "onClick", {});
  return Boolean(await waitFor(ready, T.dropdownOpenRetryMs));
}

/**
 * Type a query and wait for the list to show its results: options that differ from those before, or "no
 * results". Long lists (countries, cities) search as you type, some of them on the server.
 */
async function typeQuery(field: HTMLInputElement, query: string): Promise<void> {
  const busy = () => comboList(live(field))?.getAttribute("aria-busy") === "true";
  await waitFor(() => !busy(), T.typeaheadResultsMs, 100);
  const input = live(field);
  const before = signature(input);
  input.focus();
  setNativeValue(input, query);
  const done = () => {
    const now = live(field);
    return !busy() && ((comboOptions(now).length > 0 && signature(now) !== before) || noResults(now));
  };
  await waitFor(done, T.typeaheadResultsMs, 100);
  await settle(input.ownerDocument, T.typeaheadResultsQuietMs, T.typeaheadResultsMaxMs);
}

/**
 * The option for the first candidate that matches one exactly, else the closest match of the first (only a strict
 * one with `strict`).
 */
function pick(candidates: string[], labels: string[], strict: boolean): number {
  for (const c of candidates) {
    const i = labels.findIndex((l) => same(l, c));
    if (i >= 0) return i;
  }
  return matchOption(candidates[0] ?? "", labels, strict);
}

async function choose(field: HTMLInputElement, option: HTMLElement, wanted: string): Promise<boolean> {
  const took = () => shows(live(field).value, wanted) && !isOpen(live(field));
  press(option);
  if (await waitFor(took, T.dropdownSelectMs)) return true;
  callReact(option, "onClick", {});
  return Boolean(await waitFor(took, T.dropdownSelectRetryMs));
}

/**
 * Choose an option: from the list as it opens, else by typing the value and choosing from the results. An
 * auto-suggest field (free text with suggestions) keeps the typed text when no suggestion matches.
 */
export async function fillCombo(field: HTMLInputElement, candidates: string[], strict = false): Promise<Result> {
  const value = candidates[0] ?? "";
  const input = () => live(field);
  if (input().readOnly) return fail("This field is read-only on the page.", { readBack: input().value });
  if (candidates.some((c) => shows(input().value, c))) return { ok: true, readBack: input().value };
  if (!(await openCombo(input()))) return fail("Could not open the list.");
  let labels = comboOptions(input()).map(optionText);
  if (tracing()) note("list", { options: labels.slice(0, 80) });
  let idx = pick(candidates, labels, strict);
  // Search by the value, then by its first part: a server-side search finds "K2K 3E9" but not the full label
  // "K2K 3E9, Kanata, Ontario" (seen live).
  const queries = [...new Set([value, value.split(",")[0]?.trim() ?? ""])].filter(Boolean);
  for (const query of queries) {
    if (idx >= 0) break;
    branch("search the list", { query });
    await typeQuery(input(), query);
    labels = comboOptions(input()).map(optionText);
    idx = pick(candidates, labels, strict);
  }
  if (idx < 0) {
    if (input().classList.contains(SEL.comboAutoSuggest)) {
      await closeCombo(input());
      return same(input().value, value)
        ? { ok: true, readBack: input().value }
        : fail("The page did not keep the text.", { readBack: input().value });
    }
    await closeCombo(input());
    return fail(`No option matches "${value}"${strict ? " exactly" : ""}.`, {
      availableOptions: labels.filter(Boolean).slice(0, 80),
    });
  }
  const wanted = labels[idx] as string;
  await choose(field, comboOptions(input())[idx] as HTMLElement, wanted);
  // Leaving the input is also what puts back typed text the list didn't take, so a match read after it is the
  // chosen option, not the query.
  leave(input());
  await sleep(T.dropdownCloseKeyMs);
  const readBack = input().value;
  return shows(readBack, wanted) ? { ok: true, readBack } : fail("Selection did not stick.", { readBack });
}

export async function listCombo(c: HTMLElement): Promise<OptionInfo[]> {
  const input = await waitFor(() => comboInput(c), T.dropdownOpenMs);
  if (!input || !(await openCombo(input))) return [];
  const out = comboOptions(input)
    .map((o) => ({ label: optionText(o) }))
    .filter((o) => o.label);
  await closeCombo(input);
  return out;
}

export async function searchCombo(c: HTMLElement, query: string): Promise<OptionInfo[]> {
  const input = await waitFor(() => comboInput(c), T.dropdownOpenMs);
  if (!input) return [];
  await openCombo(input);
  await typeQuery(input, query);
  const out = comboOptions(input)
    .map((o) => ({ label: optionText(o) }))
    .filter((o) => o.label);
  await closeCombo(input);
  return out;
}

// ---- pills, radios, checkboxes ------------------------------------------------------------------

async function setPill(pill: HTMLElement, want: boolean): Promise<boolean> {
  if (pillPressed(pill) === want) return true;
  // A pressed single-select pill unselects itself when pressed again, so press only when it must change.
  press(pill);
  if (await waitFor(() => pillPressed(pill) === want, T.checkMs)) return true;
  callReact(pill, "onClick", {});
  return Boolean(await waitFor(() => pillPressed(pill) === want, T.checkMs));
}

/** Short option lists shown as toggle buttons: one pressed (radio), or several (checkbox group). */
async function fillPills(c: HTMLElement, wanted: string[], multiple: boolean, strict: boolean): Promise<Result> {
  const pills = pillButtons(c);
  const labels = pills.map(pillLabel);
  const targets = new Set<number>();
  for (const w of wanted) {
    const idx = matchOption(w, labels, strict);
    if (idx < 0) return fail(`No option matches "${w}".`, { availableOptions: labels });
    targets.add(idx);
  }
  if (!multiple) {
    const [only] = targets;
    const ok = await setPill(pills[only as number] as HTMLElement, true);
    return ok ? { ok, readBack: labels[only as number] as string } : fail("Selection did not stick.");
  }
  for (const [i, pill] of pills.entries()) await setPill(pill, targets.has(i));
  const readBack = pills.filter(pillPressed).map(pillLabel);
  return readBack.length === targets.size && [...targets].every((i) => pillPressed(pills[i] as HTMLElement))
    ? { ok: true, readBack }
    : fail("Some options did not change.", { readBack });
}

async function fillRadio(c: HTMLElement, value: string, strict: boolean): Promise<Result> {
  const radios = [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const labels = radios.map(radioLabel);
  const idx = matchOption(value, labels, strict);
  if (idx < 0) return fail(`No option matches "${value}".`, { availableOptions: labels });
  const radio = radios[idx] as HTMLInputElement;
  // Knockout's checked binding reads the input on click.
  press(radio);
  if (!(await waitFor(() => isChecked(radio), T.checkMs))) {
    const label = radio.id ? c.querySelector<HTMLElement>(`label[for="${radio.id}"]`) : null;
    if (label) press(label);
    await waitFor(() => isChecked(radio), T.checkMs);
  }
  return isChecked(radio) ? { ok: true, readBack: labels[idx] as string } : fail("Selection did not stick.");
}

async function fillCheckbox(c: HTMLElement, want: boolean): Promise<Result> {
  const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) return fail("No checkbox found.");
  if (isChecked(box) !== want) {
    press(box);
    await waitFor(() => isChecked(box) === want, T.checkMs);
  }
  return isChecked(box) === want ? { ok: true, readBack: want } : fail("Checkbox did not change.");
}

// ---- date (three lists: month, day, year) -------------------------------------------------------

async function fillDate(c: HTMLElement, value: string): Promise<Result> {
  const date = parseDate(value);
  if (!date) return fail('Dates must be "YYYY-MM-DD", "YYYY-MM" or "YYYY" (or "MM/YYYY", "MM/DD/YYYY").');
  const parts = datePartInputs(c);
  const month = date.month ? Number(date.month) : undefined;
  const day = date.day ? Number(date.day) : undefined;
  const wanted: string[] = [];
  const problems: string[] = [];
  for (const { part, input } of parts) {
    const candidates =
      part === "YYYY"
        ? [date.year]
        : part === "MM"
          ? month && monthNames(month)
          : day && [String(day).padStart(2, "0"), String(day)];
    if (!candidates) return fail(`This date needs a ${part === "MM" ? "month" : "day"}.`);
    const r = await fillCombo(input, candidates);
    if (!r.ok) problems.push(`${part}: ${r.error}`);
  }
  await settle(c.ownerDocument, T.dateQuietMs, T.dateMaxMs);
  const has = (p: string) => parts.some((x) => x.part === p);
  if (has("YYYY")) wanted.push(date.year);
  if (has("MM") && month) wanted.push(String(month).padStart(2, "0"));
  if (has("DD") && day) wanted.push(String(day).padStart(2, "0"));
  const readBack = dateValue(c) ?? "";
  return readBack === wanted.join("-") && !problems.length
    ? { ok: true, readBack }
    : fail(`The date shows "${readBack || "nothing"}". ${problems.join(" ")}`.trim(), { readBack });
}

// ---- file ---------------------------------------------------------------------------------------

export async function uploadFile(c: HTMLElement, file: File): Promise<Result> {
  const names = () => attachedFiles(c).map((f) => f.name);
  const input = c.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    return names().length
      ? fail(`The field already holds ${names().join(", ")}: remove it with remove_items first.`, { readBack: names() })
      : fail("No file input in the field.");
  }
  // Only a newly shown file counts: a same-named file from the candidate's profile must not pass.
  const before = new Set(attachedFiles(c).map((f) => f.row));
  const wanted = file.name.toLowerCase();
  const done = () => attachedFiles(c).some((f) => !before.has(f.row) && f.name.toLowerCase().includes(wanted));
  const w = win(c);
  const dt = new w.DataTransfer();
  dt.items.add(file);
  try {
    input.files = dt.files;
  } catch {
    Object.defineProperty(input, "files", { value: dt.files, configurable: true });
  }
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  input.dispatchEvent(new w.Event("change", { bubbles: true }));
  if (!(await waitFor(done, T.uploadMs, 200))) {
    const zone = input.closest<HTMLElement>(SEL.upload);
    if (zone?.isConnected) {
      zone.dispatchEvent(new w.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await waitFor(done, T.uploadDropMs, 250);
    }
  }
  return done()
    ? { ok: true, readBack: names() }
    : fail("The upload did not appear in the field.", { readBack: names() });
}

// ---- removing -----------------------------------------------------------------------------------

export interface RemoveOutcome {
  ok: boolean;
  removed: string[];
  remaining: string[];
  notFound?: string[];
  error?: string;
}

/** Press the confirm button of a delete/remove confirmation, if one appeared. */
export async function confirmRemoval(doc: Document): Promise<void> {
  const dialog = [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].find(
    (d) => isVisible(d) && /delete|remove/i.test(text(d)),
  );
  const button = dialog
    ? [...dialog.querySelectorAll<HTMLElement>("button,[role='button']")].find(
        (b) => isVisible(b) && TEXT.confirmRemoval.test(text(b)),
      )
    : undefined;
  if (button && !isSubmitControl(button)) {
    press(button);
    await settle(doc, T.removeQuietMs, T.removeMaxMs);
  }
}

/**
 * Remove attached files from a file field (a resume or cover letter from the candidate's profile), or unselect
 * options of a multi-select. `values` are matched like fill values; without them everything goes.
 */
export async function removeItems(ref: FieldRef, values?: string[] | null): Promise<RemoveOutcome> {
  const c = ref.container;
  const kind = ref.field.kind;
  if (kind === "checkbox-group" && pillButtons(c).length) {
    const current = pillButtons(c).filter(pillPressed).map(pillLabel);
    const notFound = (values ?? []).filter((v) => matchOption(v, current) < 0);
    const targets = (values ?? current).map((v) => current[matchOption(v, current)]).filter(Boolean) as string[];
    const removed: string[] = [];
    for (const label of targets) {
      const pill = pillButtons(c).find((p) => pillLabel(p) === label);
      if (pill && (await setPill(pill, false))) removed.push(label);
    }
    const remaining = pillButtons(c).filter(pillPressed).map(pillLabel);
    const ok = removed.length === targets.length && !notFound.length;
    return {
      ok,
      removed,
      remaining,
      ...(notFound.length ? { notFound } : {}),
      ...(ok
        ? {}
        : { error: notFound.length ? `Not selected: ${notFound.join(", ")}.` : "Some options did not change." }),
    };
  }
  if (kind !== "file") {
    return {
      ok: false,
      removed: [],
      remaining: [],
      error: `remove_items works on file fields and multi-selects; this is a ${kind} field. Use fill_fields to change it.`,
    };
  }
  const current = attachedFiles(c).map((f) => f.name);
  const notFound: string[] = [];
  const targets: string[] = [];
  for (const v of values ?? current) {
    const idx = matchOption(v, current);
    if (idx < 0) notFound.push(v);
    else targets.push(current[idx] as string);
  }
  const removed: string[] = [];
  const failed: string[] = [];
  for (const name of targets) {
    const count = () => attachedFiles(c).filter((f) => f.name === name).length;
    const before = count();
    const row = attachedFiles(c).find((f) => f.name === name)?.row;
    const button =
      row?.querySelector<HTMLElement>(SEL.fileRemove) ??
      (row?.matches(SEL.fileRow)
        ? row.querySelector<HTMLElement>("button:not(.attachment-upload-button__download)")
        : null);
    if (!button || isSubmitControl(button)) {
      failed.push(name);
      continue;
    }
    press(button);
    if (!(await waitFor(() => count() < before, T.removeMs))) {
      await confirmRemoval(c.ownerDocument);
      await waitFor(() => count() < before, T.removeMs);
    }
    if (count() < before) removed.push(name);
    else failed.push(name);
    await settle(c.ownerDocument, T.removeQuietMs, T.removeMaxMs);
  }
  const remaining = attachedFiles(c).map((f) => f.name);
  const problems = [
    failed.length ? `Could not remove: ${failed.join(", ")}.` : "",
    notFound.length ? `Not in the field: ${notFound.join(", ")} (it holds: ${current.join(", ") || "nothing"}).` : "",
  ].filter(Boolean);
  return {
    ok: problems.length === 0,
    removed,
    remaining,
    ...(notFound.length ? { notFound } : {}),
    ...(problems.length ? { error: problems.join(" ") } : {}),
  };
}
