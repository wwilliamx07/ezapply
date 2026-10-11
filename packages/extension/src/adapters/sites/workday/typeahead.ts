import type { FillValue, OptionInfo } from "@ezapply/protocol";
import {
  answersQuery,
  callReact,
  cssEscape,
  isVisible,
  key,
  matchOption,
  norm,
  press,
  setNativeValue,
  settle,
  text,
  waitFor,
} from "../../engine/dom.js";
import { T } from "../../engine/timing.js";
import { branch } from "../../engine/trace.js";
import type { FillOutcome, WidgetDriver } from "../../engine/types.js";
import { type Item, removeItems } from "./remove.js";
import { SEL, within } from "./selectors.js";

/**
 * Workday's prompt: a search-as-you-type multi-select (`multiSelectContainer`) whose options show in a `wd-popup`,
 * single- or multi-select, sometimes with nested menus (a category, then its items). Selected values show as chips.
 */

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));

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

/** A ticked option of a list with checkboxes (its `promptLeafNode` has `data-automation-checked`). */
function isTicked(option: HTMLElement): boolean {
  const item = option.closest<HTMLElement>("[data-automation-checked]");
  if (item) return /^checked$/i.test(item.getAttribute("data-automation-checked") ?? "");
  const box = option.parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  return Boolean(box && (box.checked || box.getAttribute("aria-checked") === "true"));
}

/** Whether `label` is selected: its chip shows, or its option on screen is ticked. */
function isSelected(c: HTMLElement, label: string): boolean {
  if (selectedItems(c).some((s) => lower(s) === lower(label))) return true;
  return promptOptions(c).some((o) => lower(text(o)) === lower(label) && isTicked(o));
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
 * quiet returned the previous query's results (or none), one call behind. One of them must also hold the
 * query: on a hierarchical prompt, live, the category menu ("All", …) rendered after the query was typed and was
 * taken for the results before the search had answered.
 */
async function typeQuery(c: HTMLElement, query: string): Promise<HTMLInputElement | null> {
  const input = c.querySelector<HTMLInputElement>(`${within(SEL.multiSelect, "input")}, input`);
  if (!input) return null;
  input.focus();
  press(input);
  await settle(c.ownerDocument, T.typeaheadFocusQuietMs, T.typeaheadFocusMaxMs);
  const before = promptSignature(c);
  // Done when new options show, or when "No Items." has stayed for a while (a search that found nothing:
  // it also shows briefly while results load).
  let emptySince = 0;
  const done = () => {
    const options = promptOptions(c);
    if (options.length > 0 && promptSignature(c) !== before && answersQuery(options.map(text), query)) return true;
    if (!noItemsShown(c)) {
      emptySince = 0;
      return false;
    }
    emptySince ||= Date.now();
    return Date.now() - emptySince > T.typeaheadNoResultsMs;
  };
  setNativeValue(input, query);
  key(input, "Enter");
  if (!(await waitFor(done, T.typeaheadResultsMs, 100))) {
    branch("typeahead search again", { query });
    callReact(input, "onKeyDown", { key: "Enter", target: { value: query } });
    await waitFor(done, T.typeaheadResultsRetryMs, 100);
  }
  await settle(c.ownerDocument, T.typeaheadResultsQuietMs, T.typeaheadResultsMaxMs);
  return input;
}

/** Options by label, once each. */
function uniqueOptions(c: HTMLElement): OptionInfo[] {
  const seen = new Map<string, OptionInfo>();
  for (const o of promptOptions(c).map(optionInfo)) if (o.label && !seen.has(o.label)) seen.set(o.label, o);
  return [...seen.values()];
}

async function searchTypeahead(c: HTMLElement, query: string): Promise<OptionInfo[]> {
  await typeQuery(c, query);
  const out = uniqueOptions(c);
  key(c.querySelector("input") ?? c, "Escape");
  return out;
}

async function listTypeahead(c: HTMLElement): Promise<OptionInfo[]> {
  const input = c.querySelector<HTMLElement>(`${within(SEL.multiSelect, "input")}, input`);
  if (!input) return [];
  press(input);
  await settle(c.ownerDocument, T.typeaheadMenuQuietMs, T.typeaheadMenuMaxMs);
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
    await settle(c.ownerDocument, T.typeaheadMenuQuietMs, T.typeaheadMenuMaxMs);
  } else {
    await typeQuery(c, path[0] as string);
  }
  let selected = "";
  for (const [i, segment] of path.entries()) {
    const options = await waitFor(() => {
      const o = promptOptions(c);
      return o.length ? o : null;
    }, T.typeaheadOptionsMs);
    if (!options) return { options: [] };
    const labels = options.map(text);
    const idx = matchOption(segment, labels);
    if (idx < 0) return { options: [...new Set(labels)] };
    const option = options[idx] as HTMLElement;
    selected = labels[idx] as string;
    const last = i === path.length - 1;
    // A multi-select with checkboxes ticks a search's only result itself on Enter, and pressing that option
    // then unticked it (live: skills and a citizenship were selected, then unselected).
    if (last && isSelected(c, selected)) {
      branch("selected on Enter", { label: selected });
      break;
    }
    press(option);
    await settle(c.ownerDocument, T.typeaheadSelectQuietMs, T.typeaheadSelectMaxMs);
    if (last && !isSelected(c, selected)) {
      callReact(option, "onClick", {});
      await settle(c.ownerDocument, T.typeaheadSelectQuietMs, T.typeaheadSelectMaxMs);
    }
  }
  return { selected };
}

