import type { FillValue } from "@ezapply/protocol";
import { callReact, matchOption, press, text, waitFor } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import type { FillOutcome, WidgetDriver } from "../engine/types.js";

/**
 * A short choice shown as toggle buttons (`aria-pressed`), one of them pressed: Ashby's Yes / No. `buttons` finds
 * them in the field container.
 */
export function toggleButtonsDriver(buttons = "button[aria-pressed]"): WidgetDriver {
  const all = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(buttons)];
  const pressed = (b: HTMLElement) => b.getAttribute("aria-pressed") === "true";
  const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));
  const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
  return {
    kind: "radio",
    is: (c) => all(c).length > 1,
    value: (c) => {
      const on = all(c).find(pressed);
      return on ? text(on) : null;
    },
    options: (c) => all(c).map(text),
    fill: async (c, value, { strict }) => {
      const list = all(c);
      const labels = list.map(text);
      const idx = matchOption(asString(value), labels, strict);
      if (idx < 0) return fail(`No option matches "${asString(value)}".`, { availableOptions: labels });
      const b = list[idx] as HTMLElement;
      // A pressed toggle may unpress itself when pressed again.
      if (!pressed(b)) {
        press(b);
        if (!(await waitFor(() => pressed(b), T.checkMs))) {
          callReact(b, "onClick", {});
          await waitFor(() => pressed(b), T.checkMs);
        }
      }
      return pressed(b) ? { ok: true, readBack: labels[idx] as string } : fail("Selection did not stick.");
    },
  };
}
