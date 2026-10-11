import { callReact, matchOption, press, settle, waitFor, win } from "../engine/dom.js";
import { T } from "../engine/timing.js";
import { branch } from "../engine/trace.js";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "../engine/types.js";

/**
 * A file field: a file input (often hidden behind an "Attach" button), and the names of the files it holds, as
 * the page shows them. `names` reads those; `removeButton` finds the control that takes one off.
 */
export interface FileSpec {
  input?: (c: HTMLElement) => HTMLInputElement | null;
  names: (c: HTMLElement) => string[];
  /**
   * The elements showing each file, when the page renders one per file. An upload is then done once an element
   * that wasn't there before shows the file's name, so a same-named file the page replaces counts; without it, done
   * is one more file of that name than before.
   */
  entries?: (c: HTMLElement) => { name: string; el: Element }[];
  /** Where a file is dropped when setting the input didn't take (default: the field container, if it has an input). */
  dropZone?: (c: HTMLElement, input: HTMLInputElement | null) => HTMLElement | null;
  /** Call the drop zone's React onDrop before dispatching a drop event. */
  reactDrop?: boolean;
  removeButton?: (c: HTMLElement, name: string) => HTMLElement | null;
  /** Presses the confirm button of a removal confirmation, when a removal didn't take at once. */
  confirmRemoval?: (doc: Document) => Promise<void>;
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
    /** Set the input's files and announce the change, else drop the file on the field; done once the page shows it. */
    upload: async (c, file) => {
      const i = input(c);
      // Without an input of its own, a field takes a file only where the site says it's dropped.
      const zone = spec.dropZone ? spec.dropZone(c, i) : i ? c : null;
      if (!i && !zone?.isConnected) {
        const held = spec.names(c);
        return held.length
          ? fail(`The field already holds ${held.join(", ")}: remove it with remove_items first.`, { readBack: held })
          : fail("No file input in the field.");
      }
      const wanted = file.name.toLowerCase();
      const shows = (name: string) => name.toLowerCase().includes(wanted);
      let done: () => boolean;
      if (spec.entries) {
        const entries = spec.entries;
        const before = new Set(entries(c).map((e) => e.el));
        done = () => entries(c).some((e) => !before.has(e.el) && shows(e.name));
      } else {
        const before = spec.names(c).filter(shows).length;
        done = () => spec.names(c).filter(shows).length > before;
      }
      const w = win(c);
      const dt = new w.DataTransfer();
      dt.items.add(file);
      if (i) {
        try {
          i.files = dt.files;
        } catch {
          Object.defineProperty(i, "files", { value: dt.files, configurable: true });
        }
        i.dispatchEvent(new w.Event("input", { bubbles: true }));
        i.dispatchEvent(new w.Event("change", { bubbles: true }));
      }
      if (!(await waitFor(done, T.uploadMs, 200)) && zone?.isConnected) {
        branch("upload by drop");
        const handled = spec.reactDrop && callReact(zone, "onDrop", { dataTransfer: dt });
        if (!handled)
          zone.dispatchEvent(new w.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
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
        let gone = Boolean(await waitFor(() => count() < before, T.removeMs));
        if (!gone && spec.confirmRemoval) {
          await spec.confirmRemoval(c.ownerDocument);
          gone = Boolean(await waitFor(() => count() < before, T.removeMs));
        }
        if (gone) removed.push(name);
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
