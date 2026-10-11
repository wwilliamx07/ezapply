import { callReact, isVisible, key, matchOption, norm, press, settle, text, waitFor } from "../../engine/dom.js";
import { T } from "../../engine/timing.js";
import type { RemoveOutcome } from "../../engine/types.js";
import { isSubmitControl } from "./page.js";
import { SEL } from "./selectors.js";

/** Something a field holds that can be taken off: a selected value's chip, or an attached file. */
export interface Item {
  label: string;
  el: HTMLElement;
  remove: HTMLElement | null;
}

/** Press the confirm button of a delete/remove confirmation, if one appeared. */
export async function confirmRemoval(doc: Document): Promise<void> {
  const dialog = [...doc.querySelectorAll<HTMLElement>(SEL.dialog)].find(
    (d) => isVisible(d) && /delete|remove/i.test(text(d)),
  );
  const button = dialog
    ? [...dialog.querySelectorAll<HTMLElement>("button,[role='button']")].find((b) =>
        /^(delete|remove|yes|ok|confirm)$/i.test(text(b)),
      )
    : undefined;
  if (button && !isSubmitControl(button)) {
    press(button);
    await settle(doc, T.removeQuietMs, T.removeMaxMs);
  }
}

async function removeOne(c: HTMLElement, item: Item, gone: () => boolean): Promise<boolean> {
  const doc = c.ownerDocument;
  if (item.remove && !isSubmitControl(item.remove)) {
    press(item.remove);
    if (await waitFor(gone, T.removeMs)) return true;
    await confirmRemoval(doc);
    if (await waitFor(gone, T.removeMs)) return true;
    callReact(item.remove, "onClick", {});
    if (await waitFor(gone, T.removeMs)) return true;
  }
  // Keyboard fallback: a focused pill is removed with Delete or Backspace.
  item.el.focus?.();
  key(item.el, "Delete");
  if (await waitFor(gone, T.removeKeyMs)) return true;
  key(item.el, "Backspace");
  return Boolean(await waitFor(gone, T.removeKeyMs));
}

/**
 * Remove selected values from a multi-select (e.g. Skills) or attached files from a file field. Workday
 * pre-fills both from the candidate's last application. `values` are matched like fill values (exact,
 * then a unique prefix, then a unique substring); without them, everything in the field is removed.
 */
export async function removeItems(
  c: HTMLElement,
  items: () => Item[],
  values?: string[] | null,
): Promise<RemoveOutcome> {
  const current = items().map((i) => i.label);
  const notFound: string[] = [];
  const targets: string[] = [];
  for (const v of values ?? current) {
    const idx = matchOption(v, current);
    if (idx < 0) notFound.push(v);
    else targets.push(current[idx] as string);
  }

  const removed: string[] = [];
  const failed: string[] = [];
  for (const label of targets) {
    const matching = () => items().filter((i) => norm(i.label) === norm(label));
    const before = matching().length;
    const item = matching()[0];
    if (!item) continue;
    if (await removeOne(c, item, () => matching().length < before)) removed.push(label);
    else failed.push(label);
    await settle(c.ownerDocument, T.removeQuietMs, T.removeMaxMs);
  }

  const remaining = items().map((i) => i.label);
  const problems = [
    failed.length ? `Could not remove: ${failed.join(", ")}.` : "",
    notFound.length ? `Not in the field: ${notFound.join(", ")} (it holds: ${current.join(", ") || "nothing"}).` : "",
  ].filter(Boolean);
  return {
    ok: problems.length === 0,
    removed,
    remaining,
    ...(notFound.length ? { notFound } : {}),
    ...(problems.length ? { error: problems.join(" ") } : {}),
  };
}
