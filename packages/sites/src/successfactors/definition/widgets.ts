import { isVisible, matchOption, norm, press, settle, text, waitFor, win } from "@ezapply/engine/dom";
import { T } from "@ezapply/engine/timing";
import { act, outside } from "@ezapply/engine/trace";
import type { FillOutcome, RemoveOutcome, WidgetDriver } from "@ezapply/engine/types";
import type { FillValue, OptionInfo } from "@ezapply/protocol";

/**
 * SuccessFactors' own widgets, all components of its in-house framework (juic): the paginated picklist every list
 * is, the attachment fields and the radio groups of its questions. juic keeps each component in
 * `juic.Component._registry` under the id its markup starts with (`141:` for `141:_input`), and its markup calls it
 * through `juic.fire(id, method, event)`. Built from the page's own scripts, a saved application and a live run
 * (references/components/sites.md).
 */

interface PicklistOption {
  label?: string | null;
  value?: string | number | null;
  disabled?: boolean;
}

interface PicklistPage {
  picklistOptions?: PicklistOption[] | null;
  totalCount?: number;
}

/** `RCMPaginatedPicklistSingleSelect`, as far as the driver uses it. */
interface Picklist {
  getValue?(): { value?: unknown; label?: unknown } | undefined;
  setValue?(v: { value: string; label: string }): void;
  getFieldName?(): string | undefined;
  _model?: {
    _picklistId?: unknown;
    _parentOptionId?: unknown;
    _controller?: { getPicklistByPageWithExcludeOption?: (...args: unknown[]) => void };
  };
}

interface Juic {
  Component?: { _registry?: Record<string, unknown> };
}

/** The juic component a markup id belongs to (`141:_input` → `141:`). */
function component<C>(el: Element | null | undefined): C | undefined {
  const id = /^(\d+:)/.exec(el?.id ?? "")?.[1];
  if (!el || !id) return undefined;
  const juic = (win(el) as unknown as { juic?: Juic }).juic;
  return juic?.Component?._registry?.[id] as C | undefined;
}

const fail = (error: string, extra: Partial<FillOutcome> = {}): FillOutcome => ({ ok: false, error, ...extra });
const asString = (v: FillValue) => (Array.isArray(v) ? v.join(", ") : String(v));

const PAGE_SIZE = 100;
/** A list is read up to this many pages (Country, the longest seen, is about 250 options). */
const MAX_PAGES = 5;

const pickInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>("input.rcmpaginatedselectinput");

/** The field's name in SuccessFactors (`country`), which only the component knows: the markup has none. */
export function picklistFieldName(c: HTMLElement): string | undefined {
  return component<Picklist>(pickInput(c))?.getFieldName?.() || undefined;
}

/**
 * One page of a picklist's options from SuccessFactors, as its own list asks for them when opened or typed into
 * (`RCMPaginatedPicklistModel.fetchItems`): the picklist's id, the option chosen in the list it depends on (a country
 * for provinces), and the page, optionally filtered by a "contains" search.
 */
async function fetchPage(list: Picklist, page: number, filter?: string): Promise<PicklistPage | null> {
  const m = list._model;
  const ask = m?._controller?.getPicklistByPageWithExcludeOption;
  if (!m || typeof ask !== "function") return null;
  let answer: PicklistPage | null = null;
  const pagination = {
    startIndex: page * PAGE_SIZE,
    endIndex: page * PAGE_SIZE + PAGE_SIZE - 1,
    pageIndex: page,
    pageNumber: page + 1,
    pageSize: PAGE_SIZE,
    filterType: filter ? "contains" : null,
    filterValue: filter || null,
  };
  outside(() => {
    try {
      ask.call(
        m._controller,
        m._parentOptionId ?? null,
        m._picklistId,
        pagination,
        null,
        false,
        null,
        true,
        (r: unknown) => {
          answer = (r as PicklistPage) ?? { picklistOptions: [] };
        },
      );
    } catch {
      answer = null;
    }
  });
  return waitFor(() => answer, T.typeaheadResultsMs);
}

/** The options a choice can be made from: not "No Selection" (no value), not disabled. */
const choices = (r: PicklistPage | null) =>
  (r?.picklistOptions ?? []).filter((o) => o.value !== null && o.value !== undefined && o.value !== "" && !o.disabled);

const labelOf = (o: PicklistOption) => norm(String(o.label ?? o.value ?? ""));

/** Every option of a list, page by page; with `filter`, only those SuccessFactors finds containing it. */
async function options(list: Picklist, filter?: string): Promise<PicklistOption[]> {
  const out: PicklistOption[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetchPage(list, page, filter);
    const got = choices(r);
    out.push(...got);
    const total = r?.totalCount ?? 0;
    if (!r || (r.picklistOptions?.length ?? 0) < PAGE_SIZE || (total > 0 && (page + 1) * PAGE_SIZE >= total)) break;
  }
  return out;
}

