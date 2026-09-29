import type { FillResult, FillValue, OptionInfo } from "@ezapply/protocol";
import {
  blur,
  callReact,
  cssEscape,
  isVisible,
  key,
  matchOption,
  norm,
  press,
  setNativeValue,
  settle,
  sleep,
  text,
  typeChar,
  waitFor,
  win,
} from "./dom.js";
import {
  attachedFiles,
  datePartInput,
  datePartValue,
  dateValue,
  type FieldRef,
  fieldError,
  fieldKind,
  isSubmitControl,
  optionLabel,
} from "./extract.js";
import { SEL, within } from "./selectors.js";

type Result = Omit<FillResult, "fieldId">;

const fail = (error: string, extra: Partial<Result> = {}): Result => ({ ok: false, error, ...extra });

export async function fillField(ref: FieldRef, value: FillValue): Promise<Result> {
  const c = ref.container;
  switch (ref.field.kind) {
    case "text":
    case "number":
    case "textarea":
      return fillText(c, asString(value));
    case "password":
      return fail("Password fields are never filled by ezapply. Ask the user to type it.");
    case "dropdown":
      return fillDropdown(c, asString(value));
    case "typeahead":
      return fillTypeahead(c, Array.isArray(value) ? value : [asString(value)]);
    case "radio":
      return fillRadio(c, asString(value));
    case "checkbox":
      return fillCheckbox(c, value === true || /^(true|yes|checked)$/i.test(String(value)));
    case "checkbox-group":
      return fillCheckboxGroup(c, Array.isArray(value) ? value : [asString(value)]);
    case "date":
      return fillDate(c, asString(value));
    case "file":
      return fail("Use upload_file for file fields.");
  }
}

function asString(v: FillValue): string {
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

// ---- text ---------------------------------------------------------------------------------------

async function fillText(c: HTMLElement, value: string): Promise<Result> {
  const input = c.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type='hidden'])");
  if (!input) return fail("No input found in the field.");
  input.focus();
  setNativeValue(input, value);
  blur(input);
  await sleep(30);
  if (input.value !== value) {
    // Fallback: drive React's handlers directly.
    input.value = value;
    callReact(input, "onChange", { target: input });
    callReact(input, "onBlur", { target: input });
    await sleep(30);
  }
  return input.value === value
    ? { ok: true, readBack: input.value }
    : fail("The page did not accept the value.", { readBack: input.value });
}

// ---- dropdown (button + listbox portal) ---------------------------------------------------------

function dropdownButton(c: HTMLElement): HTMLElement | null {
  return c.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
}

interface OpenListbox {
  button: HTMLElement;
  list: HTMLElement;
  options: HTMLElement[];
}

/** Dropdown listboxes are portals under `body`; one inside a field (e.g. a list of selected items) isn't one. */
const visibleListboxes = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>('[role="listbox"]')].filter(
    (l) => isVisible(l) && !l.closest(SEL.fieldContainer),
  );
const listOptions = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('[role="option"], li')];
const optionsSignature = (list: HTMLElement) => listOptions(list).map(text).join("\u0001");

/**
 * Open a dropdown and return its listbox. Live Workday gives the button no usable `aria-controls` and
 * animates a closed listbox away, so right after one dropdown the previous one's listbox is often still on
 * screen, and "the visible listbox" would be the wrong one (seen live: every first attempt got the previous
 * dropdown's options). So: wait for other listboxes to go first, and accept only a listbox that appeared,
 * or whose options changed, after the press.
 */
async function openListbox(c: HTMLElement): Promise<OpenListbox | null> {
  const button = dropdownButton(c);
  if (!button) return null;
  const doc = c.ownerDocument;
  if (!(await waitFor(() => visibleListboxes(doc).length === 0, 1000))) {
    for (const l of visibleListboxes(doc)) key(l, "Escape");
    await waitFor(() => visibleListboxes(doc).length === 0, 500);
  }
  const stale = new Map(visibleListboxes(doc).map((l) => [l, optionsSignature(l)]));
  const fresh = (l: HTMLElement | null): l is HTMLElement =>
    l !== null && isVisible(l) && (!stale.has(l) || stale.get(l) !== optionsSignature(l));
  const listFor = (): OpenListbox | null => {
    const id = button.getAttribute("aria-controls");
    const controlled = id ? doc.getElementById(id) : null;
    const list = fresh(controlled) ? controlled : visibleListboxes(doc).find(fresh);
    const options = list ? listOptions(list) : [];
    return list && options.length ? { button, list, options } : null;
  };
  if (button.getAttribute("aria-expanded") !== "true") press(button);
  let opened = await waitFor(listFor, 2000);
  if (!opened) {
    callReact(button, "onClick", {});
    opened = await waitFor(listFor, 2000);
  }
  return opened;
}

