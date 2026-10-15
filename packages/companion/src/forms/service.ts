import { appendFile, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import {
  ErrorCode,
  EzError,
  type Field,
  type FillResult,
  type FillValue,
  type FormSchema,
  type OptionInfo,
  type PageAction,
  type PostingApplication,
  type PostingMeta,
  type PostingStatus,
  type TabInfo,
  type Timing,
} from "@ezapply/protocol";
import { isFormSite, SITES, siteInfo } from "@ezapply/sites";
import { SITE_NOTES } from "@ezapply/sites/notes";
import type { ExtensionBridge } from "../bridge/server.js";
import type { ReviewService } from "../documents/review.js";
import type { Logger } from "../logger.js";
import type { PostingsService } from "../postings/service.js";
import type { ProfileService } from "../profile/service.js";
import { KeyedQueue } from "../util/keyed-queue.js";
import type { Workspace } from "../workspace/workspace.js";
import { type Handoff, handoff, type LogEvent, stepWarnings } from "./checklist.js";
import { type CallRecord, DebugRecorder, debugRequest, type MarkupSetting, stripBulk, type Trace } from "./debug.js";
import {
  type Binding,
  matchPosting,
  type PostingFacts,
  type PostingMatch,
  postingFacts,
  type TabFacts,
  tabSite,
} from "./match.js";
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

/** The application tab isn't the active posting's (see forms/match.ts): nothing changes, nothing is logged. */
export interface PostingMismatch {
  activePosting: { id: string; company?: string; role?: string; tenant?: string; job?: string };
  formTenant?: string;
  /** The job the tab is for, when its URL names one (a Workday requisition, an Oracle job id). */
  formJob?: string;
  /** The job title the page shows, when that decided it. */
  formTitle?: string;
  /** The posting an earlier call bound this tab to, when that decided it. */
  boundTo?: string;
  /** What decided it: `site`, `job`, `binding`, `page-reqid`, `tenant` or `title`. */
  by: string;
  hint: string;
}

/** Said once, when a call that changes the page binds a tab nothing tied to the active posting. */
export interface PostingBound {
  id: string;
  company?: string;
  role?: string;
  formTitle?: string;
  hint: string;
}

/** The tab chosen for a call, before it runs: the active posting and what's known of its job. */
/**
 * Where an application form is: a tab whose page is a form site's, or a form site's frame inside a tab (an
 * employer's careers page embedding Greenhouse), given as the tab with the frame's `url` and `site` and its
 * `frameId`. Everything that tells which posting a tab belongs to works on that URL, so an embedded form is matched
 * by its own site, tenant and job, never by the careers page around it.
 */
export type FormTab = Omit<TabInfo, "frames"> & {
  frameId?: number;
  /** For an embedded form: the URL of the page around it. */
  hostUrl?: string;
};

/** The places in a tab where an application form may be: its own page when on a form site, then each form frame. */
export function formTabs(tab: TabInfo): FormTab[] {
  const { frames = [], ...own } = tab;
  const inside = frames.map((f) => ({ ...own, url: f.url, site: f.site, frameId: f.frameId, hostUrl: tab.url }));
  return [...(isFormSite(tab.site) ? [own] : []), ...inside];
}

interface TargetBase {
  tab: FormTab;
  active: PostingMeta | null;
  application?: PostingApplication;
  facts?: PostingFacts;
  extensionVersion?: string;
}

/** The tab a form call acts on and the posting it's credited to. */
interface Target {
  tab: FormTab;
  /** The active posting, when this tab may belong to it (`match` isn't `other`). */
  posting: PostingMeta | null;
  mismatch?: PostingMismatch;
  /** How the tab was matched to the active posting; absent with no active posting. */
  match?: PostingMatch;
  /** The active posting's application, as stored or found. */
  application?: PostingApplication;
  /** Set by `claim` when it bound an unconfirmed tab: said once in the result. */
  bound?: PostingBound;
  /** The match differs from the last one reported for this tab: results say it (`postingMatch`). */
  matchChanged: boolean;
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
  /** Debug mode is on for this call. */
  debug: boolean;
}

/** What `tab.show` found: focus emulation on (`emulated`), or the page as the browser left it. See `FormsService.show`. */
interface Shown {
  emulated: boolean;
  /** The call changes the page (not a read): only those say when the page has no focus (`browserBehind`). */
  changesPage: boolean;
  hidden: boolean;
  /** The page had focus. Absent when it couldn't be read. */
  focused?: boolean;
}

/** Said in a result when the application page is still hidden after `tab.show`. */
export interface TabHidden {
  hint: string;
}

/** Said in a result when the page is on screen without focus: the browser window is behind another app. */
export interface BrowserBehind {
  hint: string;
}

/** Form tools that only read the page: a page without focus doesn't matter to them. */
const READS_PAGE = new Set(["get_form", "list_options", "search_options", "screenshot"]);

/**
 * The form tools' logic: which tab to act on, which posting an action belongs to, the form-log.jsonl audit
 * trail, automatic status moves, reading files for upload, and trimming get_form for Claude's context.
 *
 * Every action is credited to the active posting only when the application tab may be that posting's (its job,
 * the tab's binding, its tenant or its title say so, or nothing says otherwise: forms/match.ts), and the first
 * call that changes a page binds the tab to it. Otherwise, with two applications open or an old confirmation page
 * on screen, a fill or a `submitted` status would land on the wrong posting.
 *
 * Calls on one tab run one at a time (`onTab`).
 */
export class FormsService {
  /** One queue per tab id: the page can only do one thing at a time. */
  private readonly pages = new KeyedQueue();
  private readonly debug: DebugRecorder;
  private warnedNoTabShow = false;
  /**
   * Tabs bound to a posting by a call that changed their page, or by the user (`posting_activate { tabId }`). In
   * memory: a restart loses them, and the posting's stored `application` covers its tenant and job from then on.
   */
  private readonly bindings = new Map<number, Binding>();
  /** The last match reported per tab, so `postingMatch` is said again only when it changes. */
  private readonly reported = new Map<number, string>();
  /** The sites whose notes each chat session has been given (`siteNotes`); "" for requests naming no session. */
  private readonly notesGiven = new Map<string, Set<string>>();

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

  async getForm(opts: { tabId?: number; onlyEmpty?: boolean; section?: string; session?: string } = {}) {
    return this.onTab({ tool: "get_form", params: opts }, opts.tabId, async (t) =>
      this.view(t, await t.bridge.call("form.get", { tabId: t.tab.tabId, timing: t.timing }, 20_000), opts),
    );
  }

  /**
   * get_form's result for a page read: the lean schema with what the agent must know about the call. Seeing the
   * review page sets status `filled` (and reports approved documents never attached); a confirmation page sets
   * `submitted`.
   */
  private async view(t: Target, form: FormSchema, opts: { onlyEmpty?: boolean; section?: string; session?: string }) {
    if (form.pageKind === "confirmation") {
      await this.setStatus(t, "submitted");
      await this.logEvent(t, { event: "confirmation-seen", url: form.url });
    }
    if (form.pageKind === "review") await this.setStatus(t, "filled");
    const missing = form.pageKind === "review" ? await this.notAttached(t, "review") : undefined;
    const checks = await this.checks(t, form);
    const siteNotes = this.siteNotes(opts.session, form.adapter);
    return {
      ...(siteNotes ? { siteNotes } : {}),
      ...leanForm(form, opts),
      ...(missing ? { notAttached: missing } : {}),
      ...checks,
      ...(t.posting ? { posting: t.posting.id } : {}),
      ...postingMatchOf(t),
      ...(t.mismatch ? { postingMismatch: t.mismatch } : {}),
      ...(t.bound ? { postingBound: t.bound } : {}),
      ...tabHiddenOf(t),
      ...browserBehindOf(t),
      ...(t.timingIssues.length ? { timingIssues: t.timingIssues } : {}),
      // So debug mode isn't left on unnoticed: it records the user's data on every call.
      ...(t.debug ? { debug: true } : {}),
    };
  }

  /**
   * A site's notes (`@ezapply/sites/notes`), the first time a page of that site is read in this chat session; afterwards
   * nothing. The tool descriptions and the apply skill never name a site: this is how the agent learns what one does
   * differently, and only for the sites it fills.
   */
  private siteNotes(session: string | undefined, site: string): string | undefined {
    const notes = SITE_NOTES[site as keyof typeof SITE_NOTES];
    if (!notes) return undefined;
    const given = this.notesGiven.get(session ?? "") ?? new Set<string>();
    this.notesGiven.set(session ?? "", given);
    if (given.has(site)) return undefined;
    given.add(site);
    return notes;
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
  ): Promise<{ results: FillResult[]; postingBound?: PostingBound; tabHidden?: TabHidden }> {
    return this.onTab({ tool: "fill_fields", params: { fills } }, tabId, async (t) => {
      await this.claim(t);
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
      return annotate(
        { results: results.map((r) => leanFillResult(r, fills.find((f) => f.fieldId === r.fieldId)?.value)) },
        t,
      );
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
      await this.claim(t);
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
      await this.claim(t);
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

  /** Remove a row, then read the step again: later rows' field ids have changed. */
  async removeRepeatable(sectionId: string, reason: string | undefined, tabId?: number, session?: string) {
    return this.onTab({ tool: "remove_repeatable", params: { sectionId, reason } }, tabId, async (t) => {
      await this.claim(t);
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
      if (!result.ok) return annotate(result, t);
      return { ...result, form: await this.reread(t, { session }) };
    });
  }

  /**
   * Press add buttons in order (the same id again for another row), then read the step once: its empty fields
   * are the new rows to fill. One call instead of a turn per row plus a get_form, each re-sending the whole
   * conversation. Stops at the first button that fails, with the page as it is then.
   */
  async addRepeatable(addButtonIds: string[], tabId?: number, session?: string) {
    return this.onTab({ tool: "add_repeatable", params: { addButtonIds } }, tabId, async (t) => {
      await this.claim(t);
      let pressed = 0;
      let error: { addButtonId: string; error: string } | undefined;
      for (const addButtonId of addButtonIds) {
        const r = await t.bridge.call(
          "form.addRepeatable",
          { addButtonId, tabId: t.tab.tabId, timing: t.timing },
          20_000,
        );
        if (!r.ok) {
          error = { addButtonId, error: r.error ?? "The button did nothing." };
          break;
        }
        pressed++;
      }
      return {
        ok: !error,
        pressed,
        ...(error ? { failed: error } : {}),
        form: await this.reread(t, { session, onlyEmpty: true }),
      };
    });
  }

  /** The step after a change, as get_form would give it (called inside the tab's queue). */
  private async reread(t: Target, opts: { session?: string; onlyEmpty?: boolean }) {
    return this.view(t, await t.bridge.call("form.get", { tabId: t.tab.tabId, timing: t.timing }, 20_000), opts);
  }

  /**
   * Press Next. When the step advanced, the result carries the new page as get_form gives it (`form`): every
   * advance was followed by a get_form, a turn that re-sent the whole conversation for nothing else.
   */
  async next(tabId?: number, session?: string) {
    return this.onTab({ tool: "go_next", params: {} }, tabId, async (t) => {
      await this.claim(t);
      // The step as it's left, for the hand-off: what still looked off then (one read, only when it's logged).
      let leaving: string[] = [];
      if (t.posting) {
        const before = await t.bridge.call("form.get", { tabId: t.tab.tabId, timing: t.timing }, 20_000);
        if (before.pageKind === "step") {
          leaving = (await this.checks(t, before)).checklist ?? [];
          await this.logEvent(t, {
            event: "step-check",
            step: before.step?.title,
            ...(before.step?.index ? { stepIndex: before.step.index } : {}),
            warnings: leaving,
          });
        }
      }
      const r = await t.bridge.call("form.next", { tabId: t.tab.tabId, timing: t.timing }, 60_000);
      await this.logEvent(t, {
        event: "next",
        advanced: r.advanced,
        pageKind: r.pageKind,
        step: r.step?.title,
        ...(r.step?.index ? { stepIndex: r.step.index } : {}),
      });
      const left = leaving.length ? { checklist: leaving } : {};
      if (!r.advanced) return annotate({ ...r, ...left }, t);
      // The new page's pageKind, step, errors and (on the review page) notAttached are in `form`.
      const { pageKind: _k, step: _s, errors: _e, ...rest } = r;
      return { ...rest, ...left, form: await this.reread(t, { session }) };
    });
  }

  async back(tabId?: number) {
    return this.onTab({ tool: "go_back", params: {} }, tabId, async (t) => {
      await this.claim(t);
      const r = await this.bridge
        .call("form.back", { tabId: t.tab.tabId, timing: t.timing }, 60_000)
        .catch(olderExtension("form.back", "go back"));
      await this.logEvent(t, { event: "back", moved: r.moved, pageKind: r.pageKind, step: r.step?.title });
      return annotate(r, t);
    });
  }

  async pageAction(action: PageAction, tabId?: number) {
    return this.onTab({ tool: "page_action", params: { action } }, tabId, async (t) => {
      await this.claim(t);
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
      const { timing, fillTimeoutMs, issues } = await loadTiming(this.ws, base.tab.site);
      if (issues.length) this.log.warn({ issues }, "autofill-timing.yaml has problems; defaults used for those");
      // Last thing before the adapter call, inside the tab's queue, so nothing can hide the tab in between.
      const shown = await this.show(base.tab, !READS_PAGE.has(call.tool));
      const bridge = framed(record ? recorded(this.bridge, record, settings.markup) : this.bridge, base.tab.frameId);
      const decided = await this.decide(base, bridge, timing);
      const t: Target = {
        tab: base.tab,
        ...decided,
        timing,
        fillTimeoutMs,
        timingIssues: issues,
        ...(shown ? { shown } : {}),
        bridge,
        debug: record !== null,
      };
      if (!record) return fn(t);
      Object.assign(record, {
        tab: base.tab,
        ...(t.posting ? { posting: t.posting.id } : {}),
        ...(t.match ? { postingMatch: t.match } : {}),
        ...(t.application ? { application: t.application } : {}),
        ...(t.mismatch ? { postingMismatch: t.mismatch } : {}),
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
   * Make the application tab run at full speed: the extension turns on focus emulation, and the page runs visible
   * and focused where it is (in the background, minimized, behind the terminal), with nothing switched or raised.
   * Browsers throttle a hidden tab's timers to about once a second, and every adapter wait (and much of Workday's
   * own rendering) is a timer: in one live run, 16 fields took 6.7 s, then the review page opened in front of the
   * form and 4 dates took 28 s. A slow fill runs past its timeout and keeps going in the page unlogged, which looks
   * like a broken adapter. And a page whose window is behind another app gets no focus events, which Workday's
   * split dates seemed to need.
   *
   * Never fails the call: an extension built before it (or before this form of it) fails `tab.show`, which is
   * logged once, and the call goes ahead with the page as the browser left it.
   */
  private async show(tab: FormTab, changesPage: boolean): Promise<Shown | undefined> {
    const { tabId, frameId } = tab;
    try {
      const r = await this.bridge.call("tab.show", { tabId, ...(frameId !== undefined ? { frameId } : {}) }, 5_000);
      if (!r.emulated) this.log.warn({ tabId }, "no focus emulation on the application tab");
      if (r.hidden) this.log.warn({ tabId }, "application tab is hidden; the browser throttles it");
      return {
        emulated: r.emulated,
        changesPage,
        hidden: r.hidden,
        ...(r.focused !== undefined ? { focused: r.focused } : {}),
      };
    } catch (err) {
      const e = EzError.from(err);
      if (!this.warnedNoTabShow) {
        this.warnedNoTabShow = true;
        this.log.warn({ err: e.message }, "tab.show failed: no focus emulation on application tabs; calls go ahead");
      }
      return undefined;
    }
  }

  /**
   * Choose the tab: the one asked for; else the application tab that best matches the active posting (its job or
   * its binding, then its tenant, then one nothing ties to another posting); else any application tab. Among
   * equals, the one the user is looking at, else the most recently used.
   *
   * An application embedded in another site's page counts as a tab of its own (`formTabs`), with the frame's URL.
   * In the tab asked for, the form is chosen the same way: its own page when it's a form site's, else the frame
   * that best matches the active posting, else the first. Resolved again on every call, never cached: a frame that
   * reloads gets a new id.
   */
  private async target(tabId?: number): Promise<TargetBase> {
    const { tabs, extensionVersion } = await this.bridge.call("browser.status", {}, 5_000);
    const activeId = await this.postings.activeId();
    const active = activeId ? await this.postings.get(activeId).catch(() => null) : null;
    const application = active ? await this.postings.application(active.id).catch(() => undefined) : undefined;
    const facts = active ? postingFacts(active, application) : undefined;

    const score = (t: FormTab) => {
      if (!facts) return 0;
      const m = matchPosting(facts, { url: t.url, site: t.site }, this.bindings.get(t.tabId));
      if (m.verdict === "other") return -1;
      if (m.verdict === "unconfirmed") return 0;
      return m.by[0] === "job" || m.by[0] === "binding" ? 2 : 1;
    };
    const bestOf = (forms: FormTab[]) => {
      const best = Math.max(...forms.map(score));
      return best < 0 ? forms : forms.filter((t) => score(t) === best);
    };
    let tab: FormTab | undefined;
    if (tabId !== undefined) {
      const asked = tabs.find((t) => t.tabId === tabId);
      if (!asked) {
        throw new EzError(ErrorCode.NotFound, `Tab ${tabId} no longer exists.`, "Call browser_status for open tabs.");
      }
      // Its own page when that's an application, else the embedded form that best matches. A tab with no form
      // anywhere is still acted on, and the extension says it isn't an application.
      const forms = formTabs(asked);
      const { frames: _, ...own } = asked;
      tab = (isFormSite(asked.site) ? forms[0] : bestOf(forms)[0]) ?? own;
    } else {
      tab = pickTab(bestOf(tabs.flatMap(formTabs)));
      if (!tab) {
        throw new EzError(
          ErrorCode.NotFound,
          `No application tab is open on a supported site (${SITES.map((s) => s.name).join(", ")}).`,
          "Ask the user to open the application (click Apply on the posting) in the browser.",
        );
      }
    }
    return {
      tab,
      active,
      ...(application ? { application } : {}),
      ...(facts ? { facts } : {}),
      ...(extensionVersion ? { extensionVersion } : {}),
    };
  }

  /**
   * Whether the active posting may be credited with what happens on the tab (forms/match.ts). Where nothing in the
   * URLs settles it and the posting has a role, the page is read for the job title it shows. Inside the tab's
   * queue, so that read never lands in the middle of another call.
   */
  private async decide(
    base: TargetBase,
    bridge: Pick<ExtensionBridge, "call">,
    timing: Timing,
  ): Promise<Pick<Target, "posting" | "mismatch" | "match" | "application" | "matchChanged">> {
    const { tab, active, facts } = base;
    const application = base.application ? { application: base.application } : {};
    if (!active || !facts || !isFormSite(tab.site)) return { posting: active, ...application, matchChanged: false };
    const binding = this.bindings.get(tab.tabId);
    let page: TabFacts = { url: tab.url, site: tab.site };
    let match = matchPosting(facts, page, binding);
    if (match.verdict === "unconfirmed" && facts.role) {
      const read = await bridge.call("form.get", { tabId: tab.tabId, timing }, 20_000).catch(() => null);
      if (read?.job) {
        page = { ...page, ...read.job };
        match = matchPosting(facts, page, binding);
      }
    }
    const key = `${active.id}|${match.verdict}|${match.by.join("+")}`;
    const matchChanged = this.reported.get(tab.tabId) !== key;
    this.reported.set(tab.tabId, key);
    if (match.verdict !== "other") return { posting: active, match, ...application, matchChanged };
    return {
      posting: null,
      match,
      ...application,
      matchChanged,
      mismatch: mismatchOf(active, facts, tab, page, match, binding),
    };
  }

  /**
   * Before a call that changes the page: refuse it on another posting's tab, and bind the tab to the active posting
   * when it isn't yet. A tab nothing tied to the posting (`unconfirmed`) is said in the result once
   * (`postingBound`), so the agent tells the user which posting the application is being filled for; and the
   * posting keeps the tab's site, tenant and job as its application when it had none.
   *
   * Why: a change used to be refused only when the posting had a tenant to compare, and most postings are captured
   * off the form sites, without one. Two applications open at once could each take the other's fills, log and
   * `submitted` status.
   */
  private async claim(t: Target): Promise<void> {
    if (t.mismatch) {
      throw new EzError(
        ErrorCode.PostingMismatch,
        "This tab belongs to another posting than the active one.",
        t.mismatch.hint,
      );
    }
    if (!t.posting || !t.match) return;
    const tabId = t.tab.tabId;
    if (this.bindings.get(tabId)?.postingId === t.posting.id) return;
    const here = tabSite(t.tab.url, t.tab.site);
    this.bindings.set(tabId, { postingId: t.posting.id, ...(here.tenant ? { tenant: here.tenant } : {}) });
    if (!t.application && here.site) {
      const application: PostingApplication = {
        url: t.tab.url,
        site: here.site,
        ...(here.tenant ? { tenant: here.tenant } : {}),
        ...(here.job ? { job: here.job } : {}),
        from: "bound",
        at: new Date().toISOString(),
      };
      await this.postings.setApplication(t.posting.id, application, { keep: true });
      t.application = application;
    }
    this.log.info({ tabId, posting: t.posting.id, by: t.match.by }, "application tab bound to the posting");
    if (t.match.verdict !== "unconfirmed") return;
    const formTitle = await this.pageTitle(t);
    t.bound = {
      id: t.posting.id,
      ...(t.posting.company ? { company: t.posting.company } : {}),
      ...(t.posting.role ? { role: t.posting.role } : {}),
      ...(formTitle ? { formTitle } : {}),
      hint:
        "Nothing tied this application tab to the active posting (no employer or job to compare), so it's now " +
        "bound to it: tell the user once which posting this application is being filled for. If that's wrong, " +
        "stop: the right posting is activated with posting_activate { id, tabId }.",
    };
  }

  /** The job title the page shows, for `postingBound` (best effort). */
  private async pageTitle(t: Target): Promise<string | undefined> {
    const read = await t.bridge.call("form.get", { tabId: t.tab.tabId, timing: t.timing }, 20_000).catch(() => null);
    return read?.job?.title;
  }

  /**
   * `posting_activate { id, tabId }`: the user says this tab is that posting's application. Binds it, replacing
   * any binding, and keeps the tab's site, tenant and job as the posting's application (`from: "user"`).
   */
  async bindTab(postingId: string, tabId: number): Promise<{ tabId: number; url: string }> {
    const { tabs } = await this.bridge.call("browser.status", {}, 5_000);
    const asked = tabs.find((t) => t.tabId === tabId);
    if (!asked) {
      throw new EzError(ErrorCode.NotFound, `Tab ${tabId} no longer exists.`, "Call browser_status for open tabs.");
    }
    // Its own page when that's an application, else the application embedded in it.
    const tab = formTabs(asked)[0] ?? asked;
    const here = tabSite(tab.url, tab.site);
    if (!here.site) {
      throw new EzError(
        ErrorCode.BadRequest,
        `Tab ${tabId} isn't an application on a supported site.`,
        "Pass the tabId of the application tab (browser_status lists them, with their site).",
      );
    }
    this.bindings.set(tabId, { postingId, ...(here.tenant ? { tenant: here.tenant } : {}), byUser: true });
    await this.postings.setApplication(postingId, {
      url: tab.url,
      site: here.site,
      ...(here.tenant ? { tenant: here.tenant } : {}),
      ...(here.job ? { job: here.job } : {}),
      from: "user",
      at: new Date().toISOString(),
    });
    this.reported.delete(tabId);
    this.log.info({ tabId, posting: postingId }, "application tab bound to the posting by the user");
    return { tabId, url: tab.url };
  }

  /**
   * Append to the posting's form-log.jsonl: the audit trail for "what did we submit". `focusNotEmulated`,
   * `tabHidden` and `windowInBackground` (only when true) let a slow step, or a field that wasn't taken, be
   * matched afterwards to a hidden tab or a page without focus.
   */
  private async logEvent(t: Target, event: Record<string, unknown>): Promise<void> {
    if (!t.posting) return;
    const tab = {
      ...(t.shown && !t.shown.emulated ? { focusNotEmulated: true } : {}),
      ...(t.shown?.hidden ? { tabHidden: true } : {}),
      ...(t.shown && !t.shown.hidden && t.shown.focused === false ? { windowInBackground: true } : {}),
      // Why this posting was credited (forms/match.ts): `job`, `binding`, `tenant`, `title`… or `unconfirmed`.
      ...(t.match ? { matchedBy: t.match.by[0] ?? "unconfirmed" } : {}),
    };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event, ...tab });
    await appendFile(join(this.postings.folder(t.posting.id), "form-log.jsonl"), `${line}\n`, "utf8");
  }

  /**
   * The checklist for a page (see `forms/checklist.ts`): on a step, `checklist` warnings (rows that don't match
   * the profile, files this application didn't upload); on the review page, or an Oracle page whose only way on
   * is Submit, also `handoff`, the summary of this application from its log. Only for a posting this tab is
   * credited to, and never failing the call.
   */
  private async checks(t: Target, form: FormSchema): Promise<{ checklist?: string[]; handoff?: Handoff }> {
    if (!t.posting) return {};
    try {
      const events = await this.logEvents(t);
      const uploaded = new Set(
        events.filter((e) => e.event === "upload" && e.ok && e.file).map((e) => basename(e.file as string)),
      );
      const profile = await this.profile.profile();
      const warnings = stepWarnings(form, profile.exists && profile.valid ? profile.value : null, uploaded);
      const end = form.pageKind === "review" || form.lastPage === true;
      return {
        ...(form.pageKind === "step" && warnings.length ? { checklist: warnings } : {}),
        ...(end ? { handoff: handoff(events) } : {}),
      };
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "checklist skipped");
      return {};
    }
  }

  /** This posting's form-log.jsonl, parsed (lines that aren't JSON skipped). */
  private async logEvents(t: Target): Promise<LogEvent[]> {
    if (!t.posting) return [];
    const text = await readFile(join(this.postings.folder(t.posting.id), "form-log.jsonl"), "utf8").catch(() => "");
    const out: LogEvent[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LogEvent);
      } catch {
        // a line cut off mid-write
      }
    }
    return out;
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
        ? "Approved for this posting and not attached yet. A file field with multiple: true " +
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

/** What the agent reads when a tab is another posting's: what decided it, and what to do. */
function mismatchOf(
  active: PostingMeta,
  facts: PostingFacts,
  tab: TabInfo,
  page: TabFacts,
  match: PostingMatch,
  binding: Binding | undefined,
): PostingMismatch {
  const here = tabSite(tab.url, tab.site);
  const by = match.by[0] ?? "tenant";
  const label = [active.company, active.role].filter(Boolean).join(": ") || active.id;
  const siteName = (id?: string) => (id ? (siteInfo(id)?.name ?? id) : "another site");
  const why: Record<string, string> = {
    site: `This tab is a ${siteName(here.site)} application, but the active posting's (${label}) is on ${siteName(facts.site)}`,
    job: `This tab is the application for job ${here.job}, but the active posting (${label}) is job ${facts.job}`,
    binding: `This tab was bound to another posting (${binding?.postingId}) by an earlier call, not to the active one (${label})`,
    "page-reqid": `The page shows requisition ${page.reqId}, but the active posting (${label}) is job ${facts.job}`,
    tenant: `This tab is on "${here.tenant}", but the active posting (${label}) is on "${facts.tenant}"`,
    title: `The page is the application for "${page.title}", but the active posting (${label}) is "${facts.role}"`,
  };
  return {
    activePosting: {
      id: active.id,
      ...(active.company ? { company: active.company } : {}),
      ...(active.role ? { role: active.role } : {}),
      ...(facts.tenant ? { tenant: facts.tenant } : {}),
      ...(facts.job ? { job: facts.job } : {}),
    },
    ...(here.tenant ? { formTenant: here.tenant } : {}),
    ...(here.job ? { formJob: here.job } : {}),
    ...(by === "title" && page.title ? { formTitle: page.title } : {}),
    ...(by === "binding" && binding ? { boundTo: binding.postingId } : {}),
    by,
    hint:
      `${why[by]}, so nothing that changes the page runs and nothing is logged. If the user is applying to ` +
      "that job, activate its posting (postings_list with a company filter, then posting_activate) or have " +
      "them capture it with the side panel's Capture button; otherwise switch to the right tab. If the user says this tab is the " +
      `active posting's application after all, posting_activate { id: "${active.id}", tabId: ${tab.tabId} } ties them.`,
  };
}

/** `postingMatch` for a result: how the tab was matched, said when it changed since the tab's last call. */
function postingMatchOf(t: Target): { postingMatch?: { by: string[]; from?: string } } {
  if (!t.match || !t.matchChanged || t.match.verdict === "other") return {};
  return {
    postingMatch: {
      by: t.match.by.length ? t.match.by : ["unconfirmed"],
      ...(t.application ? { from: t.application.from } : {}),
    },
  };
}

function pickTab<T extends FormTab>(tabs: T[]): T | undefined {
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

/**
 * The bridge for one call on an embedded form: every request names its frame (`frameId`), so the adapter is injected
 * into that frame alone. `tab.show` gets it from `show`, and `browser.status` takes none.
 */
function framed(bridge: Pick<ExtensionBridge, "call">, frameId: number | undefined): Pick<ExtensionBridge, "call"> {
  if (frameId === undefined) return bridge;
  const call = (method: string, params: Record<string, unknown>, timeoutMs?: number, onDebug?: OnDebug) =>
    (bridge.call as BridgeCall)(
      method,
      method.startsWith("form.") ? { ...params, frameId } : params,
      timeoutMs,
      onDebug,
    );
  return { call: call as ExtensionBridge["call"] };
}

type OnDebug = (debug: unknown) => void;
type BridgeCall = (method: string, params: unknown, timeoutMs?: number, onDebug?: OnDebug) => Promise<unknown>;

/**
 * The bridge for one debugged call: every request is added to its record with its full result and time. Each adapter
 * call (`form.*`) asks for the adapter's trace (`debug`, with the markup `debug.markup` says), which comes back
 * beside the result and goes only into the record. An extension built before the trace answers without one, which
 * the record notes once.
 */
function recorded(
  bridge: Pick<ExtensionBridge, "call">,
  record: CallRecord,
  markup: MarkupSetting,
): Pick<ExtensionBridge, "call"> {
  let first = true;
  const call = async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
    const started = Date.now();
    const entry: CallRecord["bridge"][number] = { method, params: stripBulk(params), ms: 0 };
    record.bridge.push(entry);
    const adapter = method.startsWith("form.");
    const sent = adapter ? { ...params, debug: debugRequest(markup, first) } : params;
    if (adapter) first = false;
    try {
      const result = await (bridge.call as BridgeCall)(method, sent, timeoutMs, (trace) => {
        entry.trace = trace as Trace;
      });
      entry.result = result;
      if (adapter && !entry.trace && !record.notes.noTrace) {
        record.notes.noTrace = [
          "The extension sent no adapter trace: it was built before it. Reload it after updating.",
        ];
      }
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

/**
 * A result with what the agent must know about the tab: another posting's, bound just now to the active one, how
 * it was matched (when that changed), or a page left hidden.
 */
function annotate<T extends object>(
  result: T,
  t: Target,
): T & {
  postingMismatch?: PostingMismatch;
  postingBound?: PostingBound;
  tabHidden?: TabHidden;
  browserBehind?: BrowserBehind;
} {
  return {
    ...result,
    ...postingMatchOf(t),
    ...(t.mismatch ? { postingMismatch: t.mismatch } : {}),
    ...(t.bound ? { postingBound: t.bound } : {}),
    ...tabHiddenOf(t),
    ...browserBehindOf(t),
  };
}

function tabHiddenOf(t: Target): { tabHidden?: TabHidden } {
  if (!t.shown?.hidden) return {};
  const hint =
    "The application tab is hidden and focus emulation couldn't run on it, so the browser slows it down (its " +
    "timers run about once a second): filling is slow and can time out. Tell the user once and keep filling: " +
    "ask them to keep the tab visible (window not minimized, the tab in front), or to close DevTools or other " +
    "debugging on that tab, which can keep ezapply's debugger out.";
  return { tabHidden: { hint } };
}

/**
 * The page is on screen but without focus on a call that changes the page (focus emulation couldn't run, and the
 * browser window is behind another app), where widgets that track focus (Workday's split dates) may not take a
 * value. Not when the tab is hidden (`tabHidden` says that).
 */
function browserBehindOf(t: Target): { browserBehind?: BrowserBehind } {
  const s = t.shown;
  if (!s?.changesPage || s.hidden || s.focused !== false) return {};
  const hint =
    "The browser window is behind another app and focus emulation couldn't run on the tab, so the page gets no " +
    "focus events and some fields (dates on some sites) may not be taken. If a field isn't taken, ask the user to " +
    "bring the browser to the front, then fill it again.";
  return { browserBehind: { hint } };
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
 * Option lists longer than this go out as `optionCount` only. A native select can carry hundreds (a
 * certificate dropdown with 400 issuers, the same language list on every language row): on a live run they were
 * most of a 42k-character get_form, re-sent with every later turn. fill_fields matches the closest option and
 * returns the options when nothing matches, and list_options and search_options read them when needed.
 */
export const MAX_INLINE_OPTIONS = 25;

/**
 * get_form is the largest result and is read at every step, so leave out what carries no information:
 * `required: false`, `multiple: false`, empty option lists, `optionsLazy` (always true for dropdowns and
 * typeaheads) and the raw automation id (the field id already contains it). Long option lists become a count
 * (MAX_INLINE_OPTIONS). `onlyEmpty` keeps fields that are empty or show an error; `section` keeps sections whose
 * id or title contains it.
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
    ...(options && options.length > MAX_INLINE_OPTIONS
      ? { optionCount: options.length }
      : options && options.length > 0
        ? { options }
        : {}),
  };
}

function isEmpty(f: Field): boolean {
  const v = f.currentValue;
  return v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}
