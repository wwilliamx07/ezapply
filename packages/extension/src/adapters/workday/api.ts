import type {
  FillAction,
  FillResult,
  NextResult,
  OptionInfo,
  PageAction,
  PageKind,
  UploadFile,
} from "@ezapply/protocol";
import { press, settle, text, waitFor } from "./dom.js";
import {
  detectPage,
  type Extraction,
  extract,
  isSubmitControl,
  nextButton,
  type PageSchema,
  pageErrors,
  stepInfo,
} from "./extract.js";
import { fillField, listDropdown, listTypeahead, searchTypeahead, uploadFile } from "./fill.js";
import { SEL } from "./selectors.js";

export const ADAPTER_VERSION = "1";

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
        await settle(doc, 120, 1500);
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
        const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
        const f = new File([bytes], file.name, { type: file.mimeType });
        return { fieldId, ...(await uploadFile(r.container, f)) };
      } catch (err) {
        return { fieldId, ok: false, error: (err as Error).message };
      }
    },

    async addRepeatable(addButtonId: string): Promise<{ ok: boolean; error?: string }> {
      let b = last?.addButtons.get(addButtonId);
      if (!b?.isConnected) b = refresh().addButtons.get(addButtonId);
      if (!b) return { ok: false, error: `Unknown add button "${addButtonId}". Call get_form again.` };
      if (isSubmitControl(b)) return { ok: false, error: "Refusing to press a submit control." };
      const before = doc.querySelectorAll(SEL.fieldContainer).length;
      press(b);
      const grew = await waitFor(() => doc.querySelectorAll(SEL.fieldContainer).length > before, 4000);
      await settle(doc, 200, 2000);
      return grew ? { ok: true } : { ok: false, error: "No new fields appeared." };
    },

    async next(): Promise<NextResult> {
      const before = refresh();
      const kind = before.schema.pageKind;
      const button = nextButton(doc);
      const summary = (advanced: boolean, extra: Partial<NextResult> = {}): NextResult => {
        const s = stepInfo(doc);
        return {
          advanced,
          pageKind: detectPage(doc, extract(doc, getUrl()).fields.size),
          ...(s ? { step: s } : {}),
          errors: pageErrors(doc),
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
      const stepBefore = before.schema.step?.title ?? "";
      press(button);
      const changed = await waitFor(
        () => (stepInfo(doc)?.title ?? "") !== stepBefore || pageErrors(doc).length > 0,
        12000,
        150,
      );
      await settle(doc, 300, 4000);
      return summary(Boolean(changed) && (stepInfo(doc)?.title ?? "") !== stepBefore);
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
      await settle(doc, 400, 8000);
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
