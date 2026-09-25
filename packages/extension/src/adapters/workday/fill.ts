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
  waitFor,
} from "./dom.js";
import { type FieldRef, fieldKind, optionLabel } from "./extract.js";
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

async function openListbox(c: HTMLElement): Promise<{ button: HTMLElement; options: HTMLElement[] } | null> {
  const button = dropdownButton(c);
  if (!button) return null;
  const doc = c.ownerDocument;
  const listFor = () => {
    const id = button.getAttribute("aria-controls");
    const list = id ? doc.getElementById(id) : null;
    const scoped = list ?? [...doc.querySelectorAll<HTMLElement>('[role="listbox"]')].find(isVisible) ?? null;
    const opts = scoped ? [...scoped.querySelectorAll<HTMLElement>('[role="option"], li')] : [];
    return opts.length ? opts : null;
  };
  if (button.getAttribute("aria-expanded") !== "true") press(button);
  let options = await waitFor(listFor, 2000);
  if (!options) {
    callReact(button, "onClick", {});
    options = await waitFor(listFor, 2000);
  }
  return options ? { button, options } : null;
}

async function closeListbox(button: HTMLElement): Promise<void> {
  if (button.getAttribute("aria-expanded") === "true") {
    key(button, "Escape");
    await sleep(50);
    if (button.getAttribute("aria-expanded") === "true") press(button);
  }
}

export async function listDropdown(c: HTMLElement): Promise<OptionInfo[]> {
  const opened = await openListbox(c);
  if (!opened) return [];
  const labels = opened.options.map((o) => ({ label: text(o) })).filter((o) => o.label);
  await closeListbox(opened.button);
  return labels;
}

