import type {
  BackResult,
  DebugRequest,
  FillAction,
  FillResult,
  NextResult,
  OptionInfo,
  PageAction,
  PageKind,
  RemoveResult,
  RemoveRowResult,
  UploadFile,
} from "@ezapply/protocol";
import { isVisible, press, waitFor, win } from "./dom.js";
import { type Extraction, extract, type FieldRef, type PageSchema } from "./extract.js";
import { installSubmitGuard } from "./guard.js";
import { failureMarkup, pageMarkup } from "./markup.js";
import { setTiming, T, useSiteWaits } from "./timing.js";
import {
  addFailureMarkup,
  type DebugTrace,
  fieldEnded,
  fieldStarted,
  markupWanted,
  outside,
  type PageState,
  startDebug,
  stopDebug,
  type TraceEvent,
  tracing,
} from "./trace.js";
import type { SiteDefinition } from "./types.js";

declare const __ADAPTER_VERSION__: string | undefined;

/**
 * Identifies this build of the adapter, so a tab holding an older injected copy gets the new one. build.mjs
 * stamps a hash of each site's bundle; unbundled (tests) it's "dev".
 */
export const ADAPTER_VERSION: string = typeof __ADAPTER_VERSION__ === "string" ? __ADAPTER_VERSION__ : "dev";

/**
 * The adapter surface the service worker calls (via chrome.scripting in the page's MAIN world), the same for every
 * site: the site's definition says where things are and how its widgets work; this does the rest. Holds the field
 * registry from the last extraction; lookups re-extract when elements went stale (the page re-rendered).
 */
