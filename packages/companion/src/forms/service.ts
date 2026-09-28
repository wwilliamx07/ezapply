import { appendFile, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  ErrorCode,
  EzError,
  type Field,
  type FillResult,
  type FillValue,
  type FormSchema,
  type OptionInfo,
  type PageAction,
  type PostingMeta,
  type PostingStatus,
  type TabInfo,
  workdayTenant,
} from "@ezapply/protocol";
import type { ExtensionBridge } from "../bridge/server.js";
import type { ReviewService } from "../documents/review.js";
import type { Logger } from "../logger.js";
import type { PostingsService } from "../postings/service.js";
import { KeyedQueue } from "../util/keyed-queue.js";
import type { Workspace } from "../workspace/workspace.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const STATUS_ORDER: PostingStatus[] = ["captured", "drafting", "attached", "filled", "submitted"];

export type FillSource = "profile" | "answer-bank" | "computed" | "user" | "judgment";

/** The active posting's tenant differs from the application tab's: nothing was logged or moved. */
export interface PostingMismatch {
  activePosting: { id: string; company?: string; role?: string; tenant: string };
  formTenant: string;
  hint: string;
}

/** The tab a form call acts on and the posting it's credited to. */
interface Target {
  tab: TabInfo;
  /** The active posting, when this tab may belong to it (same tenant, or no tenant to compare). */
  posting: PostingMeta | null;
  mismatch?: PostingMismatch;
}

/**
 * The form tools' logic: which tab to act on, which posting an action belongs to, the form-log.jsonl audit
 * trail, automatic status moves, reading files for upload, and trimming get_form for Claude's context.
 *
 * Every action is credited to the active posting only when the application tab is on that posting's
 * Workday tenant (or one of them has no tenant to compare). Otherwise, with two applications open or an
 * old confirmation page on screen, a fill or a `submitted` status would land on the wrong posting.
 *
 * Calls on one tab run one at a time (`onTab`).
 */
export class FormsService {
  /** One queue per tab id: the page can only do one thing at a time. */
  private readonly pages = new KeyedQueue();

  constructor(
    private readonly ws: Workspace,
    private readonly postings: PostingsService,
    private readonly bridge: ExtensionBridge,
    private readonly reviews: ReviewService,
    private readonly log: Logger,
  ) {}

  async getForm(opts: { tabId?: number; onlyEmpty?: boolean; section?: string } = {}) {
    return this.onTab(opts.tabId, async (t) => {
      const form = await this.bridge.call("form.get", { tabId: t.tab.tabId }, 20_000);
      if (form.pageKind === "confirmation") {
        await this.setStatus(t, "submitted");
        await this.logEvent(t, { event: "confirmation-seen", url: form.url });
      }
      if (form.pageKind === "review") await this.setStatus(t, "filled");
      return {
        ...leanForm(form, opts),
        ...(t.posting ? { posting: t.posting.id } : {}),
        ...(t.mismatch ? { postingMismatch: t.mismatch } : {}),
      };
    });
  }

  async listOptions(fieldId: string, tabId?: number) {
    return this.onTab(tabId, (t) => this.bridge.call("form.listOptions", { fieldId, tabId: t.tab.tabId }, 20_000));
  }