/**
 * SuccessFactors' paginated picklist: a text input (`rcmpaginatedselectinput`) that opens a list fetched from the
 * server a page at a time. Driven through its component: the options asked for as its list asks for them, the choice
 * made with its `setValue`, which is what choosing an option in its list calls (`itemSelected`). That sets the value,
 * shows the label, and tells the lists that depend on it (a country's provinces are enabled and loaded), and the form.
 * A list that waits for an earlier answer is disabled.
 *
 * Why not clicks: its list is built in a popup only once opened, from the server's pages, and its markup wasn't seen.
 * The component needs neither, and lists every option.
 */
export function picklistDriver(): WidgetDriver {
  return {
    kind: "dropdown",
    is: (c) => Boolean(pickInput(c)),
    value: (c) => pickInput(c)?.value || null,
    lazyOptions: true,
    list: async (c): Promise<OptionInfo[]> => {
      const list = component<Picklist>(pickInput(c));
      return list ? (await options(list)).map((o) => ({ label: labelOf(o) })) : [];
    },
    search: async (c, query): Promise<OptionInfo[]> => {
      const list = component<Picklist>(pickInput(c));
      if (!list) return [];
      const q = norm(query).toLowerCase();
      // Filtered on the server; filtered again here in case the server answered with the whole list.
      return (await options(list, query))
        .map((o) => ({ label: labelOf(o) }))
        .filter((o) => o.label.toLowerCase().includes(q));
    },
    fill: async (c, value) => {
      const input = pickInput(c);
      if (!input) return fail("No list found in the field.");
      if (input.disabled) {
        return fail(
          "The list is disabled on the page: it waits for an earlier answer (a country before its provinces).",
        );
      }
      const list = component<Picklist>(input);
      if (!list?.setValue) return fail("The list isn't ready on the page.", { readBack: input.value || null });
      const wanted = asString(value);
      // Those containing the value first (one request), then the whole list for a wording they don't contain.
      let found = await options(list, wanted);
      let idx = matchOption(wanted, found.map(labelOf));
      if (idx < 0) {
        found = await options(list);
        idx = matchOption(wanted, found.map(labelOf));
      }
      if (idx < 0) {
        return fail(`No option matches "${wanted}".`, {
          availableOptions: found.map(labelOf).slice(0, 80),
          readBack: input.value || null,
        });
      }
      const option = found[idx] as PicklistOption;
      const chosen = { value: String(option.value), label: labelOf(option) };
      act("select", input, { value: chosen.label });
      outside(() => list.setValue?.(chosen));
      await waitFor(() => String(list.getValue?.()?.value ?? "") === chosen.value, T.dropdownSelectMs);
      const readBack = input.value;
      return readBack === chosen.label ? { ok: true, readBack } : fail("Selection did not stick.", { readBack });
    },
  };
}

/** Hidden by SuccessFactors' own class, its `hidden` or an inline style (jsdom reads no stylesheets). */
const shown = (el: Element | null | undefined): el is HTMLElement =>
  Boolean(el) && isVisible(el as Element) && !(el as Element).closest(".displayNone");

/**
 * A question's radio group (`.radioGroup`, `role=radiogroup`; "Are you registered in a co-op program?"): each choice
 * a `span[role=radio]` whose `aria-checked` the component keeps, its words in `.radioLabel` beside it. A click on it
 * reaches the component's `_itemSelect` (an `onclick` on the `<id>_radio` span around it), which tells the group;
 * the group checks it and may show follow-up questions under it. Where SuccessFactors renders real
 * `input[type=radio]`s instead (its Fiori setting), the native radio driver takes the field.
 */
export function radioGroupDriver(): WidgetDriver {
  const radios = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".radioGroup [role='radio']")];
  const labelOf = (r: HTMLElement) =>
    text(r.closest(".globalRadio")?.querySelector(".radioLabel") ?? null) || norm(r.getAttribute("aria-label"));
  const checked = (r: HTMLElement) => r.getAttribute("aria-checked") === "true";
  return {
    kind: "radio",
    is: (c) => radios(c).length > 0,
    value: (c) => {
      const on = radios(c).find(checked);
      return on ? labelOf(on) : null;
    },
    options: (c) => radios(c).map(labelOf),
    fill: async (c, value) => {
      const list = radios(c);
      const labels = list.map(labelOf);
      const wanted = asString(value);
      const idx = matchOption(wanted, labels);
      if (idx < 0) return fail(`No option matches "${wanted}".`, { availableOptions: labels });
      const r = list[idx] as HTMLElement;
      if (r.getAttribute("aria-disabled") === "true") return fail("This choice is disabled on the page.");
      if (!checked(r)) {
        press(r);
        await waitFor(() => checked(r), T.checkMs);
      }
      return checked(r)
        ? { ok: true, readBack: labels[idx] as string }
        : fail("Selection did not stick.", {
            readBack: list.find(checked) ? labelOf(list.find(checked) as HTMLElement) : null,
          });
    },
  };
}

