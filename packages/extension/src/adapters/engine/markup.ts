import { isVisible } from "./dom.js";
import { lastPopup, outside, POPUPS } from "./trace.js";

/**
 * Debug mode's markup snapshots (`debug.markup`): the page as the adapter saw it, to read where its picture of the
 * page and the real page diverged, and to turn into a test fixture (`ezapply debug export`). Taken only when the
 * companion asks, outside the trace's timed part where it can be: before the call, after it, and at a failed field.
 *
 * Cleaned of what a fixture can't use and the snapshot shouldn't carry: scripts, styles, stylesheet links, SVG
 * contents and inline event handlers. Values are kept, since debugging needs them: an input's value, a box's
 * checked state and a list's selection are written into the copy's attributes, where the live page keeps them in
 * properties. Password inputs never keep theirs. A shadow root's contents aren't in a copy.
 */

const DROP = "script, style, link, noscript";
const VALUES = "input, textarea, select";

/** A cleaned copy of `root`'s markup, with the live values written in. */
export function cleanMarkup(root: Element): string {
  return outside(() => {
    const copy = root.cloneNode(true) as Element;
    const live = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(VALUES);
    const copied = copy.querySelectorAll<HTMLElement>(VALUES);
    live.forEach((el, i) => {
      const c = copied[i];
      if (c) writeValue(el, c);
    });
    for (const el of copy.querySelectorAll(DROP)) el.remove();
    for (const svg of copy.querySelectorAll("svg")) svg.replaceChildren();
    for (const el of [copy, ...copy.querySelectorAll("*")]) {
      for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    }
    return copy.outerHTML;
  });
}

function writeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, copy: HTMLElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") {
    copy.textContent = (el as HTMLTextAreaElement).value;
  } else if (tag === "select") {
    const options = copy.querySelectorAll("option");
    [...(el as HTMLSelectElement).options].forEach((o, i) => {
      if (o.selected) options[i]?.setAttribute("selected", "");
      else options[i]?.removeAttribute("selected");
    });
  } else {
    const input = el as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (input.checked) copy.setAttribute("checked", "");
      else copy.removeAttribute("checked");
    } else if (type === "password") {
      copy.removeAttribute("value");
    } else if (type !== "file") {
      if (input.value) copy.setAttribute("value", input.value);
      else copy.removeAttribute("value");
    }
  }
}

/** The whole page, cleaned. */
export function pageMarkup(doc: Document): string {
  return `<!doctype html>\n${cleanMarkup(doc.documentElement)}\n`;
}

/** Elements under a field that make a section too large to be worth a snapshot of its own. */
const MAX_SECTION_ELEMENTS = 4000;

/**
 * A failed field's snapshot: its section (the nearest fieldset, section, group, region or form around it, else two
 * levels up), every popup or listbox open on screen now, and the last one the page took away during the field
 * (a dropdown's list closes before its fill returns).
 */
export function failureMarkup(container: HTMLElement): string {
  return outside(() => {
    const doc = container.ownerDocument;
    let section: Element =
      container.closest("fieldset, section, [role='group'], [role='region'], form") ??
      container.parentElement?.parentElement ??
      container;
    if (section === doc.body || section.getElementsByTagName("*").length > MAX_SECTION_ELEMENTS) section = container;
    const parts = [`<!-- the field's section -->\n${cleanMarkup(section)}`];
    for (const popup of doc.querySelectorAll(POPUPS)) {
      if (isVisible(popup)) parts.push(`<!-- open on screen -->\n${cleanMarkup(popup)}`);
    }
    const gone = lastPopup();
    if (gone && !gone.isConnected)
      parts.push(`<!-- the last popup the page closed during this field -->\n${cleanMarkup(gone)}`);
    return `${parts.join("\n")}\n`;
  });
}