  /**
   * Options of several fields in one call (every dropdown question on a step), so Claude doesn't spend a turn
   * per field. The adapter opens them one after another; a field that fails reports its own error.
   */
  async listOptionsMany(fieldIds: string[], tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const out: Record<string, OptionInfo[] | { error: string }> = {};
      for (const fieldId of fieldIds) {
        out[fieldId] = await this.bridge
          .call("form.listOptions", { fieldId, tabId: t.tab.tabId }, 20_000)
          .catch((err: unknown) => ({ error: EzError.from(err).message }));
      }
      return out;
    });
  }

  async searchOptions(fieldId: string, query: string, tabId?: number) {
    return this.onTab(tabId, (t) =>
      this.bridge.call("form.searchOptions", { fieldId, query, tabId: t.tab.tabId }, 20_000),
    );
  }

  async fill(
    fills: { fieldId: string; value: FillValue; source: FillSource; answerId?: string }[],
    tabId?: number,
  ): Promise<{ results: FillResult[]; postingMismatch?: PostingMismatch }> {
    return this.onTab(tabId, async (t) => {
      const results = await this.bridge.call(
        "form.fill",
        { fills: fills.map(({ fieldId, value }) => ({ fieldId, value })), tabId: t.tab.tabId },
        120_000,
      );
      for (const f of fills) {
        const r = results.find((x) => x.fieldId === f.fieldId);
        await this.logEvent(t, {
          event: "fill",
          fieldId: f.fieldId,
          value: f.value,
          source: f.source,
          ...(f.answerId ? { answerId: f.answerId } : {}),
          ok: r?.ok ?? false,
          ...(r?.error ? { error: r.error } : {}),
        });
      }
      return {
        results: results.map((r) => leanFillResult(r, fills.find((f) => f.fieldId === r.fieldId)?.value)),
        ...(t.mismatch ? { postingMismatch: t.mismatch } : {}),
      };
    });
  }

  async upload(fieldId: string, path: string, tabId?: number) {
    const abs = this.ws.resolveAllowed(path, ["postings", "library"]);
    const size = (await stat(abs).catch(() => null))?.size;
    if (size === undefined) throw new EzError(ErrorCode.NotFound, `File not found: ${abs}`);
    if (size > MAX_UPLOAD_BYTES) {
      throw new EzError(ErrorCode.BadRequest, `File is ${(size / 1e6).toFixed(1)} MB.`, "Use pdf_compress first.");
    }
    // In the after-approval mode a generated document goes out only in a version the user approved.
    if ((await this.reviews.needsApproval(abs)) && !(await this.reviews.isApproved(abs))) {
      throw new EzError(
        ErrorCode.BadRequest,
        `${basename(abs)} hasn't been approved in this version.`,
        "Documents are attached after the user approves them: show it with review_open, wait with review_wait, " +
          "and attach once they approve on the page. (They can switch to attaching right away: attach_mode_set.)",
      );
    }
    const file = {
      name: basename(abs),
      mimeType: MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
      base64: (await readFile(abs)).toString("base64"),
    };
    return this.onTab(tabId, async (t) => {
      const result = await this.bridge.call("form.upload", { fieldId, file, tabId: t.tab.tabId }, 90_000);
      await this.logEvent(t, {
        event: "upload",
        fieldId,
        file: abs,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
      if (result.ok) await this.setStatus(t, "attached");
      return withMismatch(result, t);
    });
  }

  async remove(fieldId: string, values: string[] | undefined, reason: string | undefined, tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const result = await this.bridge
        .call("form.remove", { fieldId, ...(values ? { values } : {}), tabId: t.tab.tabId }, 60_000)
        .catch(olderExtension("form.remove", "remove items"));
      await this.logEvent(t, {
        event: "remove",
        fieldId,
        removed: result.removed,
        remaining: result.remaining,
        ...(reason ? { reason } : {}),
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
      return withMismatch(result, t);
    });
  }

  async removeRepeatable(sectionId: string, reason: string | undefined, tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const result = await this.bridge
        .call("form.removeRepeatable", { sectionId, tabId: t.tab.tabId }, 30_000)
        .catch(olderExtension("form.removeRepeatable", "remove rows"));
      await this.logEvent(t, {
        event: "remove-row",
        sectionId,
        ...(result.removed ? { removed: result.removed } : {}),
        ...(reason ? { reason } : {}),
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
      return withMismatch(result, t);
    });
  }

  async addRepeatable(addButtonId: string, tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const result = await this.bridge.call("form.addRepeatable", { addButtonId, tabId: t.tab.tabId }, 20_000);
      return withMismatch(result, t);
    });
  }

  async next(tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const r = await this.bridge.call("form.next", { tabId: t.tab.tabId }, 60_000);
      await this.logEvent(t, {
        event: "next",
        advanced: r.advanced,
        pageKind: r.pageKind,
        step: r.step?.title,
        ...(r.step?.index ? { stepIndex: r.step.index } : {}),
      });
      if (r.pageKind === "review") await this.setStatus(t, "filled");
      return withMismatch(r, t);
    });
  }

  async back(tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const r = await this.bridge
        .call("form.back", { tabId: t.tab.tabId }, 60_000)
        .catch(olderExtension("form.back", "go back"));
      await this.logEvent(t, { event: "back", moved: r.moved, pageKind: r.pageKind, step: r.step?.title });
      return withMismatch(r, t);
    });
  }

  async pageAction(action: PageAction, tabId?: number) {
    return this.onTab(tabId, async (t) => {
      const r = await this.bridge.call("form.pageAction", { action, tabId: t.tab.tabId }, 30_000);
      return withMismatch(r, t);
    });
  }

  async screenshot(tabId?: number) {
    return this.onTab(tabId, (t) => this.bridge.call("tab.screenshot", { tabId: t.tab.tabId }, 15_000));
  }

  /**
   * Choose the tab, then run `fn` on it after any earlier form call on the same tab has finished. Claude Code
   * makes tool calls in parallel, and two calls acting on one page at once interfere: two dropdown reads
   * each open a listbox, and both can read whichever is on screen; a fill can land while `go_next` changes
   * the step. The page is one shared thing, so calls on a tab run one at a time, in the order they came;
   * different tabs still run side by side.
   */
  private async onTab<T>(tabId: number | undefined, fn: (t: Target) => Promise<T>): Promise<T> {
    const t = await this.target(tabId);
    return this.pages.run(String(t.tab.tabId), () => fn(t));
  }

  /**
   * Choose the tab: the one asked for; else a Workday tab on the active posting's tenant (the one the user
   * is looking at, else the most recently used); else any Workday tab, the same way. Then decide whether
   * the active posting may be credited with what happens there.
   */
  private async target(tabId?: number): Promise<Target> {
    const { tabs } = await this.bridge.call("browser.status", {}, 5_000);
    const activeId = await this.postings.activeId();
    const active = activeId ? await this.postings.get(activeId).catch(() => null) : null;
    const postingTenant = active ? postingTenantOf(active) : undefined;

    let tab: TabInfo | undefined;
    if (tabId !== undefined) {
      tab = tabs.find((t) => t.tabId === tabId);
      if (!tab) {
        throw new EzError(ErrorCode.NotFound, `Tab ${tabId} no longer exists.`, "Call browser_status for open tabs.");
      }
    } else {
      const workday = tabs.filter((t) => t.site === "workday");
      tab =
        pickTab(postingTenant ? workday.filter((t) => workdayTenant(t.url) === postingTenant) : []) ?? pickTab(workday);
      if (!tab) {
        throw new EzError(
          ErrorCode.NotFound,
          "No Workday tab is open.",
          "Ask the user to open the application (click Apply on the posting) in the browser.",
        );
      }
    }

    const formTenant = workdayTenant(tab.url);
    if (active && postingTenant && formTenant && postingTenant !== formTenant) {
      const label = [active.company, active.role].filter(Boolean).join(": ") || active.id;
      return {
        tab,
        posting: null,
        mismatch: {
          activePosting: {
            id: active.id,
            ...(active.company ? { company: active.company } : {}),
            ...(active.role ? { role: active.role } : {}),
            tenant: postingTenant,
          },
          formTenant,
          hint:
            `This tab is on Workday tenant "${formTenant}", but the active posting (${label}) is on ` +
            `"${postingTenant}", so nothing was logged and no status changed. If the user is applying to ` +
            "another job, activate its posting (postings_list with a company filter, then posting_activate) " +
            "or have them capture it with Set posting; otherwise switch to the right tab.",
        },
      };
    }
    return { tab, posting: active };
  }

  /** Append to the posting's form-log.jsonl: the audit trail for "what did we submit". */
  private async logEvent(t: Target, event: Record<string, unknown>): Promise<void> {
    if (!t.posting) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    await appendFile(join(this.postings.folder(t.posting.id), "form-log.jsonl"), `${line}\n`, "utf8");
  }

  /** Move the posting's status forward, never back. */
  private async setStatus(t: Target, status: PostingStatus): Promise<void> {
    if (!t.posting) return;
    const meta = await this.postings.get(t.posting.id);
    if (STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(meta.status)) {
      await this.postings.updateMeta(t.posting.id, { status });
      this.log.info({ id: t.posting.id, status }, "posting status moved by form activity");
    }
  }
}

