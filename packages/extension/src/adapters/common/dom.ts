/**
 * DOM helpers for driving React- and Knockout-controlled widgets, shared by the site adapters. This code runs
 * in the page's MAIN world so it can reach React's handlers when plain DOM events are not enough.
 *
 * Constructors (events, observers, element prototypes) come from the element's own window, never from
 * globals, so the adapter works on any document: the page's, a jsdom test window, or a jsdom created in
 * a Node test that isn't a DOM environment at all.
 */

import { T } from "./timing.js";

/** The window a node belongs to. */
export function win(node: Node): Window & typeof globalThis {
  const view = (node.ownerDocument ?? (node as Document)).defaultView;
  if (!view) throw new Error("The element is not in a window.");
  return view as Window & typeof globalThis;
}

/** CSS.escape with a fallback for environments that lack it (jsdom). */
export function cssEscape(s: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Label text without required markers. */
export function cleanLabel(s: string | null | undefined): string {
  return norm(s)
    .replace(/\s*\*\s*$/, "")
    .replace(/\s*\(required\)\s*$/i, "")
    .trim();
}

export function slug(s: string): string {
  return (
    norm(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "x"
  );
}

export function text(el: Element | null | undefined): string {
  if (!el) return "";
  const t = (el as HTMLElement).innerText;
  return norm(typeof t === "string" && t.length > 0 ? t : el.textContent);
}

/**
 * jsdom has no layout: there an element counts as visible unless it or an ancestor is `hidden`, `aria-hidden`
 * or has an inline `display: none` (how a saved page keeps its hidden sections and dialogs).
 */
export function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (
    typeof h.checkVisibility === "function" &&
    h.ownerDocument.defaultView?.navigator.userAgent.includes("jsdom") !== true
  ) {
    return h.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions);
  }
  if (h.closest("[hidden],[aria-hidden='true']")) return false;
  for (let e: HTMLElement | null = h; e; e = e.parentElement) if (e.style?.display === "none") return false;
  return true;
}

/** React stores props on the DOM node under a randomised key. Only visible from the MAIN world. */
export function reactProps(el: Element): Record<string, unknown> | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith("__reactProps$")) return (el as unknown as Record<string, Record<string, unknown>>)[key] ?? null;
  }
  return null;
}

export function callReact(el: Element, handler: string, event: Record<string, unknown>): boolean {
  const fn = reactProps(el)?.[handler];
  if (typeof fn !== "function") return false;
  (fn as (e: unknown) => void)({
    preventDefault() {},
    stopPropagation() {},
    persist() {},
    target: el,
    currentTarget: el,
    nativeEvent: {},
    ...event,
  });
  return true;
}

/** Set an input's value past React's instance-level value tracker, then notify. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const w = win(el);
  const proto = el instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
}

export function blur(el: HTMLElement): void {
  const w = win(el);
  el.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true }));
  el.dispatchEvent(new w.FocusEvent("blur"));
}

/** Full pointer + mouse sequence; some widgets listen to mousedown rather than click. */
export function press(el: Element): void {
  const w = win(el);
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  // jsdom has no PointerEvent.
  const Pointer = (w as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (Pointer) el.dispatchEvent(new Pointer("pointerdown", { ...opts, pointerType: "mouse" }));
  el.dispatchEvent(new w.MouseEvent("mousedown", opts));
  if (Pointer) el.dispatchEvent(new Pointer("pointerup", { ...opts, pointerType: "mouse" }));
  el.dispatchEvent(new w.MouseEvent("mouseup", opts));
  el.dispatchEvent(new w.MouseEvent("click", opts));
}

export function key(el: Element, k: string): void {
  const w = win(el);
  const opts = { bubbles: true, cancelable: true, key: k, code: k === "Enter" ? "Enter" : k };
  el.dispatchEvent(new w.KeyboardEvent("keydown", opts));
  el.dispatchEvent(new w.KeyboardEvent("keyup", opts));
}

/** Resolve once the DOM has been quiet for `quietMs`, or after `maxMs`. */
export function settle(doc: Document, quietMs = 250, maxMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const hard = setTimeout(done, maxMs);
    const obs = new (win(doc).MutationObserver)(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    obs.observe(doc.body, { subtree: true, childList: true, attributes: true, characterData: true });
    function done() {
      clearTimeout(timer);
      clearTimeout(hard);
      obs.disconnect();
      resolve();
    }
  });
}

/** Poll for a condition (cheap and robust against portals re-rendering). */
export async function waitFor<R>(
  fn: () => R | null | undefined | false,
  maxMs = 3000,
  stepMs = T.pollMs,
): Promise<R | null> {
  const end = Date.now() + maxMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(stepMs);
  }
}

/**
 * Best match of `wanted` among `options`, case-insensitive: exact; the label without a trailing parenthetical,
 * or the parenthetical itself ("Python" → "Python (Programming Language)", "SQL" → "Structured Query Language
 * (SQL)"); a prefix either way; a substring. Each rule after the exact one must single out one label: Workday
 * lists some options twice, so labels are counted once.
 */
export function matchOption(wanted: string, options: string[]): number {
  const w = norm(wanted).toLowerCase();
  const n = options.map((o) => norm(o).toLowerCase());
  const exact = n.indexOf(w);
  if (exact >= 0 || !w) return exact;
  const unique = (pred: (o: string) => boolean): number => {
    const hits = n.map((o, i) => (o && pred(o) ? i : -1)).filter((i) => i >= 0);
    return new Set(hits.map((i) => n[i])).size === 1 ? (hits[0] as number) : -1;
  };
  const bare = (o: string) => o.replace(/\s*\([^)]*\)$/, "");
  const paren = (o: string) => /\(([^)]*)\)$/.exec(o)?.[1];
  const rules: ((o: string) => boolean)[] = [
    (o) => bare(o) === w || paren(o) === w,
    (o) => o.startsWith(w) || w.startsWith(o),
    (o) => o.includes(w),
  ];
  for (const rule of rules) {
    const i = unique(rule);
    if (i >= 0) return i;
  }
  return -1;
}

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
 * Type one character as a browser would: keydown and keypress, then, unless the page handled the key itself
 * (widgets such as Workday's date parts take digits in keydown and prevent the default), beforeinput and
 * input with the character inserted, then keyup. `replace` starts over instead of appending, as typing
 * into a selected value does.
 */
export function typeChar(el: HTMLInputElement, ch: string, replace: boolean): void {
  const w = win(el);
  const code = /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;
  const keyCode = ch.toUpperCase().charCodeAt(0);
  const opts = { bubbles: true, cancelable: true, key: ch, code, keyCode, which: keyCode, charCode: 0 };
  const down = new w.KeyboardEvent("keydown", opts);
  const handled = !el.dispatchEvent(down);
  const press = new w.KeyboardEvent("keypress", { ...opts, charCode: ch.charCodeAt(0) });
  const handledPress = !el.dispatchEvent(press);
  if (!handled && !handledPress) {
    const Input = (w as unknown as { InputEvent?: typeof InputEvent }).InputEvent ?? w.Event;
    const init = { bubbles: true, cancelable: true, inputType: "insertText", data: ch };
    if (el.dispatchEvent(new Input("beforeinput", init))) {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")?.set;
      const next = replace ? ch : el.value + ch;
      if (setter) setter.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Input("input", { ...init, cancelable: false }));
    }
  }
  el.dispatchEvent(new w.KeyboardEvent("keyup", opts));
}
