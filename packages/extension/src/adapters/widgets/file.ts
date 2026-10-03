import { matchOption, press, settle, waitFor, win } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "../engine/types.js";

/**
 * A file field: a file input (often hidden behind an "Attach" button), and the names of the files it holds, as
 * the page shows them. `names` reads those; `removeButton` finds the control that takes one off.
 */
export interface FileSpec {
  input?: (c: HTMLElement) => HTMLInputElement | null;
  names: (c: HTMLElement) => string[];
  removeButton?: (c: HTMLElement, name: string) => HTMLElement | null;
  multiple?: (c: HTMLElement) => boolean;
}

export function fileDriver(spec: FileSpec): WidgetDriver {
  const input = spec.input ?? ((c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="file"]'));
  const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
  return {
    kind: "file",
    is: (c) => Boolean(input(c)),
    value: (c) => spec.names(c),
    multiple: (c) => (spec.multiple ? spec.multiple(c) : Boolean(input(c)?.multiple)),
    fill: async () => fail("Use upload_file for file fields."),
    /** Set the input's files and announce the change; done once the page shows a file of that name it didn't before. */
    upload: async (c, file) => {
      const i = input(c);
      if (!i) return fail("No file input in the field.");
      const before = spec.names(c).filter((n) => n.includes(file.name)).length;
      const done = () => spec.names(c).filter((n) => n.includes(file.name)).length > before;
      const w = win(c);
      const dt = new w.DataTransfer();
      dt.items.add(file);
      try {
        i.files = dt.files;
      } catch {
        Object.defineProperty(i, "files", { value: dt.files, configurable: true });
      }
      i.dispatchEvent(new w.Event("input", { bubbles: true }));
      i.dispatchEvent(new w.Event("change", { bubbles: true }));
      if (!(await waitFor(done, T.uploadMs, 200))) {
        c.dispatchEvent(new w.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await waitFor(done, T.uploadDropMs, 250);
      }
      return done()
        ? { ok: true, readBack: spec.names(c) }
        : fail("The upload did not appear in the field.", { readBack: spec.names(c) });
    },
    remove: async (c, values): Promise<RemoveOutcome> => {
      const current = spec.names(c);
      const notFound = (values ?? []).filter((v) => matchOption(v, current) < 0);
      const targets = (values ?? current).map((v) => current[matchOption(v, current)]).filter(Boolean) as string[];
      const removed: string[] = [];
      const failed: string[] = [];
      for (const name of targets) {
        const count = () => spec.names(c).filter((n) => n === name).length;
        const before = count();
        const button = spec.removeButton?.(c, name);
        if (!button) {
          failed.push(name);
          continue;
        }
        press(button);
        if (await waitFor(() => count() < before, T.removeMs)) removed.push(name);
        else failed.push(name);
        await settle(c.ownerDocument, T.removeQuietMs, T.removeMaxMs);
      }
      const problems = [
        failed.length ? `Could not remove: ${failed.join(", ")}.` : "",
        notFound.length
          ? `Not in the field: ${notFound.join(", ")} (it holds: ${current.join(", ") || "nothing"}).`
          : "",
      ].filter(Boolean);
      return {
        ok: problems.length === 0,
        removed,
        remaining: spec.names(c),
        ...(notFound.length ? { notFound } : {}),
        ...(problems.length ? { error: problems.join(" ") } : {}),
      };
    },
  };
}