/** The tenant a posting belongs to: read from its URL when it's a Workday page, else as stored. */
function postingTenantOf(meta: PostingMeta): string | undefined {
  return workdayTenant(meta.url) ?? meta.tenant;
}

function pickTab(tabs: TabInfo[]): TabInfo | undefined {
  const looking = tabs.find((t) => t.focused ?? t.active);
  return looking ?? [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/**
 * A clean success that reads back exactly what was asked for says nothing new, so it's just `{ fieldId, ok }`.
 * A read-back that differs (a matched option's full text, a changed case), any error, and typeahead entries
 * that matched nothing or only roughly are kept whole.
 */
export function leanFillResult(r: FillResult, value: FillValue | undefined): FillResult {
  if (!r.ok || r.error || r.availableOptions || r.unmatched || r.inexact || value === undefined) return r;
  const back = r.readBack;
  const same = Array.isArray(value)
    ? Array.isArray(back) && back.length === value.length && value.every((v, i) => back[i] === v)
    : back === value || (typeof value !== "boolean" && back === String(value));
  return same ? { fieldId: r.fieldId, ok: true } : r;
}

function withMismatch<T extends object>(result: T, t: Target): T & { postingMismatch?: PostingMismatch } {
  return t.mismatch ? { ...result, postingMismatch: t.mismatch } : result;
}

/** An extension built before a method existed answers "Unknown method": say what to do about it. */
function olderExtension(method: string, what: string) {
  return (err: unknown): never => {
    const e = EzError.from(err);
    if (e.message.includes(`Unknown method ${method}`)) {
      throw new EzError(
        ErrorCode.BadRequest,
        `The browser extension is older than this companion and can't ${what}.`,
        "Ask the user to rebuild (npm run build) and reload the ezapply extension, then retry.",
      );
    }
    throw e;
  };
}

/**
 * get_form is the largest result and is read at every step, so leave out what carries no information:
 * `required: false`, `multiple: false`, empty option lists, `optionsLazy` (always true for dropdowns and
 * typeaheads) and the raw automation id (the field id already contains it). `onlyEmpty` keeps fields that
 * are empty or show an error; `section` keeps sections whose id or title contains it.
 */
export function leanForm(form: FormSchema, opts: { onlyEmpty?: boolean; section?: string } = {}) {
  const wanted = opts.section?.toLowerCase();
  const sections = form.sections
    .filter((s) => !wanted || s.id.toLowerCase().includes(wanted) || s.title.toLowerCase().includes(wanted))
    .map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.removable ? { removable: true } : {}),
      fields: s.fields.filter((f) => !opts.onlyEmpty || isEmpty(f) || f.error).map(leanField),
    }))
    .filter((s) => s.fields.length > 0 || !opts.onlyEmpty);
  return { ...form, sections };
}

function leanField(f: Field) {
  const { automationId: _a, optionsLazy: _l, required, multiple, options, ...rest } = f;
  return {
    ...rest,
    ...(required ? { required } : {}),
    ...(multiple ? { multiple } : {}),
    ...(options && options.length > 0 ? { options } : {}),
  };
}

function isEmpty(f: Field): boolean {
  const v = f.currentValue;
  return v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}