async function fillDropdown(c: HTMLElement, value: string): Promise<Result> {
  const opened = await openListbox(c);
  if (!opened) return fail("Could not open the dropdown.");
  const labels = opened.options.map(text);
  const idx = matchOption(value, labels);
  if (idx < 0) {
    await closeListbox(opened.button);
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
  await closeListbox(opened.button);
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

function promptOptions(c: HTMLElement): HTMLElement[] {
  const popup = promptPopup(c);
  const scope: ParentNode = popup ?? c.ownerDocument;
  return [...scope.querySelectorAll<HTMLElement>(SEL.promptOption)].filter(isVisible);
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

async function typeQuery(c: HTMLElement, query: string): Promise<HTMLInputElement | null> {
  const input = c.querySelector<HTMLInputElement>(`${within(SEL.multiSelect, "input")}, input`);
  if (!input) return null;
  input.focus();
  press(input);
  setNativeValue(input, query);
  key(input, "Enter");
  await settle(c.ownerDocument, 300, 2500);
  if (promptOptions(c).length === 0) {
    callReact(input, "onKeyDown", { key: "Enter", target: { value: query } });
    await settle(c.ownerDocument, 300, 2500);
  }
  return input;
}

export async function searchTypeahead(c: HTMLElement, query: string): Promise<OptionInfo[]> {
  await typeQuery(c, query);
  const out = promptOptions(c).map(optionInfo);
  key(c.querySelector("input") ?? c, "Escape");
  return out;
}

export async function listTypeahead(c: HTMLElement): Promise<OptionInfo[]> {
  const input = c.querySelector<HTMLElement>(`${within(SEL.multiSelect, "input")}, input`);
  if (!input) return [];
  press(input);
  await settle(c.ownerDocument, 300, 2500);
  const out = promptOptions(c).map(optionInfo);
  key(input, "Escape");
  return out;
}

/**
 * Each value may be a path through nested menus: "Job Board > LinkedIn". The last segment is the
 * item to select; earlier ones open categories.
 */
async function fillTypeahead(c: HTMLElement, values: string[]): Promise<Result> {
  for (const value of values) {
    const path = value
      .split(/\s*>\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const leaf = path.at(-1) ?? value;
    if (selectedItems(c).some((s) => norm(s).toLowerCase() === norm(leaf).toLowerCase())) continue;

    if (path.length > 1) {
      const input = c.querySelector<HTMLElement>(`${within(SEL.multiSelect, "input")}, input`);
      if (input) press(input);
      await settle(c.ownerDocument, 300, 2500);
    } else {
      await typeQuery(c, leaf);
    }

    for (const [i, segment] of path.entries()) {
      const options = await waitFor(() => {
        const o = promptOptions(c);
        return o.length ? o : null;
      }, 2500);
      if (!options) return fail(`No options appeared while selecting "${value}".`, { readBack: selectedItems(c) });
      const labels = options.map(text);
      const idx = matchOption(segment, labels);
      if (idx < 0) {
        return fail(`No option matches "${segment}".`, {
          availableOptions: labels.slice(0, 80),
          readBack: selectedItems(c),
        });
      }
      const option = options[idx] as HTMLElement;
      press(option);
      await settle(c.ownerDocument, 250, 2000);
      if (i === path.length - 1 && !selectedItems(c).some((s) => norm(s) === norm(labels[idx]))) {
        callReact(option, "onClick", {});
        await settle(c.ownerDocument, 250, 2000);
      }
    }
  }
  key(c.querySelector("input") ?? c, "Escape");
  const readBack = selectedItems(c);
  const missing = values
    .map((v) => v.split(/\s*>\s*/).at(-1) ?? v)
    .filter((leaf) => !readBack.some((s) => norm(s).toLowerCase().includes(norm(leaf).toLowerCase())));
  return missing.length === 0 ? { ok: true, readBack } : fail(`Not selected: ${missing.join(", ")}`, { readBack });
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

async function fillDate(c: HTMLElement, value: string): Promise<Result> {
  const m = value.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return fail('Dates must be "YYYY", "YYYY-MM" or "YYYY-MM-DD".');
  const [, year, month, day] = m;
  const parts: [string, string | undefined][] = [
    ["Month", month?.padStart(2, "0")],
    ["Day", day?.padStart(2, "0")],
    ["Year", year],
  ];
  for (const [label, v] of parts) {
    const input = c.querySelector<HTMLInputElement>(`input[aria-label="${label}" i]`);
    if (!input) continue;
    if (v === undefined) return fail(`This date needs a ${label.toLowerCase()}.`);
    input.focus();
    setNativeValue(input, v);
    if (Number(input.value) !== Number(v)) {
      callReact(input, "onChange", { target: { ...input, value: v } });
    }
    blur(input);
    await sleep(40);
  }
  await settle(c.ownerDocument, 150, 1500);
  const readBack = [
    c.querySelector<HTMLInputElement>('input[aria-label="Year" i]')?.value,
    c.querySelector<HTMLInputElement>('input[aria-label="Month" i]')?.value,
    c.querySelector<HTMLInputElement>('input[aria-label="Day" i]')?.value,
  ]
    .filter((p) => p)
    .map((p) => (p as string).padStart(2, "0"))
    .join("-");
  const want = [year, month?.padStart(2, "0"), day?.padStart(2, "0")].filter(Boolean).join("-");
  return readBack === want ? { ok: true, readBack } : fail("The date was not accepted.", { readBack });
}

// ---- file ---------------------------------------------------------------------------------------

export async function uploadFile(c: HTMLElement, file: File): Promise<Result> {
  if (fieldKind(c) !== "file") return fail("Not a file field.");
  const names = () => [...c.querySelectorAll(SEL.fileItem)].map(text).filter(Boolean);
  const done = () => names().some((n) => n.includes(file.name));
  const input = c.querySelector<HTMLInputElement>(SEL.fileInput);
  const dt = new DataTransfer();
  dt.items.add(file);
  if (input) {
    try {
      input.files = dt.files;
    } catch {
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (!(await waitFor(done, 8000, 200))) {
    const zone = c.querySelector<HTMLElement>(SEL.fileDropZone);
    if (zone) {
      const handled = callReact(zone, "onDrop", { dataTransfer: dt });
      if (!handled) zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    await waitFor(done, 20000, 250);
  }
  return done()
    ? { ok: true, readBack: names() }
    : fail("The upload did not appear in the field.", { readBack: names() });
}
