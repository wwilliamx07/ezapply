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
import { press, settle, text, waitFor, win } from "./dom.js";
import {
  backButton,
  detectPage,
  type Extraction,
  extract,
  isSubmitControl,
  nextButton,
  type PageSchema,
  pageErrors,
  pageMessages,
  stepInfo,
} from "./extract.js";
import {
  confirmRemoval,
  fillField,
  listDropdown,
  listTypeahead,
  removeItems,
  searchTypeahead,
  uploadFile,
} from "./fill.js";
import { SEL } from "./selectors.js";
import { setTiming, T } from "./timing.js";

declare const __ADAPTER_VERSION__: string | undefined;

/**
 * Identifies this build of the adapter, so a tab holding an older injected copy gets the new one. build.mjs
 * stamps a hash of the bundle; unbundled (tests) it's "dev".
 */
export const ADAPTER_VERSION: string = typeof __ADAPTER_VERSION__ === "string" ? __ADAPTER_VERSION__ : "dev";

/**
 * The adapter surface the service worker calls (via chrome.scripting in the MAIN world).
 * Holds the field registry from the last extraction; lookups re-extract when elements went stale.
 */
export function createWorkdayApi(doc: Document, getUrl: () => string) {
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
      if (r.field.kind === "dropdown") return listDropdown(r.container);
      if (r.field.kind === "typeahead") return listTypeahead(r.container);
      return (r.field.options ?? []).map((label) => ({ label }));
    },

    async searchOptions(fieldId: string, query: string): Promise<OptionInfo[]> {
      const r = ref(fieldId);
      if (r.field.kind !== "typeahead") throw new Error("search_options only applies to typeahead fields.");
      return searchTypeahead(r.container, query);
    },

    async fill(fills: FillAction[]): Promise<FillResult[]> {
      const out: FillResult[] = [];
      for (const f of fills) {
        try {
          const r = ref(f.fieldId);
          r.container.scrollIntoView?.({ block: "center" });
          out.push({ fieldId: f.fieldId, ...(await fillField(r, f.value)) });
        } catch (err) {
          out.push({ fieldId: f.fieldId, ok: false, error: (err as Error).message });
        }
        await settle(doc, T.afterFieldQuietMs, T.afterFieldMaxMs);
      }
      // Surface validation errors that appeared as a result of filling.
      const after = refresh();
      for (const res of out) {
        const e = after.fields.get(res.fieldId)?.field.error;
        if (e && res.ok) res.error = `Filled, but the page reports: ${e}`;
      }
      return out;
    },

    async upload(fieldId: string, file: UploadFile): Promise<FillResult> {
      try {
        const r = ref(fieldId);
        const w = win(doc);
        const bytes = Uint8Array.from(w.atob(file.base64), (ch) => ch.charCodeAt(0));
        const f = new w.File([bytes], file.name, { type: file.mimeType });
        return { fieldId, ...(await uploadFile(r.container, f)) };
      } catch (err) {
        return { fieldId, ok: false, error: (err as Error).message };
      }
    },

    /** Remove selected values (multi-select) or attached files; `values` null or absent = all of them. */
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
     * Delete one repeatable row (e.g. a work-history entry carried over from the last application) with its
     * own Delete button, confirming a dialog if one appears. Done once the page has fewer fields.
     */
    async removeRepeatable(sectionId: string): Promise<RemoveRowResult> {
      const row = refresh().rows.get(sectionId);
      if (!row) {
        return {
          sectionId,
          ok: false,
          error: `No removable row "${sectionId}". Call get_form: rows that can be removed are marked removable.`,
        };
      }
      if (isSubmitControl(row.button)) return { sectionId, ok: false, error: "Refusing to press a submit control." };
      const count = () => doc.querySelectorAll(SEL.fieldContainer).length;
      const before = count();
      row.button.scrollIntoView?.({ block: "center" });
      press(row.button);
      if (!(await waitFor(() => count() < before, T.removeRowMs))) {
        await confirmRemoval(doc);
        await waitFor(() => count() < before, T.removeRowConfirmMs);
      }
      await settle(doc, T.rowQuietMs, T.rowMaxMs);
      return count() < before
        ? { sectionId, ok: true, removed: row.title }
        : { sectionId, ok: false, error: `"${row.title}" is still there.` };
    },

    async addRepeatable(addButtonId: string): Promise<{ ok: boolean; error?: string }> {
      let b = last?.addButtons.get(addButtonId);
      if (!b?.isConnected) b = refresh().addButtons.get(addButtonId);
      if (!b) return { ok: false, error: `Unknown add button "${addButtonId}". Call get_form again.` };
      if (isSubmitControl(b)) return { ok: false, error: "Refusing to press a submit control." };
      const before = doc.querySelectorAll(SEL.fieldContainer).length;
      press(b);
      const grew = await waitFor(() => doc.querySelectorAll(SEL.fieldContainer).length > before, T.addRowMs);
      await settle(doc, T.rowQuietMs, T.rowMaxMs);
      return grew ? { ok: true } : { ok: false, error: "No new fields appeared." };
    },

    /**
     * Press Next and report whether the step changed: its index, title or page kind. Live step titles are often
     * all "Application", so comparing titles alone said `advanced: false` on every move and waited out the
     * full timeout. The wait ends on a new step or on validation errors; notices such as "successfully
     * uploaded" don't count as errors.
     */
    async next(): Promise<NextResult> {
      const before = refresh();
      const kind = before.schema.pageKind;
      const button = nextButton(doc);
      const summary = (advanced: boolean, extra: Partial<NextResult> = {}): NextResult => {
        const s = stepInfo(doc);
        const messages = pageMessages(doc);
        return {
          advanced,
          pageKind: detectPage(doc, extract(doc, getUrl()).fields.size),
          ...(s ? { step: s } : {}),
          errors: pageErrors(doc),
          ...(messages.length ? { messages } : {}),
          ...extra,
        };
      };
      if (kind === "review" || kind === "confirmation") {
        return summary(false, { refusedReason: "This is the review page. The user must press Submit themselves." });
      }
      if (!button) return summary(false, { refusedReason: "No Next / Save and Continue button found." });
      if (isSubmitControl(button)) {
        return summary(false, { refusedReason: `The forward button is "${text(button)}". The user must press it.` });
      }
      const stepKey = () => {
        const s = stepInfo(doc);
        return `${s?.index ?? ""}|${s?.title ?? ""}`;
      };
      const keyBefore = stepKey();
      press(button);
      await waitFor(() => stepKey() !== keyBefore || pageErrors(doc).length > 0, T.stepMs, 150);
      await settle(doc, T.stepQuietMs, T.stepMaxMs);
      const after = summary(false);
      return { ...after, advanced: stepKey() !== keyBefore || after.pageKind !== kind };
    },

    /**
     * Press Back to the previous step, e.g. to correct an answer from the review page. Allowed anywhere there
     * is a Back button except after submitting; it never touches a submit control.
     */
    async back(): Promise<BackResult> {
      const before = refresh();
      const summary = (moved: boolean, extra: Partial<BackResult> = {}): BackResult => {
        const s = stepInfo(doc);
        return {
          moved,
          pageKind: detectPage(doc, extract(doc, getUrl()).fields.size),
          ...(s ? { step: s } : {}),
          errors: pageErrors(doc),
          ...extra,
        };
      };
      if (before.schema.pageKind === "confirmation") {
        return summary(false, { refusedReason: "The application was already submitted." });
      }
      const button = backButton(doc);
      if (!button) return summary(false, { refusedReason: "No Back button on this page (it's the first step)." });
      if (isSubmitControl(button)) return summary(false, { refusedReason: "Refusing to press a submit control." });
      const stepBefore = before.schema.step?.title ?? "";
      press(button);
      const changed = await waitFor(() => (stepInfo(doc)?.title ?? "") !== stepBefore, T.stepMs, 150);
      await settle(doc, T.stepQuietMs, T.stepMaxMs);
      return summary(Boolean(changed));
    },

    async pageAction(action: PageAction): Promise<{ ok: boolean; pageKind: PageKind; error?: string }> {
      const selector = {
        apply: SEL.applyButton,
        apply_manually: SEL.applyManually,
        autofill_with_resume: SEL.autofillWithResume,
        use_last_application: SEL.useLastApplication,
      }[action];
      const el = doc.querySelector<HTMLElement>(selector);
      if (!el) return { ok: false, pageKind: detectPage(doc, 0), error: `No "${action}" control on this page.` };
      if (isSubmitControl(el))
        return { ok: false, pageKind: detectPage(doc, 0), error: "Refusing to press a submit control." };
      press(el);
      await settle(doc, T.pageActionQuietMs, T.pageActionMaxMs);
      return { ok: true, pageKind: detectPage(doc, extract(doc, getUrl()).fields.size) };
    },

    /** For diagnostics: synthetic submit attempts that were blocked. */
    blockedSubmitAttempts(): string[] {
      return [...blocked];
    },
  };
}

export type WorkdayApi = ReturnType<typeof createWorkdayApi>;

/**
 * Hard guarantee that nothing but a real user gesture can submit: synthetic (untrusted) events aimed
 * at a submit control are cancelled before the page sees them. Real clicks are always trusted.
 */
export function installSubmitGuard(doc: Document): string[] {
  const marker = "__ezapplySubmitGuard";
  const holder = doc as unknown as Record<string, string[] | undefined>;
  const existing = holder[marker];
  if (existing) return existing;
  const log: string[] = [];
  holder[marker] = log;
  const block = (e: Event) => {
    if (e.isTrusted) return;
    const target = e.target as Element | null;
    const isKey = e.type === "keydown" || e.type === "keyup";
    if (isKey && !["Enter", " "].includes((e as KeyboardEvent).key)) return;
    if (!isSubmitControl(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    log.push(
      `${new Date().toISOString()} blocked synthetic ${e.type} on "${text(target?.closest("button,[role=button],a,input") ?? null)}"`,
    );
  };
  for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "submit"]) {
    doc.addEventListener(type, block, true);
  }
  return log;
}
