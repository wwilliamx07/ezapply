import type { FillValue } from "@ezapply/protocol";
import { callReact, matchOption, press, text, waitFor } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "../engine/types.js";

/**
 * A short choice shown as toggle buttons: Ashby's Yes / No, Oracle's pills. `buttons` finds them in the field
 * container; `label` and `pressed` read one (by default its text and `aria-pressed`). With `multiple`, several may be
 * pressed (a checkbox group, which `remove_items` can unpress); otherwise one is (a radio).
 */
export interface ToggleSpec {
  buttons?: string;
  label?: (b: HTMLElement) => string;
  pressed?: (b: HTMLElement) => boolean;
  multiple?: boolean;
}

export function toggleButtonsDriver(spec: string | ToggleSpec = {}): WidgetDriver {
  const opts = typeof spec === "string" ? { buttons: spec } : spec;
  const all = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(opts.buttons ?? "button[aria-pressed]")];
  const pressed = opts.pressed ?? ((b: HTMLElement) => b.getAttribute("aria-pressed") === "true");
  const label = opts.label ?? text;
  const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));
  const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });

  /** Press a button only when it must change: a pressed toggle may unpress itself when pressed again. */
  async function set(b: HTMLElement, want: boolean): Promise<boolean> {
    if (pressed(b) === want) return true;
    press(b);
    if (await waitFor(() => pressed(b) === want, T.checkMs)) return true;
    callReact(b, "onClick", {});
    return Boolean(await waitFor(() => pressed(b) === want, T.checkMs));
  }

  if (!opts.multiple) {
    return {
      kind: "radio",
      is: (c) => all(c).length > 1,
      value: (c) => {
        const on = all(c).find(pressed);
        return on ? label(on) : null;
      },
      options: (c) => all(c).map(label),
      fill: async (c, value) => {
        const list = all(c);
        const labels = list.map(label);
        const idx = matchOption(asString(value), labels);
        if (idx < 0) return fail(`No option matches "${asString(value)}".`, { availableOptions: labels });
        return (await set(list[idx] as HTMLElement, true))
          ? { ok: true, readBack: labels[idx] as string }
          : fail("Selection did not stick.");
      },
    };
  }

  return {
    kind: "checkbox-group",
    is: (c) => all(c).length > 0,
    value: (c) => all(c).filter(pressed).map(label),
    options: (c) => all(c).map(label),
    multiple: () => true,
    fill: async (c, value) => {
      const list = all(c);
      const labels = list.map(label);
      const targets = new Set<number>();
      for (const w of Array.isArray(value) ? value : [asString(value)]) {
        const idx = matchOption(w, labels);
        if (idx < 0) return fail(`No option matches "${w}".`, { availableOptions: labels });
        targets.add(idx);
      }
      for (const [i, b] of list.entries()) await set(b, targets.has(i));
      const readBack = list.filter(pressed).map(label);
      return readBack.length === targets.size && [...targets].every((i) => pressed(list[i] as HTMLElement))
        ? { ok: true, readBack }
        : fail("Some options did not change.", { readBack });
    },
    remove: async (c, values): Promise<RemoveOutcome> => {
      const current = all(c).filter(pressed).map(label);
      const notFound = (values ?? []).filter((v) => matchOption(v, current) < 0);
      const targets = (values ?? current).map((v) => current[matchOption(v, current)]).filter(Boolean) as string[];
      const removed: string[] = [];
      for (const name of targets) {
        const b = all(c).find((x) => label(x) === name);
        if (b && (await set(b, false))) removed.push(name);
      }
      const ok = removed.length === targets.length && !notFound.length;
      return {
        ok,
        removed,
        remaining: all(c).filter(pressed).map(label),
        ...(notFound.length ? { notFound } : {}),
        ...(ok
          ? {}
          : { error: notFound.length ? `Not selected: ${notFound.join(", ")}.` : "Some options did not change." }),
      };
    },
  };
}
