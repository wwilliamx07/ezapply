import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, relative, sep } from "node:path";
import {
  ErrorCode,
  EzError,
  type PreviousReview,
  type ReviewAnswer,
  type ReviewComment,
  type ReviewPageFile,
  type ReviewPageState,
  type ReviewStatus,
} from "@ezapply/protocol";
import { z } from "zod";
import type { AttachMode } from "../config/workspace.js";
import type { Logger } from "../logger.js";
import type { UiAssets } from "../ui/assets.js";
import {
  EventStreams,
  pageCookie,
  presentedToken,
  readJsonBody,
  sameOrigin,
  sendJson,
  tokenOk,
} from "../ui/session.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import { escapeHtml, htmlPage } from "../util/html.js";
import type { Workspace } from "../workspace/workspace.js";
import { pageLimitOf, UNDERFILLED_LINES } from "./page-limit.js";
import { freeLines } from "./pdf/lint.js";
import { pdfInfoOf, pdfLines, pdfText } from "./pdf/toolkit.js";

/** A review waits this long for the user. */
const REVIEW_TTL_MS = 2 * 60 * 60_000;
const MAX_REVIEW_FILES = 6;
const MAX_REQUEST_CHARS = 4000;
const MAX_COMMENTS = 50;

/** postings/<id>/approvals.json: which version of each document the user approved. */
const ApprovalsFile = z.object({
  schemaVersion: z.literal(1),
  approvals: z.record(z.string(), z.object({ sha256: z.string(), approvedAt: z.string(), reviewId: z.string() })),
});
type ApprovalsFile = z.infer<typeof ApprovalsFile>;

/**
 * postings/<id>/reviewed.json: the version of each document the user last answered a review of, with its text,
 * so the next review shows what changed since.
 */
const ReviewedFile = z.object({
  schemaVersion: z.literal(1),
  documents: z.record(
    z.string(),
    z.object({
      sha256: z.string(),
      at: z.string(),
      reviewId: z.string(),
      approved: z.boolean(),
      pages: z.array(z.string()).optional(),
    }),
  ),
});
type ReviewedFile = z.infer<typeof ReviewedFile>;

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const AnswerBody = z.object({
  documents: z
    .array(
      z.object({
        index: z.number().int().min(0),
        request: z.string().max(MAX_REQUEST_CHARS).optional(),
        comments: z
          .array(
            z.object({
              page: z.number().int().min(1),
              quote: z.string().max(2000),
              note: z.string().max(MAX_REQUEST_CHARS),
              rects: z.array(Rect).max(200).optional(),
            }),
          )
          .max(MAX_COMMENTS)
          .optional(),
      }),
    )
    .max(MAX_REVIEW_FILES),
});

/** A document and why it gets an exception (review_documents' `short` and `again`). */
export interface DocumentReason {
  file: string;
  reason: string;
}

/** How a review ended, as the agent gets it. */
type ReviewEnd =
  | ({ done: true } & ReviewAnswer)
  | { done: false; supersededBy: string; hint: string }
  | { done: false; expired: true; hint: string };

interface ReviewFile {
  /** Relative to the posting folder, with forward slashes. */
  name: string;
  sha256: string;
  /** The exact bytes shown, so what's approved is what was seen even if the file is rebuilt meanwhile. */
  bytes: Buffer;
  info?: ReviewPageFile["info"];
  /** Its text per page, kept with the answer so the next review can show what changed. */
  text?: string[];
  previous?: PreviousReview;
}

interface Session {
  id: string;
  token: string;
  postingId: string;
  posting: ReviewPageState["posting"];
  agentName: string;
  files: ReviewFile[];
  pageLimit: number;
  expires: number;
  /** What the user sent: the agent's result, and the comments' places for the answered page. */
  answer?: ReviewAnswer;
  supersededBy?: string;
  waiters: Set<() => void>;
  events: EventStreams;
}

/**
 * Document review in the browser. In the after-approval attach mode Claude shows the generated PDFs on a page
 * served by the companion (the UI package's review page); the user approves each one, or writes what should
 * change and comments on passages. Approvals are recorded per exact version (SHA-256), and upload_file attaches a
 * document from postings/ only when its current bytes match an approval, so an edited or rebuilt document needs
 * approving again.
 *
 * Approval is a click on that page and nothing else: a chat message saying "approved" can't approve, so
 * neither can a prompt injection.
 */
