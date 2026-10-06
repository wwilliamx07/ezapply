import type { FillValue, OptionInfo } from "@ezapply/protocol";
import { matchOption, norm, reactFiber, waitFor } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "../engine/types.js";

/**
 * react-select (used by Greenhouse's job boards and many React forms), driven through the component itself: its
 * props hold the options and the `onChange` that chooses one. Seen live (Greenhouse): a synthetic
 * mousedown never opens its menu unless the page has focus, and the user's browser window usually hasn't while they
 * type in their terminal; a trusted click opened it. Choosing through `onChange` needs no menu and no focus, and
 * reading `options` needs no menu either, so `list_options` costs nothing.
 *
 * A list whose options come as you type is searched through `onInputChange`, then its options are read once
 * loaded. That's an async select (`loadOptions`), or a page that fetches on `onInputChange` itself and passes the
 * results in as `options` (Greenhouse's location), so a list with no options at all is searched too. An async select
 * built on react-select-async-paginate (Greenhouse's school and discipline) loads only while its menu is open, so a
 * search opens the menu first and closes it after; `menu` says how, for a page that holds `menuIsOpen` itself.
 */

interface Option {
  label?: unknown;
  value?: unknown;
  options?: Option[];
}

export interface SelectProps {
  options?: Option[];
  value?: Option | Option[] | null;
  isMulti?: boolean;
  name?: string;
  menuIsOpen?: boolean;
  isLoading?: boolean;
  onChange: (value: unknown, meta: Record<string, unknown>) => void;
  onInputChange?: (value: string, meta: Record<string, unknown>) => void;
  onMenuOpen?: () => void;
  onMenuClose?: () => void;
  getOptionLabel?: (o: Option) => string;
  loadOptions?: unknown;
}

type Menu = (p: SelectProps, open: boolean) => void;

export interface ReactSelectOptions {
  /** Open or close the menu. Default: react-select's own `onMenuOpen` and `onMenuClose`. */
  menu?: Menu;
}

const defaultMenu: Menu = (p, open) => (open ? p.onMenuOpen?.() : p.onMenuClose?.());

/** react-select's combobox input in a field container. */
const comboInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>("input[role='combobox']");

/**
 * The props of the react-select component above the input: the nearest fiber whose props have `options`, an
 * `onChange` and `onMenuOpen` (react-select's own; wrappers above it lack the last).
 */
function selectProps(c: HTMLElement): SelectProps | null {
  const input = comboInput(c);
  // From the current copy of the input's fiber (`reactFiber`: the stored one can be stale).
  let fiber = input ? reactFiber(input) : null;
  for (let i = 0; fiber && i < 40; i++) {
    const p = fiber.memoizedProps as Record<string, unknown> | undefined;
    if (p && Array.isArray(p.options) && typeof p.onChange === "function" && "onMenuOpen" in p) {
      return p as unknown as SelectProps;
    }
    fiber = fiber.return ?? null;
  }
  return null;
}

const labelOf = (p: SelectProps, o: Option) => norm(p.getOptionLabel ? p.getOptionLabel(o) : String(o.label ?? ""));
const flat = (options: Option[] = []): Option[] => options.flatMap((o) => (Array.isArray(o.options) ? o.options : [o]));
const asList = (v: FillValue) => (Array.isArray(v) ? v : [String(v)]);
const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

function selected(c: HTMLElement): string[] {
  const p = selectProps(c);
  if (!p?.value) return [];
  return (Array.isArray(p.value) ? p.value : [p.value]).map((o) => labelOf(p, o)).filter(Boolean);
}

/** A list filled by searching: an async select, or one with no options until you type. */
const typeahead = (p: SelectProps) => Boolean(p.loadOptions) || !flat(p.options).length;

/**
 * Search a list whose options come as you type: open its menu, type the query through `onInputChange`, then wait
 * for the load to end (`isLoading` seen and gone), or for the options to change on a page that never says it's
 * loading. A query nothing matches ends there too, rather than waiting out the maximum.
 */
async function searched(c: HTMLElement, query: string, menu: Menu): Promise<Option[]> {
  const p = selectProps(c);
  if (!p?.onInputChange) return flat(p?.options);
  const labels = (q: SelectProps) => JSON.stringify(flat(q.options).map((o) => labelOf(q, o)));
  const before = labels(p);
  if (!p.menuIsOpen) {
    menu(p, true);
    await waitFor(() => selectProps(c)?.menuIsOpen, T.dropdownSelectMs);
  }
  (selectProps(c) ?? p).onInputChange?.(query, { action: "input-change", prevInputValue: "" });
  let loading = false;
  const loaded = await waitFor(() => {
    const now = selectProps(c);
    if (!now) return null;
    if (now.isLoading) {
      loading = true;
      return null;
    }
    return loading || (flat(now.options).length && labels(now) !== before) ? flat(now.options) : null;
  }, T.typeaheadResultsMs);
  return loaded ?? flat(selectProps(c)?.options);
}