export function createAdapter(site: SiteDefinition, doc: Document, getUrl: () => string) {
  useSiteWaits(site.info.waits);
  let last: Extraction | null = null;

  const refresh = (): Extraction => {
    last = extract(site, doc, getUrl());
    return last;
  };

  const ref = (fieldId: string): FieldRef => {
    let r = last?.fields.get(fieldId);
    if (!r?.container.isConnected) r = refresh().fields.get(fieldId);
    if (!r) throw new Error(`Unknown field "${fieldId}". Call get_form again; the page may have changed.`);
    if (site.page.isSubmit(r.container)) throw new Error("Refusing to touch a submit control.");
    return r;
  };

  const kindNow = (): PageKind => site.page.kind(doc, getUrl(), extract(site, doc, getUrl()).fields.size);
  const stepKey = () => site.page.stepKey(doc, getUrl());
  const errorsNow = () => site.page.errors(doc);

  const blocked = installSubmitGuard(doc, site.page.isSubmit);

  /** A step-move result: the step and page as they are now. */
  const summary = <R extends NextResult | BackResult>(base: Omit<R, "pageKind" | "step" | "errors">) => {
    const s = site.page.step(doc);
    return { ...base, pageKind: kindNow(), ...(s ? { step: s } : {}), errors: errorsNow() } as unknown as R;
  };

  /** The page now, for the debug trace (outside it: reading the step queries the page). */
  const pageState = (): PageState =>
    outside(() => {
      let step: PageState["step"];
      try {
        step = site.page.step(doc);
      } catch {
        // a page the site can't read a step from
      }
      return {
        url: getUrl(),
        ...(step ? { step } : {}),
        visibility: doc.visibilityState,
        focused: doc.hasFocus(),
      };
    });
  /** What the companion asked of the debugged call running now, and the page's markup taken before it. */
  let debugging: DebugRequest | null = null;
  let markupBefore: string | undefined;

  /**
   * A field's operation ended: in debug mode its outcome goes into the trace, and a failure's snapshot is taken
   * while what failed may still be on screen.
   */
  const fieldDone = <R extends { ok: boolean; error?: string }>(
    ev: TraceEvent | null,
    fieldId: string,
    res: R,
    container?: HTMLElement,
  ): R => {
    if (!ev) return res;
    fieldEnded(ev, res.ok, res.error);
    if (!res.ok && container?.isConnected && markupWanted().failures) {
      addFailureMarkup(fieldId, failureMarkup(container));
    }
    return res;
  };

  const fillOne = async (f: FillAction): Promise<FillResult> => {
    const ev = fieldStarted("fill", f.fieldId);
    let container: HTMLElement | undefined;
    try {
      const r = ref(f.fieldId);
      container = r.container;
      r.container.scrollIntoView?.({ block: "center" });
      const out = await r.driver.fill(r.container, f.value);
      return fieldDone(ev, f.fieldId, { fieldId: f.fieldId, ...out }, container);
    } catch (err) {
      return fieldDone(ev, f.fieldId, { fieldId: f.fieldId, ok: false, error: (err as Error).message }, container);
    }
  };

  /** A read of a field's options, traced as a field operation: it fails by throwing. */
  const fieldRead = async <R>(op: string, fieldId: string, read: () => Promise<R>): Promise<R> => {
    const ev = fieldStarted(op, fieldId);
    try {
      const out = await read();
      fieldDone(ev, fieldId, { ok: true });
      return out;
    } catch (err) {
      fieldDone(ev, fieldId, { ok: false, error: (err as Error).message });
      throw err;
    }
  };

  return {
    version: ADAPTER_VERSION,
    site: site.info.id,

    /** The waits for the calls that follow (see timing.ts); null or absent restores the site's own. */
    setTiming(timing?: Record<string, number> | null): void {
      setTiming(timing);
    },

    /**
     * Debug mode for the call that follows (trace.ts): the page's markup first when asked (before the
     * trace starts, so it isn't timed), then the trace's hooks. Null or absent: no trace, and none left running.
     * Set after `setTiming`, in the same script (background/forms.ts, `callAdapter`).
     */
    setDebug(debug?: DebugRequest | null): void {
      markupBefore = undefined;
      debugging = debug ?? null;
      if (!debug) {
        if (tracing()) stopDebug(pageState());
        return;
      }
      if (debug.before) markupBefore = pageMarkup(doc);
      startDebug(doc, debug, pageState());
    },

    /** The trace of the call just made, with the markup asked for; undefined without debug. */
    takeDebug(): DebugTrace | undefined {
      const trace = stopDebug(pageState());
      const asked = debugging;
      const before = markupBefore;
      debugging = null;
      markupBefore = undefined;
      if (!trace) return undefined;
      const markup = {
        ...(before !== undefined ? { before } : {}),
        ...(asked?.after ? { after: pageMarkup(doc) } : {}),
        ...trace.markup,
      };
      return { ...trace, ...(Object.keys(markup).length ? { markup } : {}) };
    },

    getForm(): PageSchema {
      return refresh().schema;
    },

    async listOptions(fieldId: string): Promise<OptionInfo[]> {
      return fieldRead("list", fieldId, async () => {
        const r = ref(fieldId);
        if (r.driver.list) return r.driver.list(r.container);
        return (r.field.options ?? []).map((label) => ({ label }));
      });
    },

    async searchOptions(fieldId: string, query: string): Promise<OptionInfo[]> {
      return fieldRead("search", fieldId, async () => {
        const r = ref(fieldId);
        if (!r.driver.search) throw new Error(site.messages.noSearch);
        return r.driver.search(r.container, query);
      });
    },

    /**
     * Fill each field and let the page settle after it (the site's `afterField` wait). In the order given, or in
     * page order when the site's lists depend on the ones above them (Oracle's country, province, city). Then
     * read the page once more: a field showing an error keeps `ok: true` with the page's error.
     */
    async fill(fills: FillAction[]): Promise<FillResult[]> {
      const results = new Map<FillAction, FillResult>();
      let order = fills;
      if (site.fill.order === "page") {
        const placed = fills.map((f) => {
          try {
            return { f, el: ref(f.fieldId).container as HTMLElement | null };
          } catch (err) {
            results.set(f, { fieldId: f.fieldId, ok: false, error: (err as Error).message });
            return { f, el: null };
          }
        });
        order = placed
          .filter((x) => x.el)
          .sort((a, b) => ((a.el?.compareDocumentPosition(b.el as Node) ?? 0) & 4 ? -1 : 1))
          .map((x) => x.f);
      }
      for (const f of order) {
        results.set(f, await fillOne(f));
        await site.waits.afterField(doc);
      }
      const out = fills.map((f) => results.get(f) as FillResult);
      let after = refresh();
      if (site.fill.waitForStaleErrors) {
        // A list's "required" error stays a moment after it's filled, until the page validates again (seen live
        // on Oracle: three lists reported an error that was gone on the next read).
        const stale = (x: Extraction) => out.some((r) => r.ok && x.fields.get(r.fieldId)?.field.error);
        if (stale(after)) {
          await waitFor(() => !stale(refresh()), T.afterFieldMaxMs, 100);
          after = refresh();
        }
      }
      for (const res of out) {
        const e = after.fields.get(res.fieldId)?.field.error;
        if (e && res.ok) res.error = `Filled, but the page reports: ${e}`;
      }
      return out;
    },

    async upload(fieldId: string, file: UploadFile): Promise<FillResult> {
      const ev = fieldStarted("upload", fieldId);
      let container: HTMLElement | undefined;
      try {
        const r = ref(fieldId);
        container = r.container;
        if (r.field.kind !== "file" || !r.driver.upload) {
          return fieldDone(ev, fieldId, { fieldId, ok: false, error: "Not a file field." }, container);
        }
        if (site.fill.scrollBeforeUpload) r.container.scrollIntoView?.({ block: "center" });
        const w = win(doc);
        const bytes = Uint8Array.from(w.atob(file.base64), (ch) => ch.charCodeAt(0));
        const f = new w.File([bytes], file.name, { type: file.mimeType });
        return fieldDone(ev, fieldId, { fieldId, ...(await r.driver.upload(r.container, f)) }, container);
      } catch (err) {
        return fieldDone(ev, fieldId, { fieldId, ok: false, error: (err as Error).message }, container);
      }
    },

    /** Remove selected values (multi-select) or attached files; `values` null or absent = all of them. */
    async remove(fieldId: string, values?: string[] | null): Promise<RemoveResult> {
      const ev = fieldStarted("remove", fieldId);
      let container: HTMLElement | undefined;
      try {
        const r = ref(fieldId);
        container = r.container;
        r.container.scrollIntoView?.({ block: "center" });
        if (!r.driver.remove) {
          const error = site.messages.cantRemove(r.field.kind);
          return fieldDone(ev, fieldId, { fieldId, ok: false, removed: [], remaining: [], error });
        }
        const out = await r.driver.remove(r.container, values, r.field);
        return fieldDone(ev, fieldId, { fieldId, ...out }, container);
      } catch (err) {
        const error = (err as Error).message;
        return fieldDone(ev, fieldId, { fieldId, ok: false, removed: [], remaining: [], error }, container);
      }
    },

    /**
     * Delete one repeatable row (a work-history entry carried over from the last application) or saved item with
     * its own delete button, confirming a dialog if one appears. Done once the page has fewer of them.
     */
    async removeRepeatable(sectionId: string): Promise<RemoveRowResult> {
      const row = refresh().rows.get(sectionId);
      const noun = site.repeat.noun;
      if (!row) {
        return {
          sectionId,
          ok: false,
          error: `No removable ${noun} "${sectionId}". Call get_form: ${noun}s that can be removed are marked removable.`,
        };
      }
      const button = await site.repeat.deleteButton(row);
      if (!button) return { sectionId, ok: false, error: `"${row.title}" shows no delete button.` };
      if (site.page.isSubmit(button)) return { sectionId, ok: false, error: "Refusing to press a submit control." };
      const count = () => site.repeat.removed(doc);
      const before = count();
      button.scrollIntoView?.({ block: "center" });
      press(button);
      if (!(await waitFor(() => count() < before, T.removeRowMs))) {
        await site.repeat.confirmRemoval(doc);
        await waitFor(() => count() < before, T.removeRowConfirmMs);
      }
      await site.waits.afterRow(doc);
      return count() < before
        ? { sectionId, ok: true, removed: row.title }
        : { sectionId, ok: false, error: `"${row.title}" is still there.` };
    },

    /**
     * Press an add button (a row's fields appear, or an inline form opens), or an inline form's Save (`save.*`),
     * which adds the item once the page accepts it.
     */
    async addRepeatable(addButtonId: string): Promise<{ ok: boolean; error?: string }> {
      let b = last?.addButtons.get(addButtonId);
      if (!b?.isConnected) b = refresh().addButtons.get(addButtonId);
      if (!b) return { ok: false, error: `Unknown add button "${addButtonId}". Call get_form again.` };
      if (site.page.isSubmit(b)) return { ok: false, error: "Refusing to press a submit control." };
      const button = b;
      if (addButtonId.startsWith("save.") && site.repeat.saveErrors) {
        const errorsIn = () => site.repeat.saveErrors?.(button) ?? 0;
        press(button);
        const closed = await waitFor(() => !button.isConnected || !isVisible(button) || errorsIn() > 0, T.addRowMs);
        await site.waits.afterRow(doc);
        if (!button.isConnected || !isVisible(button)) return { ok: true };
        const errors = errorsNow();
        return {
          ok: false,
          error: closed && errors.length ? `Not saved: ${errors.join(" ")}` : "The form is still open.",
        };
      }
      const before = site.repeat.added(doc);
      press(button);
      const grew = await waitFor(() => site.repeat.added(doc) > before, T.addRowMs);
      await site.waits.afterRow(doc);
      return grew ? { ok: true } : { ok: false, error: "No new fields appeared." };
    },

    /**
     * Press Next and report whether the step changed: its key (index and title, or URL) or page kind. Live step
     * titles are often all "Application", so a title alone isn't enough. The wait ends on a new step or on
     * validation errors; notices such as "successfully uploaded" don't count as errors.
     */
    async next(): Promise<NextResult> {
      const kind = refresh().schema.pageKind;
      const result = (advanced: boolean, extra: Partial<NextResult> = {}): NextResult => {
        const messages = site.page.messages(doc);
        return { ...summary<NextResult>({ advanced }), ...(messages.length ? { messages } : {}), ...extra };
      };
      const refusal = site.messages.refuseNext(kind) ?? site.page.nextBlocked?.(doc);
      if (refusal) return result(false, { refusedReason: refusal });
      const button = site.page.next(doc);
      if (!button) return result(false, { refusedReason: site.messages.noNextButton });
      if (site.page.isSubmit(button)) return result(false, { refusedReason: site.messages.submitIsNext(button) });
      const keyBefore = stepKey();
      const errorsBefore = errorsNow().join("\u0001");
      press(button);
      await waitFor(
        () =>
          stepKey() !== keyBefore ||
          (errorsNow().length > 0 && (!site.fill.newErrorsOnly || errorsNow().join("\u0001") !== errorsBefore)),
        T.stepMs,
        150,
      );
      await site.waits.afterStep(doc, stepKey() !== keyBefore);
      const after = result(false);
      return { ...after, advanced: stepKey() !== keyBefore || after.pageKind !== kind };
    },

    /**
     * Press Back to the previous step, e.g. to correct an answer from the review page. Allowed anywhere there is
     * a Back button except after submitting; it never touches a submit control. A move is seen as in `next`.
     */
    async back(): Promise<BackResult> {
      const kind = refresh().schema.pageKind;
      if (kind === "confirmation") {
        return summary<BackResult>({ moved: false, refusedReason: "The application was already submitted." });
      }
      const button = site.page.back(doc);
      if (!button) return summary<BackResult>({ moved: false, refusedReason: site.messages.noBackButton });
      if (site.page.isSubmit(button)) {
        return summary<BackResult>({ moved: false, refusedReason: "Refusing to press a submit control." });
      }
      const keyBefore = stepKey();
      press(button);
      await waitFor(() => stepKey() !== keyBefore, T.stepMs, 150);
      await site.waits.afterStep(doc, stepKey() !== keyBefore);
      const after = summary<BackResult>({ moved: false });
      return { ...after, moved: stepKey() !== keyBefore || after.pageKind !== kind };
    },

    async pageAction(action: PageAction): Promise<{ ok: boolean; pageKind: PageKind; error?: string }> {
      const el = site.page.actionButton(doc, action);
      if (!el) return { ok: false, pageKind: kindNow(), error: `No "${action}" control on this page.` };
      if (site.page.isSubmit(el))
        return { ok: false, pageKind: kindNow(), error: "Refusing to press a submit control." };
      press(el);
      await site.waits.afterAction(doc);
      return { ok: true, pageKind: kindNow() };
    },

    /** For diagnostics: synthetic submit attempts that were blocked. */
    blockedSubmitAttempts(): string[] {
      return [...blocked];
    },
  };
}

export type Adapter = ReturnType<typeof createAdapter>;

/**
 * Install a site's adapter on the page's window as `__ezapply_<site>`: the bundle's entry calls this. Idempotent
 * across repeated injections and in-page navigations; a newer build replaces an older one.
 */
export function install(site: SiteDefinition): void {
  const name = `__ezapply_${site.info.id}`;
  const w = window as unknown as Record<string, { version: string } | undefined>;
  if (w[name]?.version === ADAPTER_VERSION) return;
  Object.defineProperty(window, name, {
    value: createAdapter(site, document, () => location.href),
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