export class ReviewService {
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
    /** http://127.0.0.1:<port>: known only after the server listens. */
    private readonly localBaseUrl: () => string,
    private readonly ui: UiAssets,
  ) {}

  async attachMode(): Promise<AttachMode> {
    return (await this.ws.readConfig()).documents.attach;
  }

  /** Record the attach mode in ezapply.config.json, keeping every other value as written. */
  async setAttachMode(mode: AttachMode): Promise<AttachMode> {
    await this.ws.updateConfig("documents", { attach: mode });
    return mode;
  }

  /**
   * Start a review of PDFs from one posting folder; a newer review for that posting replaces an open one. A document
   * already approved as it is, or a resume or cover letter left underfilled, is refused unless `again` or `short`
   * names it with a reason (`checkApproved`, `checkFilled`).
   */
  async open(
    inputs: string[],
    { short = [], again = [] }: { short?: DocumentReason[]; again?: DocumentReason[] } = {},
    /** Who opened it, as the page names it. */
    agentName = "Claude Code",
  ): Promise<{ reviewId: string; url: string; postingId: string; files: string[] }> {
    if (inputs.length === 0 || inputs.length > MAX_REVIEW_FILES) {
      throw new EzError(ErrorCode.BadRequest, `Review 1 to ${MAX_REVIEW_FILES} documents at a time.`);
    }
    const files: ReviewFile[] = [];
    let postingId: string | undefined;
    for (const input of inputs) {
      const abs = this.ws.resolveAllowed(input, ["postings"]);
      const where = this.locate(abs);
      if (!where || extname(abs).toLowerCase() !== ".pdf") {
        throw new EzError(
          ErrorCode.BadRequest,
          `Only PDFs in a posting folder can be reviewed: ${input}`,
          "Compile the document first and pass postings/<id>/<name>.pdf.",
        );
      }
      if (postingId && where.postingId !== postingId) {
        throw new EzError(ErrorCode.BadRequest, "Review documents of one posting at a time.");
      }
      postingId = where.postingId;
      const bytes = await readFile(abs).catch(() => {
        throw new EzError(ErrorCode.NotFound, `File not found: ${abs}`);
      });
      files.push({ name: where.name, sha256: sha256(bytes), bytes });
    }
    const pid = postingId as string;
    await this.checkApproved(pid, files, again);
    const reviewed = await this.reviewed(pid);
    await Promise.all(files.map((f) => this.read(f, reviewed)));
    await this.checkFilled(pid, files, short);
    const id = randomBytes(9).toString("base64url");
    const session: Session = {
      id,
      token: randomBytes(24).toString("base64url"),
      postingId: pid,
      posting: await this.posting(pid),
      agentName,
      files,
      pageLimit: (await this.ws.readConfig()).resume.pageLimit,
      expires: Date.now() + REVIEW_TTL_MS,
      waiters: new Set(),
      events: new EventStreams(),
    };
    for (const old of this.sessions.values()) {
      if (old.postingId === session.postingId && !old.answer && !old.supersededBy) {
        old.supersededBy = id;
        this.changed(old);
      }
    }
    this.prune();
    this.sessions.set(id, session);
    this.notify();
    // A page left open past the review's life hears that it expired.
    setTimeout(() => this.changed(session), REVIEW_TTL_MS + 1000).unref();
    this.log.info({ id, posting: session.postingId, files: files.length }, "review opened");
    return { reviewId: id, url: this.url(session), postingId: session.postingId, files: files.map((f) => f.name) };
  }

  /** The user's answer, waiting up to `timeoutMs` for it. */
  async wait(reviewId: string, timeoutMs: number): Promise<ReviewEnd | { done: false; url: string; hint: string }> {
    const s = this.sessions.get(reviewId);
    if (!s || s.expires < Date.now()) {
      throw new EzError(
        ErrorCode.NotFound,
        "This review is unknown or expired.",
        "Present the documents again with review_documents { files }.",
      );
    }
    if (!s.answer && !s.supersededBy) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          s.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        s.waiters.add(done);
      });
    }
    return (
      this.ended(s) ?? {
        done: false,
        url: this.url(s),
        hint: "The user hasn't answered yet. Ask whether they saw the page (give the URL again if not), then wait again with review_documents { reviewId }.",
      }
    );
  }

  /**
   * How the review ended, whenever it does: answered, replaced by a newer one, or expired (a panel conversation's
   * review, delivered as a message).
   */
  settled(reviewId: string): Promise<ReviewEnd> {
    const s = this.sessions.get(reviewId);
    if (!s) return Promise.reject(new EzError(ErrorCode.NotFound, "This review is unknown or expired."));
    return new Promise((resolve) => {
      const check = () => {
        const end = this.ended(s);
        if (!end) return;
        s.waiters.delete(check);
        resolve(end);
      };
      s.waiters.add(check);
      check();
    });
  }

  /** Whether a review still waits on the user. */
  isOpen(reviewId: string): boolean {
    const s = this.sessions.get(reviewId);
    return s !== undefined && this.status(s) === "open";
  }

  private ended(s: Session): ReviewEnd | null {
    if (s.answer) return { done: true, ...forAgent(s.answer) };
    if (s.supersededBy) {
      return { done: false, supersededBy: s.supersededBy, hint: "A newer review of this posting replaced this one." };
    }
    if (s.expires < Date.now()) {
      return {
        done: false,
        expired: true,
        hint: "The review expired unanswered. Present the documents again with review_documents { files } if they still need approving.",
      };
    }
    return null;
  }

  /** Called when a review opens, is answered, replaced or expires (the side panel shows it). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The posting's review waiting on the user, if one is. */
  openFor(postingId: string): { reviewId: string; files: string[] } | undefined {
    const s = this.openSession(postingId);
    return s ? { reviewId: s.id, files: s.files.map((f) => f.name) } : undefined;
  }

  /** An open review's address (with its token), to show its tab again. */
  urlOf(reviewId: string): string | undefined {
    const s = this.sessions.get(reviewId);
    return s && !s.answer && !s.supersededBy && s.expires > Date.now() ? this.url(s) : undefined;
  }

  /**
   * Where each of a posting's documents stands, by its current bytes: in an open review, approved, changes asked
   * (the last review of these bytes wasn't an approval), else a draft.
   */
  async documentStates(
    postingId: string,
    files: string[],
  ): Promise<Record<string, "draft" | "review" | "approved" | "changes">> {
    const [approvals, reviewed] = await Promise.all([this.approvals(postingId), this.reviewed(postingId)]);
    const inReview = new Set(this.openSession(postingId)?.files.map((f) => f.name) ?? []);
    const out: Record<string, "draft" | "review" | "approved" | "changes"> = {};
    for (const name of files) {
      const bytes = await readFile(this.ws.path("postings", postingId, name)).catch(() => null);
      const hash = bytes ? sha256(bytes) : null;
      if (inReview.has(name)) out[name] = "review";
      else if (hash && approvals.approvals[name]?.sha256 === hash) out[name] = "approved";
      else if (hash && reviewed.documents[name]?.sha256 === hash && !reviewed.documents[name]?.approved)
        out[name] = "changes";
      else out[name] = "draft";
    }
    return out;
  }

  private openSession(postingId: string): Session | undefined {
    return [...this.sessions.values()].find(
      (s) => s.postingId === postingId && !s.answer && !s.supersededBy && s.expires > Date.now(),
    );
  }

  /** Whether the file's current bytes are a version the user approved. Only files in posting folders count. */
  async isApproved(abs: string): Promise<boolean> {
    const where = this.locate(abs);
    if (!where) return false;
    const approval = (await this.approvals(where.postingId)).approvals[where.name];
    if (!approval) return false;
    const bytes = await readFile(abs).catch(() => null);
    return bytes !== null && sha256(bytes) === approval.sha256;
  }

  /** Whether upload_file must see an approval for this file: after-approval mode and a generated document. */
  async needsApproval(abs: string): Promise<boolean> {
    return (await this.attachMode()) === "after-approval" && this.locate(abs) !== null;
  }

  /** For posting_get: the attach mode, approvals (and whether each still matches), an open review. */
  async summary(postingId: string) {
    const file = await this.approvals(postingId);
    const approved = [];
    for (const [name, a] of Object.entries(file.approvals)) {
      const bytes = await readFile(this.ws.path("postings", postingId, name)).catch(() => null);
      approved.push({ file: name, approvedAt: a.approvedAt, current: bytes !== null && sha256(bytes) === a.sha256 });
    }
    const open = [...this.sessions.values()].find(
      (s) => s.postingId === postingId && !s.answer && !s.supersededBy && s.expires > Date.now(),
    );
    return {
      attachMode: await this.attachMode(),
      approved,
      ...(open ? { openReview: { reviewId: open.id, url: this.url(open) } } : {}),
    };
  }

  /**
   * The text of a document as the user last reviewed it, for `pdf_text { sinceReviewed }`: by its name in its
   * posting folder. Null when it was never reviewed (or had no text then).
   */
  async lastReviewed(abs: string): Promise<{ at: string; reviewId: string; sha256: string; pages: string[] } | null> {
    const where = this.locate(abs);
    if (!where) return null;
    const entry = (await this.reviewed(where.postingId)).documents[where.name];
    return entry?.pages ? { at: entry.at, reviewId: entry.reviewId, sha256: entry.sha256, pages: entry.pages } : null;
  }

  // ---- the page ----------------------------------------------------------------------------------

  /**
   * Everything under /review/<id>: the page (GET, where `?t=` is traded for the page's cookie), its state, the
   * PDFs, its events, and the answer (POST, from the companion's own origin only).
   */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const m = url.pathname.match(/^\/review\/([\w-]+)(?:\/(state|events|answer|file\/(\d+)))?$/);
    const s = m ? this.sessions.get(m[1] as string) : undefined;
    const part = m?.[2];
    const api = part !== undefined;
    if (!m || !s || !tokenOk(presentedToken(req, url), s.token)) {
      if (api) return sendJson(res, 404, { error: "not found" });
      return htmlPage(
        res,
        404,
        "Review not found",
        "<p>This link is wrong or has expired. Ask the agent to show the documents again.</p>",
      );
    }
    const base = `/review/${s.id}`;
    if (!part) {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      if (s.expires < Date.now()) {
        return htmlPage(
          res,
          410,
          "Review expired",
          `<p>Ask ${escapeHtml(s.agentName)} to show the documents again.</p>`,
        );
      }
      if (url.searchParams.has("t")) res.setHeader("Set-Cookie", pageCookie(s.token, base));
      return this.ui.page(res, "review", "ezapply: Review", base);
    }
    if (part === "answer") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: "forbidden origin" });
      const status = this.status(s);
      if (status !== "open") return sendJson(res, 409, { status });
      const body = AnswerBody.safeParse(await readJsonBody(req));
      if (!body.success) return sendJson(res, 400, { error: "bad answer" });
      await this.answer(s, body.data);
      // No page after answering: the review page closes its tab on this 204.
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
    if (part === "state") return sendJson(res, 200, this.state(s));
    if (part === "events") return s.events.add(req, res);
    const f = s.files[Number(m[3])];
    if (!f) return sendJson(res, 404, { error: "not found" });
    const filename =
      f.name
        .split("/")
        .pop()
        ?.replace(/["\\\r\n]/g, "") || "document.pdf";
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="${filename}"`,
      "Content-Length": f.bytes.byteLength,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    res.end(f.bytes);
  }

  private state(s: Session): ReviewPageState {
    return {
      id: s.id,
      status: this.status(s),
      posting: s.posting,
      agentName: s.agentName,
      expiresAt: new Date(s.expires).toISOString(),
      files: s.files.map((f, index) => ({
        index,
        name: f.name,
        bytes: f.bytes.byteLength,
        ...(f.info ? { info: f.info } : {}),
        ...(/resume|cv/i.test(f.name) ? { pageLimit: s.pageLimit } : {}),
        ...(f.previous ? { previous: f.previous } : {}),
      })),
      ...(s.answer ? { answer: s.answer } : {}),
    };
  }

  private status(s: Session): ReviewStatus {
    if (s.answer) return "answered";
    if (s.supersededBy) return "replaced";
    return s.expires < Date.now() ? "expired" : "open";
  }

  private async answer(s: Session, body: z.infer<typeof AnswerBody>): Promise<void> {
    const answer: ReviewAnswer = { approved: [], changes: [] };
    s.files.forEach((f, i) => {
      const doc = body.documents.find((d) => d.index === i);
      const request = doc?.request?.trim().slice(0, MAX_REQUEST_CHARS);
      const comments: ReviewComment[] = (doc?.comments ?? [])
        .map((c) => ({ ...c, quote: c.quote.trim(), note: c.note.trim() }))
        .filter((c) => c.note);
      if (request || comments.length) {
        answer.changes.push({
          file: f.name,
          ...(request ? { request } : {}),
          ...(comments.length ? { comments } : {}),
        });
      } else answer.approved.push(f.name);
    });
    const now = new Date().toISOString();
    if (answer.approved.length > 0) {
      const file = await this.approvals(s.postingId);
      for (const f of s.files.filter((x) => answer.approved.includes(x.name))) {
        file.approvals[f.name] = { sha256: f.sha256, approvedAt: now, reviewId: s.id };
      }
      await writeJsonAtomic(this.ws.path("postings", s.postingId, "approvals.json"), file);
    }
    const reviewed = await this.reviewed(s.postingId);
    for (const f of s.files) {
      reviewed.documents[f.name] = {
        sha256: f.sha256,
        at: now,
        reviewId: s.id,
        approved: answer.approved.includes(f.name),
        ...(f.text ? { pages: f.text } : {}),
      };
    }
    await writeJsonAtomic(this.ws.path("postings", s.postingId, "reviewed.json"), reviewed);
    s.answer = answer;
    this.changed(s);
    this.log.info({ id: s.id, approved: answer.approved.length, changes: answer.changes.length }, "review answered");
  }

  /** Wake the agent's wait and tell the open page to read its state again. */
  private changed(s: Session): void {
    for (const w of s.waiters) w();
    s.events.send("state");
    this.notify();
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  // ---- internals ---------------------------------------------------------------------------------

  /**
   * Refuse a document whose current bytes the user already approved, unless `again` names it with a reason. An agent
   * that read the approvals before the user answered opened a second review of the same bytes instead of uploading.
   * The reason (what the user asked to see or change) is the way past; it's logged, not shown on the page.
   */
  private async checkApproved(postingId: string, files: ReviewFile[], again: DocumentReason[]): Promise<void> {
    const excused = this.reasons(postingId, again, "again");
    const approvals = (await this.approvals(postingId)).approvals;
    const approved: string[] = [];
    for (const f of files) {
      if (approvals[f.name]?.sha256 !== f.sha256) continue;
      const reason = excused.get(f.name);
      if (reason) this.log.info({ posting: postingId, file: f.name, reason }, "review of an approved document");
      else approved.push(f.name);
    }
    if (approved.length === 0) return;
    throw new EzError(
      ErrorCode.BadRequest,
      `Already approved as it is: ${approved.join(", ")}. upload_file attaches it without another review.`,
      "Leave it out of the review. To show it again anyway, pass again: [{ file, reason }] with the reason: what " +
        "the user asked to see or change.",
    );
  }

  /** `short` or `again` by document name; each must name a file of this posting. */
  private reasons(postingId: string, list: DocumentReason[], param: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of list) {
      const where = this.locate(this.ws.resolveAllowed(r.file, ["postings"]));
      if (!where || where.postingId !== postingId) {
        throw new EzError(ErrorCode.BadRequest, `${param} names a file that isn't one being reviewed: ${r.file}`);
      }
      out.set(where.name, r.reason);
    }
    return out;
  }

  /**
   * Refuse a resume or cover letter at its page limit whose last page has `UNDERFILLED_LINES` or more free, unless
   * `short` names it with a reason. Agents stopped well short of the page despite the compile's `underfilled` lint
   * and sent the draft to review, where the user had to ask for more; a refusal is the step they can't skip. The
   * reason is the way past for a letter meant to be shorter (a length the posting, `format.md`, the user's
   * preferences or their words set, or evidence that ran out): it's logged, not shown on the page. A PDF without
   * readable text is let through, as the lint lets it build.
   */
  private async checkFilled(postingId: string, files: ReviewFile[], short: DocumentReason[]): Promise<void> {
    const excused = this.reasons(postingId, short, "short");
    const resumeLimit = (await this.ws.readConfig()).resume.pageLimit;
    const under: string[] = [];
    for (const f of files) {
      const limit = pageLimitOf(basename(f.name, extname(f.name)), resumeLimit);
      // Only a PDF `read` could parse with text: pdf.js can wait forever on bytes that aren't one.
      if (limit === undefined || !f.info?.hasTextLayer || f.info.pages !== limit) continue;
      const pages = await pdfLines(new Uint8Array(f.bytes)).catch(() => null);
      const last = pages?.[pages.length - 1];
      if (!pages || !last || pages.length !== limit) continue;
      const free = freeLines(last);
      if (free === undefined || free < UNDERFILLED_LINES) continue;
      const reason = excused.get(f.name);
      if (reason) {
        this.log.info({ posting: postingId, file: f.name, freeLines: free, reason }, "review of a short document");
        continue;
      }
      under.push(`${f.name} (about ${free} lines free)`);
    }
    if (under.length === 0) return;
    throw new EzError(
      ErrorCode.BadRequest,
      `Underfilled: ${under.join(", ")}. The page isn't full.`,
      "Add about that much of the strongest evidence, recompile and review again. If it is meant to be shorter, " +
        "pass short: [{ file, reason }] with the reason: a length the posting, format.md or the user's preferences " +
        "set, the user's own words, or the evidence that ran out (and what was left out).",
    );
  }

  /** What the page shows beside a document: its pages and text layer, and the version last reviewed. */
  private async read(f: ReviewFile, reviewed: ReviewedFile): Promise<void> {
    const info = await pdfInfoOf(new Uint8Array(f.bytes), f.name).catch(() => null);
    if (info) {
      const size = info.pageSizes[0];
      f.info = {
        pages: info.pages,
        ...(size ? { pageSize: size.size } : {}),
        hasTextLayer: info.hasTextLayer,
        encrypted: info.encrypted,
      };
      if (info.hasTextLayer) {
        const text = await pdfText(new Uint8Array(f.bytes)).catch(() => null);
        if (text) f.text = text.map((p) => p.text);
      }
    }
    const prev = reviewed.documents[f.name];
    if (prev) {
      f.previous = {
        at: prev.at,
        reviewId: prev.reviewId,
        same: prev.sha256 === f.sha256,
        approved: prev.approved,
        ...(prev.pages ? { pages: prev.pages } : {}),
      };
    }
  }

  private async posting(postingId: string): Promise<ReviewPageState["posting"]> {
    const meta = (await readJson(this.ws.path("postings", postingId, "meta.json")).catch(() => null)) as {
      company?: unknown;
      role?: unknown;
    } | null;
    return {
      id: postingId,
      ...(typeof meta?.company === "string" ? { company: meta.company } : {}),
      ...(typeof meta?.role === "string" ? { role: meta.role } : {}),
    };
  }

  private url(s: Session): string {
    return `${this.localBaseUrl()}/review/${s.id}?t=${s.token}`;
  }

  private async approvals(postingId: string): Promise<ApprovalsFile> {
    const raw = await readJson(this.ws.path("postings", postingId, "approvals.json")).catch(() => null);
    const parsed = ApprovalsFile.safeParse(raw);
    return parsed.success ? parsed.data : { schemaVersion: 1, approvals: {} };
  }

  private async reviewed(postingId: string): Promise<ReviewedFile> {
    const raw = await readJson(this.ws.path("postings", postingId, "reviewed.json")).catch(() => null);
    const parsed = ReviewedFile.safeParse(raw);
    return parsed.success ? parsed.data : { schemaVersion: 1, documents: {} };
  }

  /** postings/<id>/<name> → { postingId, name }, or null for anything else. */
  private locate(abs: string): { postingId: string; name: string } | null {
    const rel = relative(this.ws.path("postings"), abs);
    if (!rel || rel.startsWith("..")) return null;
    const [postingId, ...rest] = rel.split(sep);
    return postingId && rest.length > 0 ? { postingId, name: rest.join("/") } : null;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.expires < now) {
        s.events.close();
        this.sessions.delete(id);
      }
    }
  }
}

/** The answer as the agent gets it: comments without their places on the page. */
function forAgent(a: ReviewAnswer): ReviewAnswer {
  return {
    approved: a.approved,
    changes: a.changes.map((c) => ({
      ...c,
      ...(c.comments ? { comments: c.comments.map(({ page, quote, note }) => ({ page, quote, note })) } : {}),
    })),
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