/** One attachment of a field: an uploaded document, or the empty slot that takes one. */
interface Attachment {
  wrapper: HTMLElement;
  name: string;
  icon: HTMLElement | null;
}

/** The field's attachments, uploaded or not. A removed one's `_attach` is hidden. */
function attachments(c: HTMLElement): Attachment[] {
  return [...c.querySelectorAll<HTMLElement>(".attachWrapper")]
    .filter((wrapper) => shown(wrapper.querySelector("[id$='_attach']")))
    .map((wrapper) => {
      const attach = wrapper.querySelector("[id$='_attach']");
      const link = wrapper.querySelector("[id$='_attachDownloadLabel']");
      const uploaded = Boolean(attach?.classList.contains("successBtn")) && shown(link);
      return {
        wrapper,
        name: uploaded ? text(wrapper.querySelector("[id$='_attachDownloadLabelLink']")) : "",
        icon: wrapper.querySelector<HTMLElement>("[id$='_attachIcon']"),
      };
    });
}

const names = (c: HTMLElement) =>
  attachments(c)
    .map((a) => a.name)
    .filter(Boolean);

/** A field that keeps several documents (Additional Documents): it shows an empty slot beside what it holds. */
function takesSeveral(c: HTMLElement): boolean {
  const view = component<{ _config?: { urlParams?: { attachmentType?: string } } }>(c.querySelector(".attachWrapper"));
  const type = view?._config?.urlParams?.attachmentType;
  return type ? type === "MULTIATTACHMENTS" : c.querySelectorAll(".attachWrapper").length > 1;
}

/** A slot's own signs of an upload: "Uploading..." while it posts, then a tick once SuccessFactors has the file. */
const uploading = (a: Attachment) => shown(a.wrapper.querySelector("[id$='_attachLoading']"));
const ticked = (a: Attachment) => shown(a.wrapper.querySelector("[id$='_attachSuccess']"));

/**
 * The field as the page shows it now. SuccessFactors can re-render the whole application, which replaces every
 * element (seen live, a couple of seconds into an upload); the field is then found again by its label.
 */
function fieldNow(c: HTMLElement): HTMLElement | null {
  if (c.isConnected) return c;
  const label = text(c.querySelector("label"));
  return (
    [...c.ownerDocument.querySelectorAll<HTMLElement>(".RCMFormField")].find(
      (f) => f.querySelector(".attachWrapper") && text(f.querySelector("label")) === label,
    ) ?? null
  );
}

const RERENDERED =
  "SuccessFactors re-rendered the whole application during the upload, which drops what wasn't saved: answers " +
  "filled before it, and documents uploaded just before it. Read the form again (get_form) and refill what's empty.";

/** The upload popup's file input, once open: the visible one not yet moved into a field's upload form. */
const popupInput = (doc: Document) =>
  [...doc.querySelectorAll<HTMLInputElement>("input.fileUpload[type='file']")].find(
    (i) => isVisible(i) && !i.closest("[id$='_attachForm']"),
  ) ?? null;

/** The message a field shows when an upload or removal fails ("… is not a valid file type"). */
const fieldMessage = (c: HTMLElement) =>
  [...c.querySelectorAll("[id$='_validationMsg'], .rcmValidationMsgArea")]
    .filter(shown)
    .map(text)
    .filter(Boolean)
    .join(" ");

/** Presses OK in a confirmation dialog, if one shows ("Are you sure you want to delete this file?"). */
export async function confirmDialog(doc: Document, ms: number): Promise<boolean> {
  const ok = await waitFor(
    () =>
      [...doc.querySelectorAll<HTMLElement>("[role='dialog'] button, [role='alertdialog'] button, .sfDialogBox button")]
        .filter((b) => isVisible(b))
        .find((b) => /^(ok|yes|delete)$/i.test(text(b))),
    ms,
  );
  if (ok) press(ok);
  return Boolean(ok);
}

/**
 * An attachment field (Resume/CV, Cover Letter, Additional Documents). Its icon opens a popup holding a file input
 * ("Upload from my computer"); choosing a file there posts it to SuccessFactors at once, and the field then names
 * it. A required document's icon replaces it (a pencil); an optional one's deletes it (a bin), after asking where
 * the employer has that set. Additional Documents keeps an empty slot (a plus) beside the documents it holds.
 */