/** Close the listbox and wait until it has gone, so the next dropdown can't mistake it for its own. */
async function closeListbox({ button, list }: OpenListbox): Promise<void> {
  if (button.getAttribute("aria-expanded") === "true") {
    key(button, "Escape");
    await sleep(50);
    if (button.getAttribute("aria-expanded") === "true") press(button);
  }
  await waitFor(() => !list.isConnected || !isVisible(list), 1000);
}

export async function listDropdown(c: HTMLElement): Promise<OptionInfo[]> {
  const opened = await openListbox(c);
  if (!opened) return [];
  const labels = opened.options.map((o) => ({ label: text(o) })).filter((o) => o.label);
  await closeListbox(opened);
  return labels;
}

async function fillDropdown(c: HTMLElement, value: string): Promise<Result> {
  const opened = await openListbox(c);
  if (!opened) return fail("Could not open the dropdown.");
  const labels = opened.options.map(text);
  const idx = matchOption(value, labels);
  if (idx < 0) {
    await closeListbox(opened);
    return fail(`No option matches "${value}".`, { availableOptions: labels.filter(Boolean).slice(0, 80) });
  }
  const option = opened.options[idx] as HTMLElement;
  const wanted = labels[idx] as string;
  press(option);
  const ok = await waitFor(() => norm(text(opened.button)) === norm(wanted), 1500);
  if (!ok) {
    callReact(option, "onClick", {});
    await waitFor(() => norm(text(opened.button)) === norm(wanted), 1500);
  }
  await closeListbox(opened);
  const readBack = text(opened.button);
  return norm(readBack) === norm(wanted) ? { ok: true, readBack } : fail("Selection did not stick.", { readBack });
}

// ---- typeahead / prompt (multiSelectContainer + wd-popup) ---------------------------------------

function promptPopup(c: HTMLElement): HTMLElement | null {
  const doc = c.ownerDocument;
  const container = c.querySelector(SEL.multiSelect);
  const id = container?.getAttribute("id");
  if (id) {
    const assoc = doc.querySelector<HTMLElement>(`[data-associated-widget="${cssEscape(id)}"]`);
    if (assoc) return assoc.closest<HTMLElement>(SEL.popup) ?? assoc;
  }
  return [...doc.querySelectorAll<HTMLElement>(SEL.popup)].find(isVisible) ?? null;
}

/** Workday's placeholder row when a search finds nothing (or hasn't finished). Not an option. */
const NO_ITEMS = /^no items\.?$/i;

/**
 * The options on screen, once each. Both option hooks match one live option (one element inside the other),
 * which listed every option twice and made unique matches look ambiguous; the innermost is kept, since a
 * press on it reaches the outer one's handlers too.
 */
function promptOptions(c: HTMLElement): HTMLElement[] {
  const popup = promptPopup(c);
  const scope: ParentNode = popup ?? c.ownerDocument;
  const all = [...scope.querySelectorAll<HTMLElement>(SEL.promptOption)].filter(isVisible);
  return all.filter((el) => !all.some((o) => o !== el && el.contains(o)) && !NO_ITEMS.test(text(el)));
}

const promptSignature = (c: HTMLElement) => promptOptions(c).map(text).join("\u0001");

function noItemsShown(c: HTMLElement): boolean {
  const scope: ParentNode = promptPopup(c) ?? c.ownerDocument;
  return [...scope.querySelectorAll<HTMLElement>(SEL.promptOption)].some((o) => isVisible(o) && NO_ITEMS.test(text(o)));
}

function selectedItems(c: HTMLElement): string[] {
  return [...new Set([...c.querySelectorAll(SEL.selectedChips)].map(text).filter(Boolean))];
}

