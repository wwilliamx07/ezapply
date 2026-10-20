import type { FillValue } from "@ezapply/protocol";
import { blur, callReact, cssEscape, matchOption, press, setNativeValue, sleep, text, waitFor, win } from "../dom.js";
import { choiceLabel as defaultLabel } from "../standard.js";
import { T } from "../timing.js";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "../types.js";

/**
 * Drivers for plain HTML controls: text inputs and textareas, `<select>`, radio and checkbox groups, a single
 * checkbox, date inputs, and passwords (recognised, never filled). Each works on a field container holding the
 * control; React-controlled inputs are set past React's value tracker, with React's own handler as a fallback.
 * A site whose controls differ passes options (how a choice is labelled, what's tried when a press doesn't take)
 * rather than keeping its own copy.
 */

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));

const TEXT_INPUT =
  "input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='url'], input[type='number']";

/** The same digits: a page that formats what's typed (`416-555-0100` shown as `(416) 555-0100`) took it. */
const sameDigits = (a: string, b: string) => {
  const d = (s: string) => s.replace(/\D/g, "");
  return d(a).length >= 7 && d(a) === d(b);
};

type TextInput = HTMLInputElement | HTMLTextAreaElement;

export interface TextOptions {
  /** The control in the field container (default: by kind). */
  selector?: string;
  /** How the control is left after typing, so the page validates it (default: `blur`'s focus events). */
  leave?: (input: TextInput) => void;
  /** When the value didn't take, set it and call React's onChange and onBlur (default: true). */
  react?: boolean;
}

async function setText(input: TextInput, value: string, opts: TextOptions = {}): Promise<FillOutcome> {
  if (input.readOnly) return fail("This field is read-only on the page.", { readBack: input.value });
  input.focus();
  setNativeValue(input, value);
  (opts.leave ?? blur)(input);
  await sleep(T.textCheckMs);
  const took = () => input.value === value || (input.type === "tel" && sameDigits(input.value, value));
  if (!took() && opts.react !== false) {
    // Fallback: drive React's handlers directly.
    input.value = value;
    callReact(input, "onChange", { target: input });
    callReact(input, "onBlur", { target: input });
    await sleep(T.textCheckMs);
  }
  return took()
    ? { ok: true, readBack: input.value }
    : fail("The page did not accept the value.", { readBack: input.value });
}

/**
 * A text, email, tel, url or number input, or a textarea, found in the container by `selector` (a string is the
 * selector alone).
 */
export function textDriver(kind: "text" | "number" | "textarea", options: string | TextOptions = {}): WidgetDriver {
  const opts = typeof options === "string" ? { selector: options } : options;
  const sel =
    opts.selector ?? (kind === "textarea" ? "textarea" : kind === "number" ? "input[type='number']" : TEXT_INPUT);
  const control = (c: HTMLElement) => (c.matches(sel) ? (c as TextInput) : c.querySelector<TextInput>(sel));
  return {
    kind,
    is: (c) => Boolean(control(c)),
    value: (c) => control(c)?.value ?? "",
    fill: async (c, value) => {
      const input = control(c);
      return input ? setText(input, asString(value), opts) : fail("No input found in the field.");
    },
  };
}

/** A password field: recognised so it's never mistaken for text, and never filled. */
export const passwordDriver: WidgetDriver = {
  kind: "password",
  is: (c) => Boolean(c.querySelector('input[type="password"]')),
  value: (c) => (c.querySelector<HTMLInputElement>('input[type="password"]')?.value ? "••••" : ""),
  fill: async () => fail("Password fields are never filled by ezapply. Ask the user to type it."),
};

/**
 * A native `<select>`. An option with an empty value ("Select...") is the placeholder, not a choice.
 *
 * `settled`: for a React-controlled list that puts the old value back at once and takes the new one a moment later
 * (Phenom's, seen live): set it past React's tracker, then wait for the read-back, without calling React's handler
 * directly (by then it would read the old value back and keep it).
 */