export function attachmentDriver(): WidgetDriver {
  return {
    kind: "file",
    is: (c) => Boolean(c.querySelector(".attachWrapper")),
    value: (c) => names(c),
    multiple: (c) => takesSeveral(c),
    fill: async () => fail("Use upload_file for file fields."),
    upload: async (c, file) => {
      const all = attachments(c);
      const slot = takesSeveral(c)
        ? all.find((a) => !a.name)
        : all.find((a) => !a.name || !a.icon?.classList.contains("removeAttachments"));
      if (!slot?.icon) {
        const held = all.find((a) => a.name)?.name;
        return fail(
          held
            ? `This field holds ${held}: remove it first (remove_items), then upload the new one.`
            : "No upload button found in the field.",
          { readBack: names(c) },
        );
      }
      const doc = c.ownerDocument;
      const count = (f: HTMLElement) => names(f).filter((n) => n === file.name).length;
      const before = count(c);
      const tickedBefore = ticked(slot);
      press(slot.icon);
      const input = await waitFor(() => popupInput(doc), T.dropdownOpenMs + T.typeaheadMenuMaxMs);
      if (!input) return fail("The upload popup did not open.", { readBack: names(c) });
      const w = win(input);
      const dt = new w.DataTransfer();
      dt.items.add(file);
      act("upload", input, { name: file.name });
      outside(() => {
        try {
          input.files = dt.files;
        } catch {
          Object.defineProperty(input, "files", { value: dt.files, configurable: true });
        }
        input.dispatchEvent(new w.Event("input", { bubbles: true }));
        input.dispatchEvent(new w.Event("change", { bubbles: true }));
      });
      // A replacement under the same name (the resume's) adds no name: the slot's own signs tell, the tick it shows
      // once the file is in (unless it showed one already) or the "Uploading..." seen before it named the file.
      let posted = false;
      const replaced = () => {
        if (uploading(slot)) posted = true;
        const now = attachments(c).find((a) => a.wrapper === slot.wrapper);
        return Boolean(
          now && now.name === file.name && !uploading(slot) && (posted || (ticked(slot) && !tickedBefore)),
        );
      };
      await waitFor(() => !c.isConnected || count(c) > before || replaced() || fieldMessage(c), T.uploadMs, 200);
      if (!c.isConnected) {
        // The old field is gone with the rest of the page: what the new one shows is what counts.
        const now = await waitFor(() => fieldNow(c), T.rowMaxMs);
        const got = now ? await waitFor(() => count(now) > before, T.rowMaxMs) : false;
        const readBack = now ? names(now) : [];
        if (got) return { ok: true, readBack, error: `Uploaded. ${RERENDERED}` };
        const shows = readBack.includes(file.name)
          ? "The field shows a document of this name, which may be the earlier one"
          : "This document doesn't show in the field now";
        return fail(
          `${RERENDERED} ${shows}: upload it again once the form is read (SuccessFactors may have kept it anyway: ` +
            "if it shows twice later, remove one).",
          { readBack },
        );
      }
      // A refused replacement still names the old file of the same name: the field's message says it failed.
      if (count(c) > before || (replaced() && !fieldMessage(c))) return { ok: true, readBack: names(c) };
      const message = fieldMessage(c);
      return fail(message ? `The page says: ${message}` : "The upload did not appear in the field.", {
        readBack: names(c),
      });
    },
    remove: async (c, values): Promise<RemoveOutcome> => {
      const current = names(c);
      const notFound = (values ?? []).filter((v) => matchOption(v, current) < 0);
      const targets = (values ?? current).map((v) => current[matchOption(v, current)]).filter(Boolean) as string[];
      const removed: string[] = [];
      const failed: string[] = [];
      let required = false;
      for (const name of targets) {
        const icon = attachments(c).find((a) => a.name === name)?.icon;
        if (!icon?.classList.contains("removeAttachments")) {
          // A required document's icon replaces it: it can't be taken off, only replaced.
          required = Boolean(icon);
          failed.push(name);
          continue;
        }
        const before = names(c).filter((n) => n === name).length;
        press(icon);
        await confirmDialog(c.ownerDocument, T.removeRowConfirmMs);
        if (await waitFor(() => names(c).filter((n) => n === name).length < before, T.uploadMs)) removed.push(name);
        else failed.push(name);
        await settle(c.ownerDocument, T.removeQuietMs, T.removeMaxMs);
      }
      const problems = [
        failed.length
          ? `Could not remove: ${failed.join(", ")}.${required ? " A required document can only be replaced: upload the new one to it." : ""}`
          : "",
        notFound.length
          ? `Not in the field: ${notFound.join(", ")} (it holds: ${current.join(", ") || "nothing"}).`
          : "",
      ].filter(Boolean);
      return {
        ok: problems.length === 0,
        removed,
        remaining: names(c),
        ...(notFound.length ? { notFound } : {}),
        ...(problems.length ? { error: problems.join(" ") } : {}),
      };
    },
  };
}
