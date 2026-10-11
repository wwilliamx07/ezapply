import type { FillValue, OptionInfo } from "@ezapply/protocol";
import { callReact, isVisible, key, matchOption, norm, press, settle, sleep, text, waitFor } from "../../engine/dom.js";
import { T } from "../../engine/timing.js";
import { branch, describe, note, outside, tracing } from "../../engine/trace.js";
import type { FillOutcome, WidgetDriver } from "../../engine/types.js";
import { SEL } from "./selectors.js";

/** Workday's dropdown: a button that opens a listbox rendered as a portal under `body`. */

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));

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
  if (!(await waitFor(() => visibleListboxes(doc).length === 0, T.dropdownOthersClosedMs))) {
    for (const l of visibleListboxes(doc)) key(l, "Escape");
    await waitFor(() => visibleListboxes(doc).length === 0, T.dropdownAfterEscapeMs);
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
  let opened = await waitFor(listFor, T.dropdownOpenMs);
  if (!opened) {
    callReact(button, "onClick", {});
    opened = await waitFor(listFor, T.dropdownOpenRetryMs);
  }
  if (tracing()) {
    // Read outside the trace: these queries are the note's, not the adapter's.
    outside(() =>
      note("listbox", {
        shown: visibleListboxes(doc).map((l) => describe(l, false)),
        stale: stale.size,
        read: opened ? describe(opened.list, false) : null,
        options: opened ? opened.options.slice(0, 80).map(text) : [],
      }),
    );
  }
  return opened;
}

/**
 * Close the listbox and wait until it has gone, so the next dropdown can't mistake it for its own.
 *
 * `chose`: an option was just picked, which closes the list by itself. When nothing was (after reading the
 * options, or a value that matched nothing) the list has to be closed here. Live buttons have no
 * `aria-expanded` and Escape doesn't close a live listbox, so this used to do nothing, the list stayed open,
 * and the next dropdown's press only closed it: "Could not open the dropdown" (9 fields in the fifth live
 * run). So when Escape hasn't closed it within `dropdownEscapeCloseMs`, the dropdown's own button is pressed,
 * as a person would. After a choice the button isn't pressed without `aria-expanded` saying the list is
 * open: a list still animating away would open again.
 */
async function closeListbox({ button, list }: OpenListbox, chose: boolean): Promise<void> {
  const gone = () => !list.isConnected || !isVisible(list);
  const expanded = button.getAttribute("aria-expanded");
  if (expanded === "true" || (expanded === null && !chose && !gone())) {
    key(button, "Escape");
    await sleep(T.dropdownCloseKeyMs);
    const stillOpen =
      expanded === null
        ? !(await waitFor(gone, T.dropdownEscapeCloseMs))
        : button.getAttribute("aria-expanded") === "true";
    if (stillOpen) press(button);
  }
  await waitFor(gone, T.dropdownClosedMs);
}

/**
 * Open the listbox, and when it doesn't open, wait for the page to go quiet and try once more. In two live runs
 * a dropdown whose list had been read without a choice (`list_options`, or a value that matched nothing) failed
 * its next open with "Could not open the dropdown": 12 of 12 such dropdowns, and no other dropdown. The same
 * fill in the agent's next call worked every time, at a turn each. Why the first open fails isn't known; the
 * second attempt here is what the agent's retry did.
 */
async function openListboxRetrying(c: HTMLElement): Promise<OpenListbox | null> {
  const opened = await openListbox(c);
  if (opened) return opened;
  branch("dropdown re-open");
  await settle(c.ownerDocument, T.afterFieldQuietMs, T.afterFieldMaxMs);
  return openListbox(c);
}

async function listDropdown(c: HTMLElement): Promise<OptionInfo[]> {
  const opened = await openListboxRetrying(c);
  if (!opened) return [];
  const labels = opened.options.map((o) => ({ label: text(o) })).filter((o) => o.label);
  await closeListbox(opened, false);
  return labels;
}

async function fillDropdown(c: HTMLElement, value: string): Promise<FillOutcome> {
  const opened = await openListboxRetrying(c);
  if (!opened) return fail("Could not open the dropdown.");
  const labels = opened.options.map(text);
  const idx = matchOption(value, labels);
  if (idx < 0) {
    await closeListbox(opened, false);
    return fail(`No option matches "${value}".`, {
      availableOptions: labels.filter(Boolean).slice(0, 80),
    });
  }
  const option = opened.options[idx] as HTMLElement;
  const wanted = labels[idx] as string;
  press(option);
  const ok = await waitFor(() => norm(text(opened.button)) === norm(wanted), T.dropdownSelectMs);
  if (!ok) {
    callReact(option, "onClick", {});
    await waitFor(() => norm(text(opened.button)) === norm(wanted), T.dropdownSelectRetryMs);
  }
  await closeListbox(opened, true);
  const readBack = text(opened.button);
  return norm(readBack) === norm(wanted) ? { ok: true, readBack } : fail("Selection did not stick.", { readBack });
}

export const dropdownDriver: WidgetDriver = {
  kind: "dropdown",
  is: (c) => Boolean(dropdownButton(c)),
  value: (c) => {
    const t = text(dropdownButton(c));
    return /^select one$|^select$|^$/i.test(t) ? null : t;
  },
  lazyOptions: true,
  list: listDropdown,
  fill: (c, value) => fillDropdown(c, asString(value)),
};