function optionInfo(el: HTMLElement): OptionInfo {
  const hasChildren =
    el.getAttribute("data-automation-id") === "promptOption" &&
    (el.getAttribute("aria-haspopup") === "true" ||
      Boolean(el.closest("[aria-haspopup='true']")) ||
      Boolean(el.parentElement?.querySelector("[data-automation-id='promptIcon'], svg.wd-icon-chevron-right-small")));
  return { label: text(el), ...(hasChildren ? { hasChildren: true } : {}) };
}

/**
 * Type a query and wait for its results. Results count only once the options on screen differ from those
 * before the query: live Workday renders search results a moment after the page goes quiet, and reading on
 * quiet returned the previous query's results (or none), one call behind.
 */
async function typeQuery(c: HTMLElement, query: string): Promise<HTMLInputElement | null> {
  const input = c.querySelector<HTMLInputElement>(`${within(SEL.multiSelect, "input")}, input`);
  if (!input) return null;
  input.focus();
  press(input);
  await settle(c.ownerDocument, 150, 1000);
  const before = promptSignature(c);
  // Done when new options show, or when "No Items." has stayed for a while (a search that found nothing:
  // it also shows briefly while results load).
  let emptySince = 0;
  const done = () => {
    if (promptOptions(c).length > 0 && promptSignature(c) !== before) return true;
    if (!noItemsShown(c)) {
      emptySince = 0;
      return false;
    }
    emptySince ||= Date.now();
    return Date.now() - emptySince > 2000;
  };
  setNativeValue(input, query);
  key(input, "Enter");
  if (!(await waitFor(done, 4000, 100))) {
    callReact(input, "onKeyDown", { key: "Enter", target: { value: query } });
    await waitFor(done, 2000, 100);
  }
  await settle(c.ownerDocument, 150, 1500);
  return input;
}

/** Options by label, once each. */
function uniqueOptions(c: HTMLElement): OptionInfo[] {
  const seen = new Map<string, OptionInfo>();
  for (const o of promptOptions(c).map(optionInfo)) if (o.label && !seen.has(o.label)) seen.set(o.label, o);
  return [...seen.values()];
}

export async function searchTypeahead(c: HTMLElement, query: string): Promise<OptionInfo[]> {
  await typeQuery(c, query);
  const out = uniqueOptions(c);
  key(c.querySelector("input") ?? c, "Escape");
  return out;
}

export async function listTypeahead(c: HTMLElement): Promise<OptionInfo[]> {
  const input = c.querySelector<HTMLElement>(`${within(SEL.multiSelect, "input")}, input`);
  if (!input) return [];
  press(input);
  await settle(c.ownerDocument, 300, 2500);
  const out = uniqueOptions(c);
  key(input, "Escape");
  return out;
}

const lower = (s: string) => norm(s).toLowerCase();

/**
 * Select one value. The value may be a path through nested menus: "Job Board > LinkedIn"; the last segment is
 * the item to select, earlier ones open categories. Returns the selected label, or the options seen when a
 * segment matched nothing.
 */
async function selectPath(c: HTMLElement, path: string[]): Promise<{ selected: string } | { options: string[] }> {
  if (path.length > 1) {
    const input = c.querySelector<HTMLElement>(`${within(SEL.multiSelect, "input")}, input`);
    if (input) press(input);
    await settle(c.ownerDocument, 300, 2500);
  } else {
    await typeQuery(c, path[0] as string);
  }
  let selected = "";
  for (const [i, segment] of path.entries()) {
    const options = await waitFor(() => {
      const o = promptOptions(c);
      return o.length ? o : null;
    }, 2500);
    if (!options) return { options: [] };
    const labels = options.map(text);
    const idx = matchOption(segment, labels);
    if (idx < 0) return { options: [...new Set(labels)] };
    const option = options[idx] as HTMLElement;
    selected = labels[idx] as string;
    press(option);
    await settle(c.ownerDocument, 250, 2000);
    if (i === path.length - 1 && !selectedItems(c).some((s) => norm(s) === norm(selected))) {
      callReact(option, "onClick", {});
      await settle(c.ownerDocument, 250, 2000);
    }
  }
  return { selected };
}

