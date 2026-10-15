import {
  answersQuery,
  callReact,
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
  win,
} from "@ezapply/engine/dom";
import { T } from "@ezapply/engine/timing";
import { branch, note, tracing } from "@ezapply/engine/trace";
import type { FillOutcome, WidgetDriver } from "@ezapply/engine/types";
import type { FillValue, OptionInfo } from "@ezapply/protocol";
import { SEL } from "./selectors.js";

/**
 * Oracle's cx-select: a combobox whose options show in a grid, all of them on opening or as search results while
 * typing (some searched on the server), or free text with suggestions (auto-suggest). The date parts use it too.
 */

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
const same = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase();
const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));

export function comboInput(c: HTMLElement): HTMLInputElement | null {
  return c.querySelector<HTMLInputElement>(SEL.comboInput);
}

/** Leave a control as a person does, so the page validates it: focus moves away. */
export function leave(el: HTMLElement): void {
  if (el.ownerDocument.activeElement === el) el.blur();
  else {
    const w = win(el);
    el.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new w.FocusEvent("blur"));
  }
}

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
 * Type a query and wait for the list to show its results: options that differ from those before, one of them
 * holding the query, or "no results" (one already showing before the query is the list still loading). Long lists
 * (countries, cities, postal codes) search as you type, some of them on the server.
 *
 * Seen live on a city and a postal code: typing first re-renders the whole unfiltered list, and the server search
 * runs about half a second later. Taking that list for the results failed the field and closed the list before
 * the search ran. The widget searches only when the text changes, and it keeps the last text typed even after the
 * list closes, so typing the same value again searched nothing, at every later attempt. When no results come, the
 * text is cleared, left for the widget to take (`typeaheadClearMs`), and typed again. (Results that don't hold the
 * query cost the same: both waits run out before they're read.)
 */
async function typeQuery(field: HTMLInputElement, query: string): Promise<void> {
  const busy = () => comboList(live(field))?.getAttribute("aria-busy") === "true";
  await waitFor(() => !busy(), T.typeaheadResultsMs, 100);
  const input = live(field);
  const before = signature(input);
  const emptyBefore = noResults(input);
  const done = () => {
    const now = live(field);
    if (busy()) return false;
    if (noResults(now)) return !emptyBefore;
    const labels = comboOptions(now).map(optionText);
    return labels.length > 0 && labels.join("\u0001") !== before && answersQuery(labels, query);
  };
  input.focus();
  setNativeValue(input, query);
  if (!(await waitFor(done, T.typeaheadResultsMs, 100))) {
    branch("typeahead search again", { query });
    setNativeValue(live(field), "");
    await sleep(T.typeaheadClearMs);
    setNativeValue(live(field), query);
    await waitFor(done, T.typeaheadResultsMs, 100);
  }
  await settle(input.ownerDocument, T.typeaheadResultsQuietMs, T.typeaheadResultsMaxMs);
}

/**
 * The option for the first candidate that matches one exactly, else the closest match of the first.
 */
function pick(candidates: string[], labels: string[]): number {
  for (const c of candidates) {
    const i = labels.findIndex((l) => same(l, c));
    if (i >= 0) return i;
  }
  return matchOption(candidates[0] ?? "", labels);
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
export async function fillCombo(field: HTMLInputElement, candidates: string[]): Promise<FillOutcome> {
  const value = candidates[0] ?? "";
  const input = () => live(field);
  if (input().readOnly) return fail("This field is read-only on the page.", { readBack: input().value });
  if (candidates.some((c) => shows(input().value, c))) return { ok: true, readBack: input().value };
  // A list that didn't show by itself may still show when searched: live, a school list failed to open twice
  // within the open waits, while `search_options` on it, which types whatever the open did, found the school.
  const opened = await openCombo(input());
  let labels = comboOptions(input()).map(optionText);
  if (tracing()) note("list", { options: labels.slice(0, 80) });
  let idx = pick(candidates, labels);
  // Search by the value, then by its first part: a server-side search finds "K2K 3E9" but not the full label
  // "K2K 3E9, Kanata, Ontario" (seen live).
  const queries = [...new Set([value, value.split(",")[0]?.trim() ?? ""])].filter(Boolean);
  for (const query of queries) {
    if (idx >= 0) break;
    branch("search the list", { query });
    await typeQuery(input(), query);
    labels = comboOptions(input()).map(optionText);
    idx = pick(candidates, labels);
  }
  if (idx < 0) {
    if (!opened && !labels.length && !noResults(input())) {
      await closeCombo(input());
      return fail("Could not open the list.");
    }
    if (input().classList.contains(SEL.comboAutoSuggest)) {
      await closeCombo(input());
      return same(input().value, value)
        ? { ok: true, readBack: input().value }
        : fail("The page did not keep the text.", { readBack: input().value });
    }
    await closeCombo(input());
    return fail(`No option matches "${value}".`, {
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

async function listCombo(c: HTMLElement): Promise<OptionInfo[]> {
  const input = await waitFor(() => comboInput(c), T.dropdownOpenMs);
  if (!input || !(await openCombo(input))) return [];
  const out = comboOptions(input)
    .map((o) => ({ label: optionText(o) }))
    .filter((o) => o.label);
  await closeCombo(input);
  return out;
}

async function searchCombo(c: HTMLElement, query: string): Promise<OptionInfo[]> {
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

export const comboDriver: WidgetDriver = {
  kind: "dropdown",
  is: (c) => Boolean(comboInput(c)),
  value: (c) => norm(comboInput(c)?.value) || null,
  lazyOptions: true,
  list: listCombo,
  search: searchCombo,
  fill: async (c, value) => {
    const input = await waitFor(() => comboInput(c), T.dropdownOpenMs);
    return input ? fillCombo(input, [asString(value)]) : fail("The list didn't load.");
  },
};
