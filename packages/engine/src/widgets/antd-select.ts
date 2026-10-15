import type { FillValue, OptionInfo } from "@ezapply/protocol";
import { matchOption, norm, reactFiber, text, waitFor } from "../dom.js";
import { T } from "../timing.js";
import type { FillOutcome, WidgetDriver } from "../types.js";

/**
 * Ant Design's Select (rc-select underneath; Dayforce's candidate portal and many React forms), driven through
 * rc-select's own context rather than its menu. Every rc-select renders a `SelectContext.Provider` above its input
 * whose value holds the options as the menu would show them (`flattenOptions`), the values chosen (`rawValues`) and
 * the `onSelect` its menu calls when an option is pressed. Calling that is what pressing the option does, and the
 * form around the select (antd's `Form.Item`) hears it through the select's `onChange` as it would from a click.
 *
 * Why not clicks: its menu opens on a mousedown and renders in a portal, only while open, and a long list is a
 * virtual list holding only the options in view; a synthetic mousedown on react-select did nothing without page focus
 * (seen live on Greenhouse), and the user's browser window usually hasn't focus while they type in their terminal.
 * Reading the context needs no menu and no focus, and lists every option.
 *
 * Options' labels can be React elements (Dayforce's dialling codes: a flag, `+1`, the country), so their text is
 * read from the element tree.
 */

interface FlatOption {
  group?: boolean;
  label?: unknown;
  value?: unknown;
  data?: { disabled?: boolean; label?: unknown; title?: unknown };
}

interface SelectContext {
  flattenOptions: FlatOption[];
  rawValues?: Iterable<unknown>;
  onSelect: (value: unknown, info: { selected: boolean }) => void;
}

/** The `.ant-select` in a field container (or the container itself). */
const selectOf = (c: HTMLElement) => (c.matches(".ant-select") ? c : c.querySelector<HTMLElement>(".ant-select"));

/** rc-select's context value: the nearest fiber above the input whose props' `value` has its options and `onSelect`. */
function context(c: HTMLElement): SelectContext | null {
  const input = selectOf(c)?.querySelector("input");
  let fiber = input ? reactFiber(input) : null;
  for (let i = 0; fiber && i < 40; i++) {
    const v = (fiber.memoizedProps as { value?: Record<string, unknown> } | undefined)?.value;
    if (v && typeof v === "object" && Array.isArray(v.flattenOptions) && typeof v.onSelect === "function") {
      return v as unknown as SelectContext;
    }
    fiber = fiber.return ?? null;
  }
  return null;
}

/** The text of a label that may be a React element: its strings and numbers, in order. */
function nodeText(n: unknown): string {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join("");
  if (typeof n === "object" && "props" in n) return nodeText((n as { props?: { children?: unknown } }).props?.children);
  return "";
}

const asList = (v: FillValue) => (Array.isArray(v) ? v : [String(v)]);
const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

export function antSelectDriver(): WidgetDriver {
  const labelOf = (o: FlatOption) => norm(nodeText(o.label ?? o.data?.label ?? o.data?.title ?? o.value));
  /** The options a choice can be made from: no group headings, nothing disabled. */
  const choices = (ctx: SelectContext) => ctx.flattenOptions.filter((o) => !o.group && !o.data?.disabled);
  const chosenValues = (ctx: SelectContext | null) => (ctx?.rawValues ? [...ctx.rawValues] : []);
  const multi = (c: HTMLElement) => Boolean(selectOf(c)?.classList.contains("ant-select-multiple"));

  /** What's chosen, by the options' labels; the page's own display where the context can't be read. */
  function selected(c: HTMLElement): string[] {
    const ctx = context(c);
    if (ctx) {
      const options = choices(ctx);
      return chosenValues(ctx)
        .map((v) => options.find((o) => o.value === v))
        .filter((o): o is FlatOption => Boolean(o))
        .map(labelOf);
    }
    return [...(selectOf(c)?.querySelectorAll<HTMLElement>(".ant-select-selection-item") ?? [])]
      .map((el) => norm(el.getAttribute("title")) || text(el))
      .filter(Boolean);
  }

  return {
    kind: "dropdown",
    is: (c) => Boolean(selectOf(c)),
    value: (c) => (multi(c) ? selected(c) : (selected(c)[0] ?? null)),
    lazyOptions: true,
    multiple: (c) => (multi(c) ? true : undefined),
    list: async (c): Promise<OptionInfo[]> => {
      const ctx = context(c);
      return ctx ? choices(ctx).map((o) => ({ label: labelOf(o) })) : [];
    },
    search: async (c, query): Promise<OptionInfo[]> => {
      const ctx = context(c);
      const q = norm(query).toLowerCase();
      return ctx
        ? choices(ctx)
            .map((o) => ({ label: labelOf(o) }))
            .filter((o) => o.label.toLowerCase().includes(q))
        : [];
    },
    fill: async (c, value) => {
      if (selectOf(c)?.classList.contains("ant-select-disabled")) {
        return fail(
          "The list is disabled on the page: it may wait for an earlier answer (a country before its regions).",
        );
      }
      for (const wanted of asList(value)) {
        const ctx = context(c);
        if (!ctx) return fail("The list isn't ready on the page.");
        const options = choices(ctx);
        const labels = options.map(labelOf);
        const idx = matchOption(wanted, labels);
        if (idx < 0) {
          return fail(`No option matches "${wanted}".`, {
            availableOptions: labels.slice(0, 80),
            readBack: selected(c),
          });
        }
        const option = options[idx] as FlatOption;
        if (!chosenValues(ctx).includes(option.value)) ctx.onSelect(option.value, { selected: true });
        await waitFor(() => chosenValues(context(c)).includes(option.value), T.dropdownSelectMs);
      }
      const readBack = selected(c);
      const took = asList(value).every((w) => readBack.some((r) => matchOption(w, [r]) === 0));
      const back = multi(c) ? readBack : (readBack[0] ?? null);
      return took ? { ok: true, readBack: back } : fail("Selection did not stick.", { readBack: back });
    },
  };
}