export function selectDriver(opts: { settled?: boolean } = {}): WidgetDriver {
  const select = (c: HTMLElement) => (c.matches("select") ? (c as HTMLSelectElement) : c.querySelector("select"));
  const choices = (s: HTMLSelectElement) => [...s.options].filter((o) => o.value !== "" && text(o) !== "");
  return {
    kind: "dropdown",
    is: (c) => Boolean(select(c)),
    value: (c) => {
      const s = select(c);
      const o = s?.selectedOptions[0];
      return o && o.value !== "" ? text(o) : null;
    },
    options: (c) => {
      const s = select(c);
      return s ? choices(s).map(text) : undefined;
    },
    fill: async (c, value) => {
      const s = select(c);
      if (!s) return fail("No list found in the field.");
      const options = choices(s);
      const labels = options.map(text);
      const idx = matchOption(asString(value), labels);
      if (idx < 0) {
        return fail(`No option matches "${asString(value)}".`, { availableOptions: labels });
      }
      const w = win(s);
      const chosen = (options[idx] as HTMLOptionElement).value;
      const setter = opts.settled
        ? Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, "value")?.set
        : undefined;
      if (setter) setter.call(s, chosen);
      else s.value = chosen;
      s.dispatchEvent(new w.Event("input", { bubbles: true }));
      s.dispatchEvent(new w.Event("change", { bubbles: true }));
      const shown = () => (s.selectedOptions[0] ? text(s.selectedOptions[0]) : "");
      if (opts.settled) await waitFor(() => shown() === labels[idx], T.checkMs);
      else {
        callReact(s, "onChange", { target: s });
        await sleep(T.textCheckMs);
      }
      const readBack = shown();
      return readBack === labels[idx] ? { ok: true, readBack } : fail("Selection did not stick.", { readBack });
    },
  };
}

const checked = (i: HTMLInputElement) => i.checked || i.getAttribute("aria-checked") === "true";

interface ChoiceOptions {
  /** An option's label (default: its `<label for>`, the label around it, or its value). */
  label?: (input: HTMLInputElement) => string;
  /**
   * What's tried when pressing the input didn't change it: press its label (a visually hidden input; the
   * default), call React's onChange (and a radio's onClick) with the state wanted, or nothing.
   */
  fallback?: "label" | "react" | "none";
}

async function setChecked(box: HTMLInputElement, want: boolean, fallback: ChoiceOptions["fallback"]): Promise<boolean> {
  if (checked(box) === want) return true;
  press(box);
  if (await waitFor(() => checked(box) === want, T.checkMs)) return true;
  if (fallback === "none") return false;
  if (fallback === "react") {
    callReact(box, "onChange", { target: { ...box, checked: want, value: box.value } });
    if (box.type === "radio") callReact(box, "onClick", {});
  } else {
    // A visually hidden input: its label takes the click.
    const label =
      box.closest("label") ?? (box.id ? box.ownerDocument.querySelector(`label[for="${cssEscape(box.id)}"]`) : null);
    if (label) press(label);
  }
  return Boolean(await waitFor(() => checked(box) === want, T.checkMs));
}