/**
 * Select each value on its own: one that matches nothing is reported in `unmatched` with the options its search
 * showed, and the rest are still selected (seen live: a skills list stopped at its first unmatched entry).
 * When Workday selects an option itself on Enter (single-select prompts do), it's reported in `inexact`. A value
 * whose option was pressed but didn't stay selected is in the error, apart from those that matched nothing: "No
 * option matches" for those sent the agent looking for other values of an option it had found.
 */
async function fillTypeahead(c: HTMLElement, values: string[]): Promise<FillOutcome> {
  const unmatched: { value: string; suggestions: string[] }[] = [];
  const unkept: string[] = [];
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
      if (!isSelected(c, outcome.selected)) unkept.push(outcome.selected);
      continue;
    }
    key(input(), "Escape");
    await settle(c.ownerDocument, T.typeaheadFocusQuietMs, T.typeaheadFocusMaxMs);
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
  if (!unmatched.length && !unkept.length) return { ok: true, ...extra };
  const only = unmatched.length === 1 && values.length === 1 ? unmatched[0] : undefined;
  const problems = [
    unmatched.length ? `No option matches: ${unmatched.map((u) => `"${u.value}"`).join(", ")}.` : "",
    unkept.length ? `Chosen, but the page didn't keep: ${unkept.map((u) => `"${u}"`).join(", ")}.` : "",
  ];
  return fail(problems.filter(Boolean).join(" "), {
    ...extra,
    ...(only?.suggestions.length ? { availableOptions: only.suggestions } : {}),
  });
}

/** The chips of the selected values, each with its remove control. */
function chipItems(c: HTMLElement): Item[] {
  const own = [...c.querySelectorAll<HTMLElement>(SEL.chip)];
  const els = own.length ? own : [...c.querySelectorAll<HTMLElement>(SEL.chipInList)];
  return els.map((el) => ({
    label: text(el.querySelector(SEL.chipLabel) ?? el),
    el,
    remove: el.querySelector<HTMLElement>(SEL.chipRemove),
  }));
}

export const typeaheadDriver: WidgetDriver = {
  kind: "typeahead",
  is: (c) => Boolean(c.querySelector(SEL.multiSelect)),
  value: selectedItems,
  lazyOptions: true,
  multiple: (c) => {
    const ms = c.querySelector(SEL.multiSelect);
    return (
      ms?.getAttribute("data-uxi-multiselect-singleselect") === "false" ||
      ms?.getAttribute("aria-multiselectable") === "true"
    );
  },
  list: listTypeahead,
  search: searchTypeahead,
  fill: (c, value) => fillTypeahead(c, Array.isArray(value) ? value : [asString(value)]),
  remove: (c, values) => removeItems(c, () => chipItems(c), values),
};
