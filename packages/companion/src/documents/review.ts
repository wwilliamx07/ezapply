import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, relative, sep } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";
import { type AttachMode, WorkspaceConfig } from "../config/workspace.js";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import { escapeHtml, htmlPage, readForm } from "../util/html.js";
import type { Workspace } from "../workspace/workspace.js";

/** A review waits this long for the user. */
const REVIEW_TTL_MS = 2 * 60 * 60_000;
const MAX_REVIEW_FILES = 6;

/** postings/<id>/approvals.json: which version of each document the user approved. */
const ApprovalsFile = z.object({
  schemaVersion: z.literal(1),
  approvals: z.record(z.string(), z.object({ sha256: z.string(), approvedAt: z.string(), reviewId: z.string() })),
});
type ApprovalsFile = z.infer<typeof ApprovalsFile>;

export interface ReviewResult {
  /** Documents approved as shown (paths relative to the posting folder). */
  approved: string[];
  /** Documents the user wants changed, with what they wrote. */
  changes: { file: string; request: string }[];
}

interface ReviewFile {
  /** Relative to the posting folder, with forward slashes. */
  name: string;
  sha256: string;
  /** The exact bytes shown, so what's approved is what was seen even if the file is rebuilt meanwhile. */
  bytes: Buffer;
}

interface Session {
  id: string;
  token: string;
  postingId: string;
  files: ReviewFile[];
  expires: number;
  result?: ReviewResult;
  supersededBy?: string;
  waiters: Set<() => void>;
}

/**
 * Document review in the browser. In the after-approval attach mode Claude shows the generated PDFs on a
 * page served by the companion; the user approves each one or writes what should change. Approvals are recorded
 * per exact version (SHA-256), and upload_file attaches a document from postings/ only when its current
 * bytes match an approval, so an edited or rebuilt document needs approving again.
 *
 * Approval is a click on that page and nothing else: a chat message saying "approved" can't approve, so
 * neither can a prompt injection.
 */
