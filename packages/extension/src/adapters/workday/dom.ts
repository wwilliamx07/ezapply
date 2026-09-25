/**
 * DOM helpers for driving React-controlled widgets. This code runs in the page's MAIN world so it
 * can reach React's handlers when plain DOM events are not enough.
 */

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

/** jsdom has no layout; treat everything as visible there. */
export function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (
    typeof h.checkVisibility === "function" &&
    h.ownerDocument.defaultView?.navigator.userAgent.includes("jsdom") !== true
  ) {
    return h.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions);
  }
  return !h.closest("[hidden],[aria-hidden='true']");
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
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function blur(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur"));
}

/** Full pointer + mouse sequence; some widgets listen to mousedown rather than click. */
export function press(el: Element): void {
  const view = el.ownerDocument.defaultView ?? window;
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const Pointer = (view as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (Pointer) el.dispatchEvent(new Pointer("pointerdown", { ...opts, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  if (Pointer) el.dispatchEvent(new Pointer("pointerup", { ...opts, pointerType: "mouse" }));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

export function key(el: Element, k: string): void {
  const opts = { bubbles: true, cancelable: true, key: k, code: k === "Enter" ? "Enter" : k };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
}

/** Resolve once the DOM has been quiet for `quietMs`, or after `maxMs`. */
export function settle(doc: Document, quietMs = 250, maxMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const hard = setTimeout(done, maxMs);
    const obs = new MutationObserver(() => {
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
export async function waitFor<T>(fn: () => T | null | undefined | false, maxMs = 3000, stepMs = 50): Promise<T | null> {
  const end = Date.now() + maxMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(stepMs);
  }
}

/** Best match of `wanted` among `options`: exact, case-insensitive, prefix, then unique substring. */
export function matchOption(wanted: string, options: string[]): number {
  const w = norm(wanted).toLowerCase();
  const n = options.map((o) => norm(o).toLowerCase());
  let i = n.indexOf(w);
  if (i >= 0) return i;
  i = n.findIndex((o) => o.startsWith(w) || w.startsWith(o));
  if (i >= 0 && n.filter((o) => o.startsWith(w) || w.startsWith(o)).length === 1) return i;
  const contains = n.map((o, idx) => (o.includes(w) ? idx : -1)).filter((x) => x >= 0);
  return contains.length === 1 ? (contains[0] as number) : -1;
}
