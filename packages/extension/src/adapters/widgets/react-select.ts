import type { FillValue, OptionInfo } from "@ezapply/protocol";
import { matchOption, norm, waitFor } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "../engine/types.js";

/**
 * react-select (used by Greenhouse's job boards and many React forms), driven through the component itself: its
 * props hold the options and the `onChange` that chooses one. Seen live (Greenhouse): a synthetic
 * mousedown never opens its menu unless the page has focus, and the user's browser window usually hasn't while they
 * type in their terminal; a trusted click opened it. Choosing through `onChange` needs no menu and no focus, and
 * reading `options` needs no menu either, so `list_options` costs nothing.
 *
 * Async selects (options loaded as you type) are searched through `onInputChange`, then their options are read
 * once loaded.
 */

interface Option {
  label?: unknown;
  value?: unknown;
  options?: Option[];
}

interface SelectProps {
  options?: Option[];
  value?: Option | Option[] | null;
  isMulti?: boolean;
  name?: string;
  onChange: (value: unknown, meta: Record<string, unknown>) => void;
  onInputChange?: (value: string, meta: Record<string, unknown>) => void;
  getOptionLabel?: (o: Option) => string;
  loadOptions?: unknown;
}

/** react-select's combobox input in a field container. */
const comboInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>("input[role='combobox']");

/**
 * The props of the react-select component above the input: the nearest fiber whose props have `options`, an
 * `onChange` and `onMenuOpen` (react-select's own; wrappers above it lack the last).
 */
function selectProps(c: HTMLElement): SelectProps | null {
  const input = comboInput(c);
  if (!input) return null;
  type Fiber = { return?: Fiber | null; alternate?: Fiber | null; memoizedProps?: unknown };
  const own = input as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(input).find((k) => k.startsWith("__reactFiber$"));
  const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
  let fiber = fiberKey ? (own[fiberKey] as Fiber) : null;
  // React keeps two copies of each fiber; the one stored on the node can be the stale one (seen live: its select's
  // value stayed null after a choice the page showed). The node's props are always current: start from the copy
  // that holds them, so the walk up runs through the current tree.
  if (fiber?.alternate && propsKey && fiber.alternate.memoizedProps === own[propsKey]) fiber = fiber.alternate;
  for (let i = 0; fiber && i < 40; i++) {
    const p = fiber.memoizedProps as Record<string, unknown> | undefined;
    if (p && Array.isArray(p.options) && typeof p.onChange === "function" && "onMenuOpen" in p) {
      return p as unknown as SelectProps;
    }
    fiber = fiber.return as typeof fiber;
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

/** Search an async select: type the query through `onInputChange`, then wait for its options to change. */
async function searched(c: HTMLElement, query: string): Promise<Option[]> {
  const p = selectProps(c);
  if (!p?.onInputChange) return flat(p?.options);
  const before = JSON.stringify(flat(p.options).map((o) => labelOf(p, o)));
  p.onInputChange(query, { action: "input-change", prevInputValue: "" });
  const loaded = await waitFor(() => {
    const now = selectProps(c);
    const labels = flat(now?.options).map((o) => (now ? labelOf(now, o) : ""));
    return labels.length && JSON.stringify(labels) !== before ? flat(now?.options) : null;
  }, T.typeaheadResultsMs);
  return loaded ?? flat(selectProps(c)?.options);
}

export function reactSelectDriver(): WidgetDriver {
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
      const options = p.loadOptions ? await searched(c, query) : flat(p.options);
      const q = norm(query).toLowerCase();
      return options
        .map((o) => ({ label: labelOf(p, o) }))
        .filter((o) => p.loadOptions || o.label.toLowerCase().includes(q));
    },
    fill: async (c, value, { strict }) => {
      const first = selectProps(c);
      if (!first) return fail("The list isn't ready on the page.");
      const chosen: Option[] = first.isMulti && Array.isArray(first.value) ? [...first.value] : [];
      for (const wanted of asList(value)) {
        const p = selectProps(c) as SelectProps;
        let options = flat(p.options);
        if (!options.length && p.loadOptions) options = await searched(c, wanted);
        const labels = options.map((o) => labelOf(p, o));
        const idx = matchOption(wanted, labels, strict);
        if (idx < 0) {
          return fail(`No option matches "${wanted}"${strict ? " exactly" : ""}.`, {
            availableOptions: labels.slice(0, 80),
            readBack: selected(c),
          });
        }
        const option = options[idx] as Option;
        if (p.isMulti) {
          if (!chosen.some((o) => labelOf(p, o) === labels[idx])) chosen.push(option);
          p.onChange([...chosen], { action: "select-option", option, name: p.name });
        } else {
          p.onChange(option, { action: "select-option", option, name: p.name });
        }
        await waitFor(() => selected(c).includes(labels[idx] as string), T.dropdownSelectMs);
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