export class ReviewService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
    /** http://127.0.0.1:<port>: known only after the server listens. */
    private readonly localBaseUrl: () => string,
  ) {}

  async attachMode(): Promise<AttachMode> {
    return (await this.ws.readConfig()).documents.attach;
  }

  /** Record the attach mode in ezapply.config.json, keeping every other value as written. */
  async setAttachMode(mode: AttachMode): Promise<AttachMode> {
    const path = this.ws.path("ezapply.config.json");
    const raw = ((await readJson(path)) as Record<string, unknown> | null) ?? { schemaVersion: 1 };
    const documents = { ...((raw.documents as Record<string, unknown> | undefined) ?? {}), attach: mode };
    const next = { ...raw, documents };
    WorkspaceConfig.parse(next);
    await writeJsonAtomic(path, next);
    return mode;
  }

  /** Start a review of PDFs from one posting folder; a newer review for that posting replaces an open one. */
  async open(inputs: string[]): Promise<{ reviewId: string; url: string; postingId: string; files: string[] }> {
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
    const id = randomBytes(9).toString("base64url");
    const session: Session = {
      id,
      token: randomBytes(24).toString("base64url"),
      postingId: postingId as string,
      files,
      expires: Date.now() + REVIEW_TTL_MS,
      waiters: new Set(),
    };
    for (const old of this.sessions.values()) {
      if (old.postingId === session.postingId && !old.result && !old.supersededBy) {
        old.supersededBy = id;
        for (const w of old.waiters) w();
      }
    }
    this.prune();
    this.sessions.set(id, session);
    this.log.info({ id, posting: session.postingId, files: files.length }, "review opened");
    return { reviewId: id, url: this.url(session), postingId: session.postingId, files: files.map((f) => f.name) };
  }

  /** The user's answer, waiting up to `timeoutMs` for it. */
  async wait(
    reviewId: string,
    timeoutMs: number,
  ): Promise<({ done: true } & ReviewResult) | { done: false; url?: string; supersededBy?: string; hint: string }> {
    const s = this.sessions.get(reviewId);
    if (!s || s.expires < Date.now()) {
      throw new EzError(
        ErrorCode.NotFound,
        "This review is unknown or expired.",
        "Present the documents again with review_open.",
      );
    }
    if (!s.result && !s.supersededBy) {
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
    if (s.result) return { done: true, ...s.result };
    if (s.supersededBy) {
      return { done: false, supersededBy: s.supersededBy, hint: "A newer review of this posting replaced this one." };
    }
    return {
      done: false,
      url: this.url(s),
      hint: "The user hasn't answered yet. Ask whether they saw the page (give the URL again if not), then wait again.",
    };
  }

  /** True while a review waits for the user. */
  pending(): boolean {
    const now = Date.now();
    for (const s of this.sessions.values()) if (!s.result && !s.supersededBy && s.expires > now) return true;
    return false;
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

  /** For posting_active: the attach mode, approvals (and whether each still matches), an open review. */
  async summary(postingId: string) {
    const file = await this.approvals(postingId);
    const approved = [];
    for (const [name, a] of Object.entries(file.approvals)) {
      const bytes = await readFile(this.ws.path("postings", postingId, name)).catch(() => null);
      approved.push({ file: name, approvedAt: a.approvedAt, current: bytes !== null && sha256(bytes) === a.sha256 });
    }
    const open = [...this.sessions.values()].find(
      (s) => s.postingId === postingId && !s.result && !s.supersededBy && s.expires > Date.now(),
    );
    return {
      attachMode: await this.attachMode(),
      approved,
      ...(open ? { openReview: { reviewId: open.id, url: this.url(open) } } : {}),
    };
  }

  // ---- the page ----------------------------------------------------------------------------------

  /** Handles /review/<id> (GET page, POST answer) and /review/<id>/file/<n> (the PDF). */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const m = url.pathname.match(/^\/review\/([\w-]+)(?:\/file\/(\d+))?$/);
    const s = m ? this.sessions.get(m[1] as string) : undefined;
    const post = req.method === "POST" && m?.[2] === undefined;
    const form = post ? await readForm(req) : null;
    const token = post ? form?.get("t") : url.searchParams.get("t");
    if (!m || !s || !tokenOk(token, s.token) || (req.method !== "GET" && !post)) {
      htmlPage(
        res,
        404,
        "Review not found",
        "<p>This link is wrong or has expired. Ask Claude to show the documents again.</p>",
      );
      return;
    }
    if (s.expires < Date.now()) {
      htmlPage(res, 410, "Review expired", "<p>Ask Claude to show the documents again.</p>");
      return;
    }
    if (m[2] !== undefined) {
      const f = s.files[Number(m[2])];
      if (!f) {
        htmlPage(res, 404, "Not found", "");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${f.name.split("/").pop()?.replace(/["\\]/g, "") ?? "document.pdf"}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      });
      res.end(f.bytes);
      return;
    }
    if (s.result) {
      htmlPage(res, 200, "Already answered", `${resultHtml(s.result)}<p>You can close this tab.</p>`);
      return;
    }
    if (s.supersededBy) {
      htmlPage(
        res,
        410,
        "A newer version is waiting",
        "<p>Claude opened a newer review of these documents in another tab. Use that one.</p>",
      );
      return;
    }
    if (post && form) {
      const result = await this.answer(s, form);
      htmlPage(res, 200, "Thanks", `${resultHtml(result)}<p>You can close this tab and return to Claude Code.</p>`);
      return;
    }
    this.page(res, s);
  }

  private page(res: ServerResponse, s: Session): void {
    const t = escapeHtml(s.token);
    const docs = s.files
      .map(
        (f, i) => `<fieldset><legend><b>${escapeHtml(f.name)}</b></legend>
        <iframe src="/review/${s.id}/file/${i}?t=${t}" title="${escapeHtml(f.name)}"></iframe>
        <label>What should change? Leave empty to approve ${escapeHtml(f.name)} as shown.
        <textarea name="c${i}" rows="3"></textarea></label></fieldset>`,
      )
      .join("\n");
    htmlPage(
      res,
      200,
      "Review before attaching",
      `<p>These are the documents Claude prepared for this application. Documents you approve are attached as
      shown; for the others, write what should change and Claude will revise them and show you the new version.</p>
      <form method="post" action="/review/${s.id}">
        <input type="hidden" name="t" value="${t}">
        ${docs}
        <button type="submit">Approve empty ones and send changes</button>
      </form>`,
      { csp: "frame-src 'self'; form-action 'self'", wide: true },
    );
  }

  private async answer(s: Session, form: URLSearchParams): Promise<ReviewResult> {
    const result: ReviewResult = { approved: [], changes: [] };
    s.files.forEach((f, i) => {
      const request = (form.get(`c${i}`) ?? "").trim().slice(0, 4000);
      if (request) result.changes.push({ file: f.name, request });
      else result.approved.push(f.name);
    });
    if (result.approved.length > 0) {
      const file = await this.approvals(s.postingId);
      const now = new Date().toISOString();
      for (const f of s.files.filter((x) => result.approved.includes(x.name))) {
        file.approvals[f.name] = { sha256: f.sha256, approvedAt: now, reviewId: s.id };
      }
      await writeJsonAtomic(this.ws.path("postings", s.postingId, "approvals.json"), file);
    }
    s.result = result;
    for (const w of s.waiters) w();
    this.log.info({ id: s.id, approved: result.approved.length, changes: result.changes.length }, "review answered");
    return result;
  }

  // ---- internals ---------------------------------------------------------------------------------

  private url(s: Session): string {
    return `${this.localBaseUrl()}/review/${s.id}?t=${s.token}`;
  }

  private async approvals(postingId: string): Promise<ApprovalsFile> {
    const raw = await readJson(this.ws.path("postings", postingId, "approvals.json")).catch(() => null);
    const parsed = ApprovalsFile.safeParse(raw);
    return parsed.success ? parsed.data : { schemaVersion: 1, approvals: {} };
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
    for (const [id, s] of this.sessions) if (s.expires < now) this.sessions.delete(id);
  }
}

function resultHtml(r: ReviewResult): string {
  const list = (items: string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  return [
    r.approved.length ? `<p>Approved (attached as shown):</p><ul>${list(r.approved)}</ul>` : "",
    r.changes.length
      ? `<p>Changes requested (Claude will show you the revised version):</p><ul>${list(r.changes.map((c) => c.file))}</ul>`
      : "",
  ].join("");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tokenOk(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