/**
 * Select each value on its own: one that matches nothing is reported in `unmatched` with the options its search
 * showed, and the rest are still selected (seen live: a skills list stopped at its first unmatched entry).
 * When Workday selects an option itself on Enter (single-select prompts do), it's reported in `inexact`.
 */
async function fillTypeahead(c: HTMLElement, values: string[]): Promise<Result> {
  const unmatched: { value: string; suggestions: string[] }[] = [];
  const inexact: { value: string; selected: string }[] = [];
  const input = () => c.querySelector("input") ?? c;
  for (const value of values) {
    const path = value
      .split(/\s*>\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const leaf = path.at(-1) ?? value;
    if (path.length === 0 || selectedItems(c).some((s) => lower(s) === lower(leaf))) continue;
    const before = new Set(selectedItems(c).map(lower));
    const outcome = await selectPath(c, path);
    if ("selected" in outcome) {
      if (!selectedItems(c).some((s) => lower(s) === lower(outcome.selected))) {
        unmatched.push({ value, suggestions: [] });
      }
      continue;
    }
    key(input(), "Escape");
    await settle(c.ownerDocument, 150, 1000);
    const added = selectedItems(c).filter((s) => !before.has(lower(s)));
    if (added.length) inexact.push({ value, selected: added.join(", ") });
    else unmatched.push({ value, suggestions: outcome.options.slice(0, 15) });
  }
  key(input(), "Escape");
  const readBack = selectedItems(c);
  const extra = {
    readBack,
    ...(unmatched.length ? { unmatched } : {}),
    ...(inexact.length ? { inexact } : {}),
  };
  if (!unmatched.length) return { ok: true, ...extra };
  const only = unmatched.length === 1 && values.length === 1 ? unmatched[0] : undefined;
  return fail(`No option matches: ${unmatched.map((u) => `"${u.value}"`).join(", ")}.`, {
    ...extra,
    ...(only?.suggestions.length ? { availableOptions: only.suggestions } : {}),
  });
}

// ---- radio / checkbox ---------------------------------------------------------------------------

function isChecked(i: HTMLInputElement): boolean {
  return i.checked || i.getAttribute("aria-checked") === "true";
}

async function fillRadio(c: HTMLElement, value: string): Promise<Result> {
  const radios = [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const labels = radios.map(optionLabel);
  const idx = matchOption(value, labels);
  if (idx < 0) return fail(`No option matches "${value}".`, { availableOptions: labels });
  const radio = radios[idx] as HTMLInputElement;
  press(radio);
  if (!(await waitFor(() => isChecked(radio), 1000))) {
    callReact(radio, "onChange", { target: { ...radio, checked: true, value: radio.value } });
    callReact(radio, "onClick", {});
    await waitFor(() => isChecked(radio), 1000);
  }
  return isChecked(radio) ? { ok: true, readBack: labels[idx] as string } : fail("Selection did not stick.");
}

async function setCheckbox(box: HTMLInputElement, want: boolean): Promise<boolean> {
  if (isChecked(box) === want) return true;
  press(box);
  if (await waitFor(() => isChecked(box) === want, 1000)) return true;
  callReact(box, "onChange", { target: { ...box, checked: want } });
  return Boolean(await waitFor(() => isChecked(box) === want, 1000));
}

async function fillCheckbox(c: HTMLElement, want: boolean): Promise<Result> {
  const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) return fail("No checkbox found.");
  return (await setCheckbox(box, want)) ? { ok: true, readBack: want } : fail("Checkbox did not change.");
}

async function fillCheckboxGroup(c: HTMLElement, wanted: string[]): Promise<Result> {
  const boxes = [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const labels = boxes.map(optionLabel);
  const targets = new Set<number>();
  for (const w of wanted) {
    const idx = matchOption(w, labels);
    if (idx < 0) return fail(`No option matches "${w}".`, { availableOptions: labels });
    targets.add(idx);
  }
  for (const [i, box] of boxes.entries()) await setCheckbox(box, targets.has(i));
  const readBack = boxes.filter(isChecked).map(optionLabel);
  const ok = readBack.length === targets.size;
  return ok ? { ok, readBack } : fail("Some boxes did not change.", { readBack });
}

// ---- date ---------------------------------------------------------------------------------------

/** "YYYY", "YYYY-MM", "YYYY-MM-DD", "MM/YYYY" or "MM/DD/YYYY" → its parts. */
export function parseDate(value: string): { year: string; month?: string; day?: string } | null {
  const v = value.trim();
  const iso = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(v);
  if (iso) return { year: iso[1] as string, ...(iso[2] ? { month: iso[2] } : {}), ...(iso[3] ? { day: iso[3] } : {}) };
  const us = /^(\d{1,2})\/(?:(\d{1,2})\/)?(\d{4})$/.exec(v);
  if (us) return { year: us[3] as string, month: us[1] as string, ...(us[2] ? { day: us[2] } : {}) };
  return null;
}

/**
 * Enter one date part the way a person does: click it, type the digits, leave it. Live Workday's parts take
 * digits in their key handlers and keep the value in their own state; setting the input's value (what this
 * did before) showed the digits while Workday still called the field empty, however often it was repeated.
 * When typing leaves the part without the value (a plain input that ignores synthetic keys), the value is set
 * directly as a last resort.
 */
async function enterDatePart(input: HTMLInputElement, v: string): Promise<void> {
  const display = input.parentElement?.querySelector<HTMLElement>(SEL.datePartDisplay);
  press(display ?? input);
  input.focus();
  const start = input.value;
  for (const [i, ch] of [...v].entries()) {
    typeChar(input, ch, i === 0);
    await sleep(15);
  }
  if (Number(datePartValue(input)) !== Number(v)) {
    setNativeValue(input, v);
    if (Number(input.value) !== Number(v)) callReact(input, "onChange", { target: { ...input, value: v } });
  } else if (input.value !== start) {
    // A browser fires change when a typed-in input loses focus.
    input.dispatchEvent(new (win(input).Event)("change", { bubbles: true }));
  }
  blur(input);
  await sleep(40);
}

async function fillDate(c: HTMLElement, value: string): Promise<Result> {
  const date = parseDate(value);
  if (!date) return fail('Dates must be "YYYY-MM-DD", "YYYY-MM" or "YYYY" (or "MM/YYYY", "MM/DD/YYYY").');
  const month = date.month?.padStart(2, "0");
  const day = date.day?.padStart(2, "0");
  const parts: [HTMLInputElement, string][] = [];
  for (const [label, v] of [
    ["Month", month],
    ["Day", day],
    ["Year", date.year],
  ] as const) {
    const input = datePartInput(c, label);
    if (!input) continue;
    if (v === undefined) return fail(`This date needs a ${label.toLowerCase()}.`);
    parts.push([input, v]);
  }
  const enter = async () => {
    for (const [input, v] of parts) await enterDatePart(input, v);
    await settle(c.ownerDocument, 150, 1500);
  };
  await enter();
  // Seen live: a date field showing a "required" error took a second entry. One more pass when it still does.
  if (fieldError(c)) await enter();
  const readBack = dateValue(c) ?? "";
  const has = (p: "Month" | "Day" | "Year") => Boolean(datePartInput(c, p));
  const want = [has("Year") && date.year, has("Month") && month, has("Day") && day].filter(Boolean).join("-");
  return readBack === want
    ? { ok: true, readBack }
    : fail(
        "The page didn't take the date: its parts show " +
          `"${readBack || "nothing"}". Ask the user to type it (${parts.map(([, v]) => v).join("/")}).`,
        { readBack },
      );
}

// ---- file ---------------------------------------------------------------------------------------

export async function uploadFile(c: HTMLElement, file: File): Promise<Result> {
  if (fieldKind(c) !== "file") return fail("Not a file field.");
  const names = () => attachedFiles(c).map((f) => f.name);
  // Only a newly shown file counts: a same-named file left from a previous application must not pass.
  const before = new Set(attachedFiles(c).map((f) => f.nameEl));
  const done = () => attachedFiles(c).some((f) => !before.has(f.nameEl) && f.name.includes(file.name));
  const input = c.querySelector<HTMLInputElement>(SEL.fileInput);
  const w = win(c);
  const dt = new w.DataTransfer();
  dt.items.add(file);
  if (input) {
    try {
      input.files = dt.files;
    } catch {
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    }
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
  }
  if (!(await waitFor(done, 8000, 200))) {
    const zone = c.querySelector<HTMLElement>(SEL.fileDropZone);
    if (zone) {
      const handled = callReact(zone, "onDrop", { dataTransfer: dt });
      if (!handled) zone.dispatchEvent(new w.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    await waitFor(done, 20000, 250);
  }
  return done()
    ? { ok: true, readBack: names() }
    : fail("The upload did not appear in the field.", { readBack: names() });
}

// ---- removing selected values and attachments ----------------------------------------------------

export interface RemoveOutcome {
  ok: boolean;
  removed: string[];
  remaining: string[];
  notFound?: string[];
  error?: string;
}

interface Item {
  label: string;
  el: HTMLElement;
  remove: HTMLElement | null;
}

function chipItems(c: HTMLElement): Item[] {
  const own = [...c.querySelectorAll<HTMLElement>(SEL.chip)];
  const els = own.length ? own : [...c.querySelectorAll<HTMLElement>(SEL.chipInList)];
  return els.map((el) => ({
    label: text(el.querySelector(SEL.chipLabel) ?? el),
    el,
    remove: el.querySelector<HTMLElement>(SEL.chipRemove),
  }));
}

function fileItems(c: HTMLElement): Item[] {
  return attachedFiles(c).map((f) => ({
    label: f.name,
    el: f.row,
    remove: f.row.querySelector<HTMLElement>(SEL.fileRemove),
  }));
}

/** Press the confirm button of a delete/remove confirmation, if one appeared. */
export async function confirmRemoval(doc: Document): Promise<void> {
  const dialog = [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].find(
    (d) => isVisible(d) && /delete|remove/i.test(text(d)),
  );
  const button = dialog
    ? [...dialog.querySelectorAll<HTMLElement>("button,[role='button']")].find((b) =>
        /^(delete|remove|yes|ok|confirm)$/i.test(text(b)),
      )
    : undefined;
  if (button && !isSubmitControl(button)) {
    press(button);
    await settle(doc, 150, 1500);
  }
}

async function removeOne(c: HTMLElement, item: Item, gone: () => boolean): Promise<boolean> {
  const doc = c.ownerDocument;
  if (item.remove && !isSubmitControl(item.remove)) {
    press(item.remove);
    if (await waitFor(gone, 1500)) return true;
    await confirmRemoval(doc);
    if (await waitFor(gone, 1500)) return true;
    callReact(item.remove, "onClick", {});
    if (await waitFor(gone, 1500)) return true;
  }
  // Keyboard fallback: a focused pill is removed with Delete or Backspace.
  item.el.focus?.();
  key(item.el, "Delete");
  if (await waitFor(gone, 800)) return true;
  key(item.el, "Backspace");
  return Boolean(await waitFor(gone, 800));
}

/**
 * Remove selected values from a multi-select (e.g. Skills) or attached files from a file field. Workday
 * pre-fills both from the candidate's last application. `values` are matched like fill values (exact,
 * then a unique prefix, then a unique substring); without them, everything in the field is removed.
 */
export async function removeItems(ref: FieldRef, values?: string[] | null): Promise<RemoveOutcome> {
  const c = ref.container;
  const kind = ref.field.kind;
  if (kind !== "typeahead" && kind !== "file") {
    return {
      ok: false,
      removed: [],
      remaining: [],
      error: `remove_items works on multi-select (typeahead) and file fields; this is a ${kind} field. Use fill_fields to change it.`,
    };
  }
  const items = () => (kind === "file" ? fileItems(c) : chipItems(c));
  const current = items().map((i) => i.label);
  const notFound: string[] = [];
  const targets: string[] = [];
  for (const v of values ?? current) {
    const idx = matchOption(v, current);
    if (idx < 0) notFound.push(v);
    else targets.push(current[idx] as string);
  }

  const removed: string[] = [];
  const failed: string[] = [];
  for (const label of targets) {
    const matching = () => items().filter((i) => norm(i.label) === norm(label));
    const before = matching().length;
    const item = matching()[0];
    if (!item) continue;
    if (await removeOne(c, item, () => matching().length < before)) removed.push(label);
    else failed.push(label);
    await settle(c.ownerDocument, 150, 1500);
  }

  const remaining = items().map((i) => i.label);
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
