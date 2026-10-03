import type {
  BackResult,
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
import { isVisible, press, settle, waitFor, win } from "../common/dom.js";
import { installSubmitGuard as installGuard } from "../common/guard.js";
import { setTiming, T } from "../common/timing.js";
import {
  actionButton,
  backButton,
  detectPage,
  type Extraction,
  extract,
  isSubmitControl,
  nextButton,
  type PageSchema,
  pageErrors,
  pageMessages,
  savedItems,
  stepInfo,
} from "./extract.js";
import { confirmRemoval, fillField, listCombo, removeItems, searchCombo, uploadFile } from "./fill.js";
import { SEL } from "./selectors.js";

declare const __ADAPTER_VERSION__: string | undefined;

/** This build of the adapter; build.mjs stamps a hash of the bundle, unbundled (tests) it's "dev". */
export const ADAPTER_VERSION: string = typeof __ADAPTER_VERSION__ === "string" ? __ADAPTER_VERSION__ : "dev";

/** The submit guard (common/guard.ts) with Oracle's idea of a submit control. */
export function installSubmitGuard(doc: Document): string[] {
  return installGuard(doc, isSubmitControl);
}

/**
 * The Oracle Recruiting Cloud adapter: the same surface as the Workday one, so the background and the companion
 * treat both alike. Holds the field registry from the last extraction; lookups re-extract when elements went
 * stale (Knockout re-renders rows when the form changes).
 */
export function createOracleApi(doc: Document, getUrl: () => string) {
  let last: Extraction | null = null;

  const refresh = (): Extraction => {
    last = extract(doc, getUrl());
    return last;
  };

  const ref = (fieldId: string) => {
    let r = last?.fields.get(fieldId);
    if (!r?.container.isConnected) r = refresh().fields.get(fieldId);
    if (!r) throw new Error(`Unknown field "${fieldId}". Call get_form again; the page may have changed.`);
    if (isSubmitControl(r.container)) throw new Error("Refusing to touch a submit control.");
    return r;
  };

  const rowCount = () => [...doc.querySelectorAll(SEL.row)].filter(isVisible).length;
  const kindNow = (): PageKind => detectPage(doc, getUrl(), extract(doc, getUrl()).fields.size);

  const blocked = installSubmitGuard(doc);

  return {
    version: ADAPTER_VERSION,

    /** The waits for the calls that follow (see timing.ts); null or absent restores the defaults. */
    setTiming(timing?: Record<string, number> | null): void {
      setTiming(timing);
    },

    getForm(): PageSchema {
      return refresh().schema;
    },

    async listOptions(fieldId: string): Promise<OptionInfo[]> {
      const r = ref(fieldId);
      if (r.field.kind === "dropdown") return listCombo(r.container);
      return (r.field.options ?? []).map((label) => ({ label }));
    },

    /** Lists here search as you type (countries, cities, schools): any dropdown can be searched. */
    async searchOptions(fieldId: string, query: string): Promise<OptionInfo[]> {
      const r = ref(fieldId);
      if (r.field.kind !== "dropdown") throw new Error("search_options applies to dropdown fields on Oracle pages.");
      return searchCombo(r.container, query);
    },

    /**
     * Fill in page order, whatever order the fills came in: Oracle's address lists depend on the ones above
     * them (country, then province, then city), and each loads its options from the one before.
     */
    async fill(fills: FillAction[]): Promise<FillResult[]> {
      const results = new Map<FillAction, FillResult>();
      const located = fills.map((f) => {
        try {
          return { f, r: ref(f.fieldId) };
        } catch (err) {
          results.set(f, { fieldId: f.fieldId, ok: false, error: (err as Error).message });
          return { f, r: null };
        }
      });
      const ordered = located
        .filter((x) => x.r)
        .sort((a, b) => ((a.r?.container.compareDocumentPosition(b.r?.container as Node) ?? 0) & 4 ? -1 : 1));
      for (const { f } of ordered) {
        try {
          // Look the field up again: an earlier fill may have re-rendered the rows after it.
          const r = ref(f.fieldId);
          r.container.scrollIntoView?.({ block: "center" });
          results.set(f, { fieldId: f.fieldId, ...(await fillField(r, f.value, f.strict === true)) });
        } catch (err) {
          results.set(f, { fieldId: f.fieldId, ok: false, error: (err as Error).message });
        }
        await settle(doc, T.afterFieldQuietMs, T.afterFieldMaxMs);
      }
      const out = fills.map((f) => results.get(f) as FillResult);
      // A list's "required" error stays a moment after it's filled, until the page validates again (seen live:
      // three lists reported an error that was gone on the next read). Give it that moment before reporting.
      const stale = (x: Extraction) => out.some((r) => r.ok && x.fields.get(r.fieldId)?.field.error);
      let after = refresh();
      if (stale(after)) {
        await waitFor(() => !stale(refresh()), T.afterFieldMaxMs, 100);
        after = refresh();
      }
      for (const res of out) {
        const e = after.fields.get(res.fieldId)?.field.error;
        if (e && res.ok) res.error = `Filled, but the page reports: ${e}`;
      }
      return out;
    },

    async upload(fieldId: string, file: UploadFile): Promise<FillResult> {
      try {
        const r = ref(fieldId);
        if (r.field.kind !== "file") return { fieldId, ok: false, error: "Not a file field." };
        r.container.scrollIntoView?.({ block: "center" });
        const w = win(doc);
        const bytes = Uint8Array.from(w.atob(file.base64), (ch) => ch.charCodeAt(0));
        const f = new w.File([bytes], file.name, { type: file.mimeType });
        return { fieldId, ...(await uploadFile(r.container, f)) };
      } catch (err) {
        return { fieldId, ok: false, error: (err as Error).message };
      }
    },

    async remove(fieldId: string, values?: string[] | null): Promise<RemoveResult> {
      try {
        const r = ref(fieldId);
        r.container.scrollIntoView?.({ block: "center" });
        return { fieldId, ...(await removeItems(r, values)) };
      } catch (err) {
        return { fieldId, ok: false, removed: [], remaining: [], error: (err as Error).message };
      }
    },

    /**
     * Delete a saved item: a tile (language, license) by its delete button, a timeline entry (work, education) by
     * the delete button it shows while hovered. Done once there are fewer saved items.
     */
    async removeRepeatable(sectionId: string): Promise<RemoveRowResult> {
      const item = refresh().rows.get(sectionId);
      if (!item) {
        return {
          sectionId,
          ok: false,
          error: `No removable item "${sectionId}". Call get_form: items that can be removed are marked removable.`,
        };
      }
      const count = () => savedItems(doc).length;
      const before = count();
      item.el.scrollIntoView?.({ block: "center" });
      let button: HTMLElement | null = null;
      if (item.kind === "tile") button = item.el.querySelector<HTMLElement>(SEL.tileDelete);
      else {
        const w = win(doc);
        item.el.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
        item.el.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true }));
        button = await waitFor(() => item.el.querySelector<HTMLElement>(SEL.timelineDelete), T.removeRowMs);
      }
      if (!button) return { sectionId, ok: false, error: `"${item.title}" shows no delete button.` };
      if (isSubmitControl(button)) return { sectionId, ok: false, error: "Refusing to press a submit control." };
      press(button);
      // A timeline entry goes a second after its delete is pressed.
      if (!(await waitFor(() => count() < before, T.removeRowMs))) {
        await confirmRemoval(doc);
        await waitFor(() => count() < before, T.removeRowConfirmMs);
      }
      await settle(doc, T.rowQuietMs, T.rowMaxMs);
      return count() < before
        ? { sectionId, ok: true, removed: item.title }
        : { sectionId, ok: false, error: `"${item.title}" is still there.` };
    },

    /**
     * Press an add button (an inline form opens, or a row such as another link appears), or the Save button of an
     * open inline form (`save.*`), which adds the item once the page accepts it.
     */
    async addRepeatable(addButtonId: string): Promise<{ ok: boolean; error?: string }> {
      let b = last?.addButtons.get(addButtonId);
      if (!b?.isConnected) b = refresh().addButtons.get(addButtonId);
      if (!b) return { ok: false, error: `Unknown add button "${addButtonId}". Call get_form again.` };
      if (isSubmitControl(b)) return { ok: false, error: "Refusing to press a submit control." };
      const button = b;
      if (addButtonId.startsWith("save.")) {
        // The form and its Save button's footer are siblings in the block: its errors show there.
        const scope: ParentNode = button.closest(SEL.block) ?? doc;
        const errorsIn = () => [...scope.querySelectorAll(SEL.inlineErrors)].filter(isVisible).length;
        press(button);
        const closed = await waitFor(() => !button.isConnected || !isVisible(button) || errorsIn() > 0, T.addRowMs);
        await settle(doc, T.rowQuietMs, T.rowMaxMs);
        if (!button.isConnected || !isVisible(button)) return { ok: true };
        const errors = pageErrors(doc);
        return {
          ok: false,
          error: closed && errors.length ? `Not saved: ${errors.join(" ")}` : "The form is still open.",
        };
      }
      const before = rowCount();
      press(button);
      const grew = await waitFor(() => rowCount() > before, T.addRowMs);
      await settle(doc, T.rowQuietMs, T.rowMaxMs);
      return grew ? { ok: true } : { ok: false, error: "No new fields appeared." };
    },

    /**
     * Press Next and report whether the section changed. The single-page flow has no Next, only Submit, which
     * the user presses; so does the last section of the multi-page flow.
     */
    async next(): Promise<NextResult> {
      const before = refresh();
      const kind = before.schema.pageKind;
      const summary = (advanced: boolean, extra: Partial<NextResult> = {}): NextResult => {
        const s = stepInfo(doc);
        const messages = pageMessages(doc);
        return {
          advanced,
          pageKind: kindNow(),
          ...(s ? { step: s } : {}),
          errors: pageErrors(doc),
          ...(messages.length ? { messages } : {}),
          ...extra,
        };
      };
      if (kind === "confirmation") return summary(false, { refusedReason: "The application was already submitted." });
      if (kind === "auth") {
        return summary(false, { refusedReason: "This is the sign-in (email) step. The user completes it themselves." });
      }
      const button = nextButton(doc);
      if (!button) return summary(false, { refusedReason: "No Next button found." });
      if (isSubmitControl(button)) {
        return summary(false, {
          refusedReason:
            "The only way forward is Submit: every section is filled on this page. The user reviews it and presses Submit.",
        });
      }
      const stepKey = () => `${getUrl()}|${JSON.stringify(stepInfo(doc) ?? null)}`;
      const keyBefore = stepKey();
      const errorsBefore = pageErrors(doc).join("\u0001");
      press(button);
      await waitFor(
        () =>
          stepKey() !== keyBefore || (pageErrors(doc).length > 0 && pageErrors(doc).join("\u0001") !== errorsBefore),
        T.stepMs,
        150,
      );
      await settle(doc, T.stepQuietMs, T.stepMaxMs);
      const after = summary(false);
      return { ...after, advanced: stepKey() !== keyBefore || after.pageKind !== kind };
    },

    async back(): Promise<BackResult> {
      const before = refresh();
      const summary = (moved: boolean, extra: Partial<BackResult> = {}): BackResult => {
        const s = stepInfo(doc);
        return { moved, pageKind: kindNow(), ...(s ? { step: s } : {}), errors: pageErrors(doc), ...extra };
      };
      if (before.schema.pageKind === "confirmation") {
        return summary(false, { refusedReason: "The application was already submitted." });
      }
      const button = backButton(doc);
      if (!button)
        return summary(false, { refusedReason: "No Previous button on this page (it's the first section)." });
      if (isSubmitControl(button)) return summary(false, { refusedReason: "Refusing to press a submit control." });
      const keyBefore = `${getUrl()}|${JSON.stringify(stepInfo(doc) ?? null)}`;
      press(button);
      const changed = await waitFor(
        () => `${getUrl()}|${JSON.stringify(stepInfo(doc) ?? null)}` !== keyBefore,
        T.stepMs,
        150,
      );
      await settle(doc, T.stepQuietMs, T.stepMaxMs);
      return summary(Boolean(changed));
    },

    /** `apply` (the posting's Apply Now) and `use_last_application` (Use My Profile, for a returning candidate). */
    async pageAction(action: PageAction): Promise<{ ok: boolean; pageKind: PageKind; error?: string }> {
      const el = actionButton(doc, action);
      if (!el) return { ok: false, pageKind: kindNow(), error: `No "${action}" control on this page.` };
      if (isSubmitControl(el)) return { ok: false, pageKind: kindNow(), error: "Refusing to press a submit control." };
      press(el);
      await settle(doc, T.pageActionQuietMs, T.pageActionMaxMs);
      return { ok: true, pageKind: kindNow() };
    },

    /** For diagnostics: synthetic submit attempts that were blocked. */
    blockedSubmitAttempts(): string[] {
      return [...blocked];
    },
  };
}

export type OracleApi = ReturnType<typeof createOracleApi>;