/** Radio buttons: one choice among options labelled by their own labels. */
export function radioDriver(opts: ChoiceOptions = {}): WidgetDriver {
  const choiceLabel = opts.label ?? defaultLabel;
  const radios = (c: HTMLElement) => [...c.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  return {
    kind: "radio",
    is: (c) => radios(c).length > 0,
    value: (c) => {
      const on = radios(c).find(checked);
      return on ? choiceLabel(on) : null;
    },
    options: (c) => radios(c).map(choiceLabel),
    fill: async (c, value) => {
      const all = radios(c);
      const labels = all.map(choiceLabel);
      const idx = matchOption(asString(value), labels);
      if (idx < 0) return fail(`No option matches "${asString(value)}".`, { availableOptions: labels });
      return (await setChecked(all[idx] as HTMLInputElement, true, opts.fallback))
        ? { ok: true, readBack: labels[idx] as string }
        : fail("Selection did not stick.");
    },
  };
}

/** A single checkbox (an agreement): true ticks it, false unticks it. */
export function checkboxDriver(opts: Pick<ChoiceOptions, "fallback"> = {}): WidgetDriver {
  const box = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="checkbox"]');
  return {
    kind: "checkbox",
    is: (c) => c.querySelectorAll('input[type="checkbox"]').length === 1,
    value: (c) => {
      const b = box(c);
      return Boolean(b && checked(b));
    },
    fill: async (c, value) => {
      const b = box(c);
      if (!b) return fail("No checkbox found.");
      const want = value === true || /^(true|yes|checked)$/i.test(String(value));
      return (await setChecked(b, want, opts.fallback))
        ? { ok: true, readBack: want }
        : fail("Checkbox did not change.");
    },
  };
}

/** Several checkboxes, each an option: filling ticks exactly the options named. */
export function checkboxGroupDriver(opts: ChoiceOptions = {}): WidgetDriver {
  const choiceLabel = opts.label ?? defaultLabel;
  const boxes = (c: HTMLElement) => [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  return {
    kind: "checkbox-group",
    is: (c) => boxes(c).length > 1,
    value: (c) => boxes(c).filter(checked).map(choiceLabel),
    options: (c) => boxes(c).map(choiceLabel),
    multiple: () => true,
    fill: async (c, value) => {
      const all = boxes(c);
      const labels = all.map(choiceLabel);
      const targets = new Set<number>();
      for (const w of Array.isArray(value) ? value : [asString(value)]) {
        const idx = matchOption(w, labels);
        if (idx < 0) return fail(`No option matches "${w}".`, { availableOptions: labels });
        targets.add(idx);
      }
      for (const [i, b] of all.entries()) await setChecked(b, targets.has(i), opts.fallback);
      const readBack = all.filter(checked).map(choiceLabel);
      return readBack.length === targets.size
        ? { ok: true, readBack }
        : fail("Some boxes did not change.", { readBack });
    },
    remove: async (c, values): Promise<RemoveOutcome> => {
      const on = boxes(c).filter(checked);
      const current = on.map(choiceLabel);
      const notFound = (values ?? []).filter((v) => matchOption(v, current) < 0);
      const targets = (values ?? current).map((v) => matchOption(v, current)).filter((i) => i >= 0);
      const removed: string[] = [];
      for (const i of targets)
        if (await setChecked(on[i] as HTMLInputElement, false, opts.fallback)) removed.push(current[i] as string);
      const remaining = boxes(c).filter(checked).map(choiceLabel);
      const ok = removed.length === targets.length && !notFound.length;
      return {
        ok,
        removed,
        remaining,
        ...(notFound.length ? { notFound } : {}),
        ...(ok
          ? {}
          : { error: notFound.length ? `Not selected: ${notFound.join(", ")}.` : "Some boxes did not change." }),
      };
    },
  };
}

/** A native date or month input: takes `YYYY-MM-DD` or `YYYY-MM`. */
export function dateInputDriver(): WidgetDriver {
  const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="date"], input[type="month"]');
  return {
    kind: "date",
    is: (c) => Boolean(input(c)),
    value: (c) => input(c)?.value || null,
    dateParts: (c) => (input(c)?.type === "month" ? ["MM", "YYYY"] : ["MM", "DD", "YYYY"]),
    fill: async (c, value) => {
      const i = input(c);
      if (!i) return fail("No date input found.");
      const v = asString(value).trim();
      const want = i.type === "month" ? v.slice(0, 7) : v;
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(want) || (i.type === "date" && want.length !== 10)) {
        return fail(i.type === "month" ? 'This date takes "YYYY-MM".' : 'This date takes "YYYY-MM-DD".');
      }
      return setText(i, want);
    },
  };
}
