import { appendFile, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import {
  ErrorCode,
  EzError,
  type Field,
  type FillResult,
  type FillValue,
  type FormSchema,
  isFormSite,
  type OptionInfo,
  type PageAction,
  type PostingMeta,
  type PostingStatus,
  siteTenant,
  type TabInfo,
  type Timing,
} from "@ezapply/protocol";
import type { ExtensionBridge } from "../bridge/server.js";
import type { ReviewService } from "../documents/review.js";
import type { Logger } from "../logger.js";
import type { PostingsService } from "../postings/service.js";
import type { ProfileService } from "../profile/service.js";
import { KeyedQueue } from "../util/keyed-queue.js";
import type { Workspace } from "../workspace/workspace.js";
import { checkReadBack, type LeftReason, type PlannedFill, planStep } from "./autofill.js";
import { type CallRecord, DebugRecorder, stripBulk } from "./debug.js";
import { loadTiming } from "./timing.js";

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

/** The tab chosen for a call, before it runs. */
type TargetBase = Pick<Target, "tab" | "posting" | "mismatch"> & { extensionVersion?: string };

/** The tab a form call acts on and the posting it's credited to. */
interface Target {
  tab: TabInfo;
  /** The active posting, when this tab may belong to it (same tenant, or no tenant to compare). */
  posting: PostingMeta | null;
  mismatch?: PostingMismatch;
  /** The adapter's waits for this call, from autofill-timing.yaml. */
  timing?: Timing;
  /** How long to wait for one form.fill (autofill-timing.yaml's fillTimeoutSeconds). */
  fillTimeoutMs: number;
  /** Problems in autofill-timing.yaml (those settings fell back to their defaults). */
  timingIssues: string[];
  /** What `tab.show` did just before this call; absent when the extension predates it or it failed. */
  shown?: Shown;
  /** The bridge for this call: the same one, recorded when debug mode is on. */
  bridge: Pick<ExtensionBridge, "call">;
  /** Add to the call's debug record (no-op when debug mode is off). */
  note: (key: string, value: unknown) => void;
  /** Debug mode is on for this call. */
  debug: boolean;
}

/** The tab brought to the front (`activated`), or left hidden: see `FormsService.show`. */
interface Shown {
  activated: boolean;
  hidden: boolean;
  /** A review page was waiting for the user, so the tab wasn't switched to. */
  reviewPending: boolean;
}

/** Said in a result when the application page is still hidden after `tab.show`. */
export interface TabHidden {
  hint: string;
}

/**
 * The form tools' logic: which tab to act on, which posting an action belongs to, the form-log.jsonl audit
 * trail, automatic status moves, reading files for upload, and trimming get_form for Claude's context.
 *
 * Every action is credited to the active posting only when the application tab is on that posting's
 * tenant: its Workday tenant or Oracle career site (or one of them has no tenant to compare). Otherwise, with two applications open or an
 * old confirmation page on screen, a fill or a `submitted` status would land on the wrong posting.
 *
 * Calls on one tab run one at a time (`onTab`).
 */
export class FormsService {
  /** One queue per tab id: the page can only do one thing at a time. */
  private readonly pages = new KeyedQueue();
  private readonly debug: DebugRecorder;
  private warnedNoTabShow = false;

  constructor(
    private readonly ws: Workspace,
    private readonly postings: PostingsService,
    private readonly bridge: ExtensionBridge,
    private readonly reviews: ReviewService,
    private readonly profile: ProfileService,
    private readonly log: Logger,
  ) {
    this.debug = new DebugRecorder(ws, log);
  }

  async getForm(opts: { tabId?: number; onlyEmpty?: boolean; section?: string } = {}) {
    return this.onTab({ tool: "get_form", params: opts }, opts.tabId, async (t) =>
      this.view(t, await t.bridge.call("form.get", { tabId: t.tab.tabId, timing: t.timing }, 20_000), opts),
    );
  }

  /**
   * get_form's result for a page read: the lean schema with what the agent must know about the call. Seeing the
   * review page sets status `filled` (and reports approved documents never attached); a confirmation page sets
   * `submitted`.
   */
  private async view(t: Target, form: FormSchema, opts: { onlyEmpty?: boolean; section?: string }) {
    if (form.pageKind === "confirmation") {
      await this.setStatus(t, "submitted");
      await this.logEvent(t, { event: "confirmation-seen", url: form.url });
    }
    if (form.pageKind === "review") await this.setStatus(t, "filled");
    const missing = form.pageKind === "review" ? await this.notAttached(t, "review") : undefined;
    return {
      ...leanForm(form, opts),
      ...(missing ? { notAttached: missing } : {}),
      ...(t.posting ? { posting: t.posting.id } : {}),
      ...(t.mismatch ? { postingMismatch: t.mismatch } : {}),
      ...tabHiddenOf(t),
      ...(t.timingIssues.length ? { timingIssues: t.timingIssues } : {}),
      // So debug mode isn't left on unnoticed: it records the user's data on every call.
      ...(t.debug ? { debug: true } : {}),
    };
  }

  /**
   * Fill what the profile and the answer bank decide on this step without the model (see `forms/autofill.ts`),
   * then return what was filled and only the fields left to decide. Two passes: fields that appear because of a
   * fill (a province list after the country) are planned on a second read. Never fills a tab that belongs to
   * another posting. With `forms.autofill: "off"` it fills nothing and returns the whole step as left.
   */
  async autofillStep(tabId?: number) {
    return this.onTab({ tool: "autofill_step", params: {} }, tabId, async (t) => {
      const read = () => t.bridge.call("form.get", { tabId: t.tab.tabId, timing: t.timing }, 20_000);
      let form = await read();
      // get_form's view of the page (it replaces get_form at the start of a step), narrowed to the fields left.
      const result = async (
        filled: AutofilledField[],
        failed: AutofillFailure[],
        kept: number,
        left: Map<string, LeftReason> | null,
        note?: string,
      ) => {
        const view = await this.view(t, form, {});
        const sections = leftSections(view.sections, failed, left);
        return { ...view, sections, filled, failed, kept, ...(note ? { note } : {}) };
      };
      const nothing = (note: string) => result([], [], 0, null, note);
      if (form.pageKind !== "step") return nothing(`Nothing to autofill on a ${form.pageKind} page.`);
      if (t.mismatch) return nothing("Not filled: this tab belongs to another posting.");
      if ((await this.ws.readConfig()).forms.autofill === "off") {
        return nothing("Autofill is off (forms.autofill in ezapply.config.json).");
      }
      const profile = await this.profile.profile();
      if (!profile.exists || !profile.valid) {
        return nothing("Not filled: profile/profile.yaml is missing or invalid (profile_check).");
      }
      const answers = await this.profile.answers();
      const input = {
        profile: profile.value,
        answers: answers.exists && answers.valid ? answers.value.entries : [],
        ...(t.posting?.company ? { company: t.posting.company } : {}),
      };

      const filled: AutofilledField[] = [];
      const failed: AutofillFailure[] = [];
      let kept = 0;
      const handled = new Set<string>();
      let left = new Map<string, LeftReason>();
      // The second pass plans fields that appeared after the first fill; a third is never needed for one step.
      for (let pass = 0; pass < 2; pass++) {
        const plan = planStep({ form, ...input, skip: handled });
        t.note("autofill", { pass: pass + 1, fills: plan.fills, kept: plan.kept, left: Object.fromEntries(plan.left) });
        kept += plan.kept.length;
        for (const k of plan.kept) handled.add(k.fieldId);
        left = new Map([...left, ...plan.left]);
        if (plan.fills.length === 0) break;
        const results = await t.bridge.call(
          "form.fill",
          {
            fills: plan.fills.map(({ fieldId, value }) => ({ fieldId, value })),
            tabId: t.tab.tabId,
            timing: t.timing,
          },
          t.fillTimeoutMs,
        );
        for (const f of plan.fills) {
          handled.add(f.fieldId);
          left.delete(f.fieldId);
          const r = results.find((x) => x.fieldId === f.fieldId) ?? { fieldId: f.fieldId, ok: false };
          const check = checkReadBack(f, r);
          t.note("readBack", { fieldId: f.fieldId, wanted: f.value, readBack: r.readBack, ...check });
          await this.logEvent(t, {
            event: "fill",
            fieldId: f.fieldId,
            value: f.value,
            source: f.source,
            ...(f.answerId ? { answerId: f.answerId } : {}),
            auto: true,
            rule: f.rule,
            ok: check.ok,
            ...(r.error ? { error: r.error } : !check.ok && r.ok ? { error: `inexact: ${check.selected ?? "?"}` } : {}),
          });
          if (check.ok) filled.push(filledEntry(f));
          else failed.push(failure(f, r, check.selected));
        }
        form = await read();
      }
      return result(filled, failed, kept, left);
    });
  }

  async listOptions(fieldId: string, tabId?: number) {
    return this.onTab({ tool: "list_options", params: { fieldId } }, tabId, (t) =>
      t.bridge.call("form.listOptions", { fieldId, tabId: t.tab.tabId, timing: t.timing }, 20_000),
    );
  }

  /**
   * Options of several fields in one call (every dropdown question on a step), so Claude doesn't spend a turn
   * per field. The adapter opens them one after another; a field that fails reports its own error.
   */
  async listOptionsMany(fieldIds: string[], tabId?: number) {
    return this.onTab({ tool: "list_options", params: { fieldIds } }, tabId, async (t) => {
      const out: Record<string, OptionInfo[] | { error: string }> = {};
      for (const fieldId of fieldIds) {
        out[fieldId] = await this.bridge
          .call("form.listOptions", { fieldId, tabId: t.tab.tabId, timing: t.timing }, 20_000)
          .catch((err: unknown) => ({ error: EzError.from(err).message }));
      }
      return out;
    });
  }

  async searchOptions(fieldId: string, query: string, tabId?: number) {
    return this.onTab({ tool: "search_options", params: { fieldId, query } }, tabId, (t) =>
      t.bridge.call("form.searchOptions", { fieldId, query, tabId: t.tab.tabId, timing: t.timing }, 20_000),
    );
  }

  async fill(
    fills: { fieldId: string; value: FillValue; source: FillSource; answerId?: string }[],
    tabId?: number,
  ): Promise<{ results: FillResult[]; postingMismatch?: PostingMismatch }> {
    return this.onTab({ tool: "fill_fields", params: { fills } }, tabId, async (t) => {
      const results = await t.bridge.call(
        "form.fill",
        { fills: fills.map(({ fieldId, value }) => ({ fieldId, value })), tabId: t.tab.tabId, timing: t.timing },
        t.fillTimeoutMs,
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
        ...tabHiddenOf(t),
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
        "Documents are attached after the user approves them: show it with review_documents { files }, " +
          "and attach once they approve on the page. (They can switch to attaching right away: attach_mode_set.)",
      );
    }
    const file = {
      name: basename(abs),
      mimeType: MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
      base64: (await readFile(abs)).toString("base64"),
    };
    return this.onTab({ tool: "upload_file", params: { fieldId, path } }, tabId, async (t) => {
      const result = await t.bridge.call(
        "form.upload",
        { fieldId, file, tabId: t.tab.tabId, timing: t.timing },
        90_000,
      );
      await this.logEvent(t, {
        event: "upload",
        fieldId,
        file: abs,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
      if (!result.ok) return annotate(result, t);
      await this.setStatus(t, "attached");
      const missing = await this.notAttached(t, "upload");
      return annotate(missing ? { ...result, notAttached: missing } : result, t);
    });
  }

  async remove(fieldId: string, values: string[] | undefined, reason: string | undefined, tabId?: number) {
    return this.onTab({ tool: "remove_items", params: { fieldId, values, reason } }, tabId, async (t) => {
      const result = await this.bridge
        .call("form.remove", { fieldId, ...(values ? { values } : {}), tabId: t.tab.tabId, timing: t.timing }, 60_000)
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
      return annotate(result, t);
    });
  }

  async removeRepeatable(sectionId: string, reason: string | undefined, tabId?: number) {
    return this.onTab({ tool: "remove_repeatable", params: { sectionId, reason } }, tabId, async (t) => {
      const result = await this.bridge
        .call("form.removeRepeatable", { sectionId, tabId: t.tab.tabId, timing: t.timing }, 30_000)
        .catch(olderExtension("form.removeRepeatable", "remove rows"));
      await this.logEvent(t, {
        event: "remove-row",
        sectionId,
        ...(result.removed ? { removed: result.removed } : {}),
        ...(reason ? { reason } : {}),
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
      return annotate(result, t);
    });
  }

  async addRepeatable(addButtonId: string, tabId?: number) {
    return this.onTab({ tool: "add_repeatable", params: { addButtonId } }, tabId, async (t) => {
      const result = await t.bridge.call(
        "form.addRepeatable",
        { addButtonId, tabId: t.tab.tabId, timing: t.timing },
        20_000,
      );
      return annotate(result, t);
    });
  }

  async next(tabId?: number) {
    return this.onTab({ tool: "go_next", params: {} }, tabId, async (t) => {
      const r = await t.bridge.call("form.next", { tabId: t.tab.tabId, timing: t.timing }, 60_000);
      await this.logEvent(t, {
        event: "next",
        advanced: r.advanced,
        pageKind: r.pageKind,
        step: r.step?.title,
        ...(r.step?.index ? { stepIndex: r.step.index } : {}),
      });
      if (r.pageKind !== "review") return annotate(r, t);
      await this.setStatus(t, "filled");
      const missing = await this.notAttached(t, "review");
      return annotate(missing ? { ...r, notAttached: missing } : r, t);
    });
  }

  async back(tabId?: number) {
    return this.onTab({ tool: "go_back", params: {} }, tabId, async (t) => {
      const r = await this.bridge
        .call("form.back", { tabId: t.tab.tabId, timing: t.timing }, 60_000)
        .catch(olderExtension("form.back", "go back"));
      await this.logEvent(t, { event: "back", moved: r.moved, pageKind: r.pageKind, step: r.step?.title });
      return annotate(r, t);
    });
  }

  async pageAction(action: PageAction, tabId?: number) {
    return this.onTab({ tool: "page_action", params: { action } }, tabId, async (t) => {
      const r = await t.bridge.call("form.pageAction", { action, tabId: t.tab.tabId, timing: t.timing }, 30_000);
      return annotate(r, t);
    });
  }

  async screenshot(tabId?: number) {
    return this.onTab({ tool: "screenshot", params: {} }, tabId, (t) =>
      t.bridge.call("tab.screenshot", { tabId: t.tab.tabId, timing: t.timing }, 15_000),
    );
  }

  /**
   * Choose the tab, then run `fn` on it after any earlier form call on the same tab has finished. Claude Code
   * makes tool calls in parallel, and two calls acting on one page at once interfere: two dropdown reads
   * each open a listbox, and both can read whichever is on screen; a fill can land while `go_next` changes
   * the step. The page is one shared thing, so calls on a tab run one at a time, in the order they came;
   * different tabs still run side by side. The waits come from autofill-timing.yaml, read for every call so an
   * edit applies to the next one.
   */
  private async onTab<T>(
    call: { tool: string; params: Record<string, unknown> },
    tabId: number | undefined,
    fn: (t: Target) => Promise<T>,
  ): Promise<T> {
    const entered = Date.now();
    const settings = await this.debug.settings();
    const base = await this.target(tabId);
    return this.pages.run(String(base.tab.tabId), async () => {
      const record = settings.on ? this.debug.start(call.tool, call.params, Date.now() - entered) : null;
      const { timing, fillTimeoutMs, issues } = await loadTiming(this.ws);
      if (issues.length) this.log.warn({ issues }, "autofill-timing.yaml has problems; defaults used for those");
      // Last thing before the adapter call, inside the tab's queue, so nothing can hide the tab in between.
      const shown = await this.show(base.tab.tabId);
      const t: Target = {
        ...base,
        timing,
        fillTimeoutMs,
        timingIssues: issues,
        ...(shown ? { shown } : {}),
        bridge: record ? recorded(this.bridge, record) : this.bridge,
        note: record
          ? (key, value) => {
              record.notes[key] = [...(record.notes[key] ?? []), value];
            }
          : () => {},
        debug: record !== null,
      };
      if (!record) return fn(t);
      Object.assign(record, {
        tab: base.tab,
        ...(base.posting ? { posting: base.posting.id } : {}),
        ...(base.mismatch ? { postingMismatch: base.mismatch } : {}),
        ...(base.extensionVersion ? { extensionVersion: base.extensionVersion } : {}),
        ...(typeof this.bridge.browser === "function" ? { browser: this.bridge.browser() } : {}),
        timing,
        fillTimeoutMs,
        ...(shown ? { shown } : {}),
      });
      try {
        const result = await fn(t);
        this.debug.finish(record, settings, { result });
        return result;
      } catch (err) {
        // A call that timed out still gets its dump: the bridge calls made before it failed, and the error.
        this.debug.finish(record, settings, { error: err });
        throw err;
      }
    });
  }

  /** Resolves once every debug record is written (tests). */
  debugIdle(): Promise<void> {
    return this.debug.idle();
  }

  /**
   * Bring the application tab to the front of its window. Browsers throttle a hidden tab's timers to about once
   * a second, and every adapter wait (and much of Workday's own rendering) is a timer: in the Monarch run, 16
   * fields took 6.7 s, then the review page opened in front of the form and 4 dates took 28 s. A slow fill runs
   * past its timeout and keeps going in the page unlogged, which looks like a broken adapter.
   *
   * Not while a review page waits for the user: switching would take it away from them mid-approval. Never
   * fails the call: an extension built before `tab.show` answers "Unknown method" (logged once), and any other
   * problem leaves the tab as it was.
   */
  private async show(tabId: number): Promise<Shown | undefined> {
    const reviewPending = this.reviews.pending();
    try {
      const r = await this.bridge.call("tab.show", { tabId, activate: !reviewPending }, 5_000);
      if (r.activated) this.log.info({ tabId }, "application tab brought to the front");
      if (r.hidden) this.log.warn({ tabId, reviewPending }, "application tab is hidden; the browser throttles it");
      return { activated: r.activated, hidden: r.hidden, reviewPending };
    } catch (err) {
      const e = EzError.from(err);
      if (!e.message.includes("Unknown method tab.show")) {
        this.log.warn({ err: e.message }, "tab.show failed; the call goes ahead");
      } else if (!this.warnedNoTabShow) {
        this.warnedNoTabShow = true;
        this.log.warn("the extension predates tab.show: application tabs aren't brought to the front");
      }
      return undefined;
    }
  }

  /**
   * Choose the tab: the one asked for; else an application tab (Workday or Oracle) on the active posting's
   * tenant (the one the user is looking at, else the most recently used); else any application tab, the same
   * way. Then decide whether the active posting may be credited with what happens there.
   */
  private async target(tabId?: number): Promise<TargetBase> {
    const { tabs, extensionVersion } = await this.bridge.call("browser.status", {}, 5_000);
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
      const forms = tabs.filter((t) => isFormSite(t.site));
      tab = pickTab(postingTenant ? forms.filter((t) => siteTenant(t.url) === postingTenant) : []) ?? pickTab(forms);
      if (!tab) {
        throw new EzError(
          ErrorCode.NotFound,
          "No Workday or Oracle application tab is open.",
          "Ask the user to open the application (click Apply on the posting) in the browser.",
        );
      }
    }

    const formTenant = siteTenant(tab.url);
    if (active && postingTenant && formTenant && postingTenant !== formTenant) {
      const label = [active.company, active.role].filter(Boolean).join(": ") || active.id;
      return {
        tab,
        posting: null,
        ...(extensionVersion ? { extensionVersion } : {}),
        mismatch: {
          activePosting: {
            id: active.id,
            ...(active.company ? { company: active.company } : {}),
            ...(active.role ? { role: active.role } : {}),
            tenant: postingTenant,
          },
          formTenant,
          hint:
            `This tab is on "${formTenant}", but the active posting (${label}) is on ` +
            `"${postingTenant}", so nothing was logged and no status changed. If the user is applying to ` +
            "another job, activate its posting (postings_list with a company filter, then posting_activate) " +
            "or have them capture it with Set posting; otherwise switch to the right tab.",
        },
      };
    }
    return { tab, posting: active, ...(extensionVersion ? { extensionVersion } : {}) };
  }

  /**
   * Append to the posting's form-log.jsonl: the audit trail for "what did we submit". `tabActivated` and
   * `tabHidden` (only when true) let a slow step be matched to a hidden tab afterwards.
   */
  private async logEvent(t: Target, event: Record<string, unknown>): Promise<void> {
    if (!t.posting) return;
    const tab = {
      ...(t.shown?.activated ? { tabActivated: true } : {}),
      ...(t.shown?.hidden ? { tabHidden: true } : {}),
    };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event, ...tab });
    await appendFile(join(this.postings.folder(t.posting.id), "form-log.jsonl"), `${line}\n`, "utf8");
  }

  /**
   * The documents the user approved for this posting (in their current version) that no successful upload on
   * this application has attached, with what to do about them; undefined when there are none. Said after an
   * upload and on reaching the review page.
   *
   * Why: Workday usually has one file field, "Resume/CV", that takes several files. In two live runs the agent
   * uploaded the approved resume there, never the approved cover letter, and handed over at the review page;
   * both times the user had to point it out. `multiple: true` on the field wasn't enough of a cue.
   *
   * Only approvals count (the after-approval attach mode), since they say which documents the user means to
   * send. A posting that wants one bundled PDF is left to the skill: its parts are approved but not uploaded.
   */
  private async notAttached(
    t: Target,
    when: "upload" | "review",
  ): Promise<{ files: string[]; hint: string } | undefined> {
    if (!t.posting || t.posting.bundleRequired) return undefined;
    const { approved } = await this.reviews.summary(t.posting.id);
    const wanted = approved.filter((a) => a.current).map((a) => a.file);
    if (wanted.length === 0) return undefined;
    const folder = this.postings.folder(t.posting.id);
    const log = await readFile(join(folder, "form-log.jsonl"), "utf8").catch(() => "");
    const uploaded = new Set<string>();
    for (const line of log.split(/\r?\n/)) {
      let e: { event?: string; ok?: boolean; file?: string };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.event === "upload" && e.ok && e.file) uploaded.add(relative(folder, e.file).split(sep).join("/"));
    }
    const files = wanted.filter((f) => !uploaded.has(f));
    if (files.length === 0) return undefined;
    const hint =
      when === "upload"
        ? "Approved for this posting and not attached yet. A file field with multiple: true (Workday's Resume/CV) " +
          "takes several files: upload them to it too, unless the form has a field of their own."
        : "Approved for this posting and never attached to this application. Before the hand-off, go_back to the " +
          "step with the file field and upload them (a field with multiple: true takes several files), or tell " +
          "the user why they aren't attached.";
    return { files, hint };
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

/** The tenant a posting belongs to: read from its URL when it's a Workday or Oracle page, else as stored. */
function postingTenantOf(meta: PostingMeta): string | undefined {
  return siteTenant(meta.url) ?? meta.tenant;
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

interface AutofilledField {
  fieldId: string;
  label: string;
  value: FillValue;
  rule: string;
  /** What the field held before (left from a previous application). */
  was?: Field["currentValue"];
}

interface AutofillFailure {
  fieldId: string;
  label: string;
  value: FillValue;
  rule: string;
  error?: string;
  availableOptions?: string[];
  /** The page took a near match instead (it holds this now): set the right option. */
  inexact?: string;
}

function filledEntry(f: PlannedFill): AutofilledField {
  return {
    fieldId: f.fieldId,
    label: f.label,
    value: f.value,
    rule: f.rule,
    ...(f.was !== undefined ? { was: f.was } : {}),
  };
}

function failure(f: PlannedFill, r: FillResult, selected: string | undefined): AutofillFailure {
  return {
    fieldId: f.fieldId,
    label: f.label,
    value: f.value,
    rule: f.rule,
    ...(r.error ? { error: r.error } : {}),
    ...(r.availableOptions ? { availableOptions: r.availableOptions } : {}),
    ...(r.ok && selected !== undefined ? { inexact: selected } : {}),
  };
}

/**
 * autofill_step's sections: only the fields left to decide, each with why, and not the ones that failed (those
 * are in `failed`). `left: null` means nothing was planned, so every field is left. Rows marked removable stay
 * even when empty, so remove_repeatable can still find them.
 */
function leftSections(
  sections: ReturnType<typeof leanForm>["sections"],
  failed: AutofillFailure[],
  left: Map<string, LeftReason> | null,
) {
  const failedIds = new Set(failed.map((f) => f.fieldId));
  return sections
    .map((s) => ({
      ...s,
      fields: s.fields
        .filter((f) => !failedIds.has(f.id) && (left === null || left.has(f.id)))
        .map((f) => (left?.get(f.id) ? { ...f, reason: left.get(f.id) } : f)),
    }))
    .filter((s) => s.fields.length > 0 || s.removable);
}

/** The bridge for one debugged call: every request is added to its record with its full result and time. */
function recorded(bridge: Pick<ExtensionBridge, "call">, record: CallRecord): Pick<ExtensionBridge, "call"> {
  const call = async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
    const started = Date.now();
    const entry: CallRecord["bridge"][number] = { method, params: stripBulk(params), ms: 0 };
    record.bridge.push(entry);
    try {
      const result = await (bridge.call as (m: string, p: unknown, t?: number) => Promise<unknown>)(
        method,
        params,
        timeoutMs,
      );
      entry.result = result;
      return result;
    } catch (err) {
      entry.error = EzError.from(err).message;
      throw err;
    } finally {
      entry.ms = Date.now() - started;
    }
  };
  return { call: call as ExtensionBridge["call"] };
}

/** A result with what the agent must know about the tab: another posting's tenant, or a page left hidden. */
function annotate<T extends object>(
  result: T,
  t: Target,
): T & { postingMismatch?: PostingMismatch; tabHidden?: TabHidden } {
  return { ...result, ...(t.mismatch ? { postingMismatch: t.mismatch } : {}), ...tabHiddenOf(t) };
}

function tabHiddenOf(t: Target): { tabHidden?: TabHidden } {
  if (!t.shown?.hidden) return {};
  const hint =
    "The application tab is in the background, where the browser slows it down (its timers run about once a " +
    "second), so filling is slow and can time out. Tell the user once and keep filling: ask them to keep the tab " +
    "visible (window not minimized, the review page closed or moved to another window)." +
    (t.shown.reviewPending
      ? " A review page is waiting for them, so ezapply doesn't switch tabs until they answer."
      : "");
  return { tabHidden: { hint } };
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