/** After a search: close the menu and clear the typed text, as react-select does when it loses focus. */
function endSearch(c: HTMLElement, menu: Menu) {
  const p = selectProps(c);
  if (!p) return;
  if (p.menuIsOpen) menu(p, false);
  (selectProps(c) ?? p).onInputChange?.("", { action: "input-blur", prevInputValue: "" });
}

export function reactSelectDriver(opts: ReactSelectOptions = {}): WidgetDriver {
  const menu = opts.menu ?? defaultMenu;
  return {
    kind: "dropdown",
    is: (c) => Boolean(selectProps(c)),
    value: (c) => {
      const p = selectProps(c);
      if (p?.isMulti) return selected(c);
      return selected(c)[0] ?? null;
    },
    lazyOptions: true,
    multiple: (c) => (selectProps(c)?.isMulti ? true : undefined),
    list: async (c): Promise<OptionInfo[]> => {
      const p = selectProps(c);
      return p ? flat(p.options).map((o) => ({ label: labelOf(p, o) })) : [];
    },
    search: async (c, query): Promise<OptionInfo[]> => {
      const p = selectProps(c);
      if (!p) return [];
      if (!typeahead(p)) {
        const q = norm(query).toLowerCase();
        return flat(p.options)
          .map((o) => ({ label: labelOf(p, o) }))
          .filter((o) => o.label.toLowerCase().includes(q));
      }
      const options = await searched(c, query, menu);
      const now = selectProps(c) ?? p;
      const found = options.map((o) => ({ label: labelOf(now, o) }));
      endSearch(c, menu);
      return found;
    },
    fill: async (c, value, { strict }) => {
      const first = selectProps(c);
      if (!first) return fail("The list isn't ready on the page.");
      const chosen: Option[] = first.isMulti && Array.isArray(first.value) ? [...first.value] : [];
      for (const wanted of asList(value)) {
        const search = typeahead(selectProps(c) as SelectProps);
        const options = search ? await searched(c, wanted, menu) : flat(selectProps(c)?.options);
        const p = selectProps(c) as SelectProps;
        const labels = options.map((o) => labelOf(p, o));
        const idx = matchOption(wanted, labels, strict);
        if (idx < 0) {
          if (search) endSearch(c, menu);
          return fail(`No option matches "${wanted}"${strict ? " exactly" : ""}.`, {
            availableOptions: labels.slice(0, 80),
            readBack: selected(c),
          });
        }
        const option = options[idx] as Option;
        const was = JSON.stringify(selected(c));
        if (p.isMulti) {
          if (!chosen.some((o) => labelOf(p, o) === labels[idx])) chosen.push(option);
          p.onChange([...chosen], { action: "select-option", option, name: p.name });
        } else {
          p.onChange(option, { action: "select-option", option, name: p.name });
        }
        // A searched list can confirm the choice with a request of its own first (Greenhouse's location asks its
        // provider for the place), and show it in its own words: wait for the value to change, a while longer.
        await waitFor(
          () => selected(c).includes(labels[idx] as string) || (search && JSON.stringify(selected(c)) !== was),
          search ? T.typeaheadResultsMs : T.dropdownSelectMs,
        );
        if (search) endSearch(c, menu);
      }
      const readBack = selected(c);
      const want = asList(value);
      const took = want.every((w) => readBack.some((r) => matchOption(w, [r], strict) === 0));
      const back = first.isMulti ? readBack : (readBack[0] ?? null);
      return took ? { ok: true, readBack: back } : fail("Selection did not stick.", { readBack: back });
    },
    remove: async (c, values): Promise<RemoveOutcome> => {
      const p = selectProps(c);
      if (!p?.isMulti) {
        return {
          ok: false,
          removed: [],
          remaining: selected(c),
          error: "Only a list taking several values can be cleared.",
        };
      }
      const current = (Array.isArray(p.value) ? p.value : []).map((o) => labelOf(p, o));
      const notFound = (values ?? []).filter((v) => matchOption(v, current) < 0);
      const drop = new Set((values ?? current).map((v) => current[matchOption(v, current)]).filter(Boolean));
      const keep = (Array.isArray(p.value) ? p.value : []).filter((o) => !drop.has(labelOf(p, o)));
      p.onChange(keep, { action: "remove-value", name: p.name });
      await waitFor(() => selected(c).length === keep.length, T.removeMs);
      const remaining = selected(c);
      const removed = current.filter((l) => !remaining.includes(l));
      return {
        ok: !notFound.length && removed.length === drop.size,
        removed,
        remaining,
        ...(notFound.length ? { notFound, error: `Not selected: ${notFound.join(", ")}.` } : {}),
      };
    },
  };
}
