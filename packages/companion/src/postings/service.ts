import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CapturePayload,
  type CaptureResult,
  ErrorCode,
  EzError,
  type PostingApplication,
  PostingMeta,
  type PostingMetaPatch,
} from "@ezapply/protocol";
import { SITE_JOB_PARAMS, siteOfUrl } from "@ezapply/sites";
import type { Logger } from "../logger.js";
import { exists, readJson, writeFileAtomic, writeJsonAtomic } from "../util/fs.js";
import { KeyedQueue } from "../util/keyed-queue.js";
import type { Workspace } from "../workspace/workspace.js";
import { applicationFromUrl, checkReqId, findApplication } from "./application.js";
import { extractPosting } from "./extract.js";

export interface PostingFile {
  path: string;
  bytes: number;
  modifiedAt: string;
}

export interface PostingDetails extends PostingMeta {
  folder: string;
  postingMd: string;
  visibleText: string;
  rawHtml: string;
  files: PostingFile[];
}

/** Build output, snapshots and previews are noise when listing a posting folder. */
const HIDDEN_DIRS = new Set([".history", ".build", ".previews"]);

/**
 * Job query parameters that identify a posting; everything else is dropped from the canonical URL. The common names
 * any careers page or job board may use (`jk` and `currentjobid`: Indeed's and LinkedIn's), and each site's own
 * (`SiteInfo.jobParams`).
 */
const JOB_ID_PARAMS = new Set(["jobid", "job_id", "jid", "jk", "currentjobid", "id", "reqid", ...SITE_JOB_PARAMS]);

/** Posting ids are folder names ezapply made (`2026-09-24_acme_backend-engineer`): no separators, no `..`. */
const POSTING_ID = /^[\w.-]+$/;

export class PostingsService {
  private readonly queue = new KeyedQueue();
  private readonly listeners = new Set<() => void>();
  /** Postings whose capture was searched for an application this run and held none (not searched again). */
  private readonly searched = new Set<string>();

  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
  ) {}

  /** Store a capture from the extension. */
  capture(payload: CapturePayload): Promise<CaptureResult> {
    return this.serialize(() => this.doCapture(payload));
  }

  async list(): Promise<PostingMeta[]> {
    let entries: string[];
    try {
      entries = await readdir(this.ws.path("postings"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const metas: PostingMeta[] = [];
    for (const id of entries) {
      if (!isPostingId(id)) continue;
      const raw = await readJson(this.metaPath(id)).catch(() => null);
      const parsed = PostingMeta.safeParse(raw);
      if (parsed.success) metas.push(parsed.data);
      else if (raw !== null) this.log.warn({ id }, "skipping posting with invalid meta.json");
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<PostingMeta> {
    const raw = await readJson(this.metaPath(id));
    const parsed = PostingMeta.safeParse(raw);
    if (!parsed.success) {
      throw new EzError(ErrorCode.NotFound, `No posting with id ${id}`, "Call postings_list to see captured postings.");
    }
    return parsed.data;
  }

  /** A posting's metadata, folder and files. */
  async details(id: string): Promise<PostingDetails> {
    const meta = await this.get(id);
    const folder = this.folder(id);
    return {
      ...meta,
      folder,
      postingMd: join(folder, "posting.md"),
      visibleText: join(folder, "capture", "visible.txt"),
      rawHtml: join(folder, "capture", "raw.html"),
      files: await listFiles(folder),
    };
  }

  /**
   * The posting a chat session works on: a posting's panel conversation has its own (found by its session), so
   * conversations about different postings run side by side. Any other session (the general conversation, Claude
   * Code run by hand) has none, and names the posting it means. Null when there's none, or it was deleted.
   */
  async ownPosting(session?: string): Promise<string | null> {
    const id = session ? await this.postingOfSession(session) : undefined;
    if (!id) return null;
    return (await this.get(id).then(
      () => true,
      () => false,
    ))
      ? id
      : null;
  }

  /** How a chat session's posting is found: the agent's conversations know (wired in `main.ts`). */
  sessionPostings(fn: (session: string) => Promise<string | undefined>): void {
    this.postingOfSession = fn;
  }

  private postingOfSession: (session: string) => Promise<string | undefined> = async () => undefined;

  /**
   * The posting a call is about: the one it names (checked to exist), else its conversation's own. From a posting's
   * conversation, another posting is refused: that posting's work runs in its own conversation.
   */
  async resolve(id: string | undefined, session?: string): Promise<string> {
    const own = await this.ownPosting(session);
    if (id !== undefined) {
      if (own && own !== id) {
        throw new EzError(
          ErrorCode.BadRequest,
          `This conversation works on posting ${own}, not ${id}.`,
          "Tell the user to open that posting from the ezapply panel's list and ask there.",
        );
      }
      await this.get(id);
      return id;
    }
    if (own) return own;
    throw new EzError(
      ErrorCode.NoPosting,
      "No posting given.",
      "Pass the posting's id (postings_list). If the user hasn't captured it yet, ask them to open the job " +
        "posting in their browser and press Capture in the ezapply side panel.",
    );
  }

  /** Call `fn` after a capture or a delete (the panel's list follows). Returns the function that stops it. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  updateMeta(id: string, patch: PostingMetaPatch): Promise<PostingMeta> {
    if (patch.reqId !== undefined) {
      const req = checkReqId(patch.reqId);
      if (!req.ok) {
        throw new EzError(
          ErrorCode.BadRequest,
          req.reason,
          "reqId is the job's requisition or id as the employer shows it (Req100010, R-0000100575, 1000454). " +
            "Put the title in role.",
        );
      }
      patch = { ...patch, reqId: req.value };
      // A requisition can pick the application among several links on the captured page.
      this.searched.delete(id);
    }
    return this.serialize(async () => {
      const meta = await this.get(id);
      const next = PostingMeta.parse({ ...meta, ...stripUndefined(patch), updatedAt: new Date().toISOString() });
      await writeJsonAtomic(this.metaPath(id), next);
      return next;
    });
  }

  /**
   * The application the posting is tied to: as stored, else its own URL's when that's a form site's page, else
   * found in its capture (postings captured before applications were looked for), and then saved.
   */
  async application(id: string): Promise<PostingApplication | undefined> {
    const meta = await this.get(id);
    const known = meta.application ?? applicationFromUrl(meta);
    if (known || this.searched.has(id)) return known;
    const html = await readFile(join(this.folder(id), "capture", "raw.html"), "utf8").catch(() => null);
    const found =
      html === null
        ? undefined
        : findApplication({
            html,
            url: meta.url,
            ...(meta.frameUrl ? { frameUrl: meta.frameUrl } : {}),
            ...(meta.reqId ? { reqId: meta.reqId } : {}),
            at: new Date().toISOString(),
          });
    if (!found) {
      this.searched.add(id);
      return undefined;
    }
    await this.setApplication(id, found, { keep: true });
    this.log.info({ id, application: found }, "posting tied to its application from its capture");
    return found;
  }

  /**
   * Tie the posting to an application. `keep`: only if it has none (a binding found on the way never replaces
   * what the capture or the user said).
   */
  setApplication(id: string, application: PostingApplication, opts: { keep?: boolean } = {}): Promise<PostingMeta> {
    return this.serialize(async () => {
      const meta = await this.get(id);
      if (opts.keep && meta.application) return meta;
      const next = PostingMeta.parse({ ...meta, application, updatedAt: new Date().toISOString() });
      await writeJsonAtomic(this.metaPath(id), next);
      return next;
    });
  }

  /** Delete a posting for good: its folder and everything in it (capture, notes, documents, form log). */
  delete(id: string): Promise<void> {
    return this.serialize(async () => {
      await this.get(id);
      await rm(this.folder(id), { recursive: true, force: true });
      this.searched.delete(id);
      this.changed();
    });
  }

  /** The posting's folder. Ids come from Claude, so anything that isn't a plain folder name is refused. */
  folder(id: string): string {
    if (!isPostingId(id)) {
      throw new EzError(ErrorCode.BadRequest, `Invalid posting id: ${id}`, "Use an id from postings_list.");
    }
    return this.ws.path("postings", id);
  }

  private async doCapture(p: CapturePayload): Promise<CaptureResult> {
    const canonicalUrl = canonicalizeUrl(p.url);
    // Also re-canonicalize stored URLs, so postings saved before a canonicalization change still match.
    const existing = (await this.list()).find(
      (m) => m.canonicalUrl === canonicalUrl || canonicalizeUrl(m.url) === canonicalUrl,
    );
    const extracted = extractPosting({
      visibleHtml: p.visibleHtml,
      url: p.url,
      pageTitle: p.pageTitle,
      jsonLd: p.jsonLd,
      ...(p.frameUrl ? { frameUrl: p.frameUrl } : {}),
      ...(p.site ? { site: p.site } : {}),
    });

    const now = new Date().toISOString();
    const id = existing?.id ?? (await this.newId(p.capturedAt, extracted.company, extracted.role ?? p.pageTitle));
    // What the user said wins over what the page shows; a fresh page wins over an earlier binding.
    const reqId = existing?.reqId ?? extracted.reqId;
    const found = applicationFromUrl({
      url: p.url,
      capturedAt: p.capturedAt,
      ...(p.frameUrl ? { frameUrl: p.frameUrl } : {}),
    })
      ? undefined
      : findApplication({
          html: p.html,
          url: p.url,
          ...(p.frameUrl ? { frameUrl: p.frameUrl } : {}),
          ...(reqId ? { reqId } : {}),
          at: now,
        });
    const application =
      existing?.application?.from === "user" ? existing.application : (found ?? existing?.application);
    this.searched.delete(id);
    const folder = this.folder(id);
    await mkdir(join(folder, "capture"), { recursive: true });
    await Promise.all([
      writeFile(join(folder, "capture", "raw.html"), p.html, "utf8"),
      writeFile(join(folder, "capture", "visible.html"), p.visibleHtml, "utf8"),
      writeFile(join(folder, "capture", "visible.txt"), p.visibleText, "utf8"),
      writeJsonAtomic(join(folder, "capture", "jsonld.json"), p.jsonLd),
      writeFileAtomic(join(folder, "posting.md"), extracted.markdown),
    ]);

    // On re-capture keep anything Claude already corrected; only fill gaps from extraction.
    const meta: PostingMeta = PostingMeta.parse({
      schemaVersion: 1,
      id,
      url: p.url,
      canonicalUrl,
      ...(p.frameUrl ? { frameUrl: p.frameUrl } : {}),
      pageTitle: p.pageTitle,
      site: extracted.site,
      // The tenant comes from the URL, never from Claude, so a fresh reading replaces an older one.
      tenant: extracted.tenant ?? existing?.tenant,
      company: existing?.company ?? extracted.company,
      role: existing?.role ?? extracted.role,
      reqId,
      location: existing?.location ?? extracted.location,
      deadline: existing?.deadline,
      bundleRequired: existing?.bundleRequired,
      status: existing?.status ?? "captured",
      tabId: p.tabId,
      ...(application ? { application } : {}),
      capturedAt: p.capturedAt,
      updatedAt: now,
    });
    await writeJsonAtomic(this.metaPath(id), meta);
    this.log.info({ id, isNew: !existing, bytes: p.html.length, site: meta.site }, "posting captured");
    this.changed();

    return {
      postingId: id,
      isNew: !existing,
      ...(meta.company ? { company: meta.company } : {}),
      ...(meta.role ? { role: meta.role } : {}),
    };
  }

  private async newId(capturedAt: string, company: string | undefined, role: string): Promise<string> {
    const date = capturedAt.slice(0, 10);
    const base = [date, slugify(company ?? "unknown", 30), slugify(role, 50)].filter(Boolean).join("_");
    let id = base;
    for (let n = 2; await exists(this.folder(id)); n++) id = `${base}-${n}`;
    return id;
  }

  private metaPath(id: string): string {
    return join(this.folder(id), "meta.json");
  }

  /** Captures and metadata updates run one at a time (two quick clicks must not race on one folder). */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.run("postings", fn);
  }
}

function isPostingId(id: string): boolean {
  return POSTING_ID.test(id) && id !== "." && id !== "..";
}

/**
 * The URL that identifies a posting: lowercase host, no trailing slash, only job-id query parameters; on
 * Workday no leading locale segment (`/en-US/`), which the same job's links have or lack; on Oracle no language
 * segment and nothing after the job id, so the application pages (`…/job/123/apply/section/1`) are the job's.
 */
export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw);
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (JOB_ID_PARAMS.has(k.toLowerCase())) keep.set(k, v);
  const query = keep.toString();
  const pathname = siteOfUrl(raw)?.canonicalPath?.(u.pathname) ?? u.pathname;
  const path = pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ""}${path}${query ? `?${query}` : ""}`;
}

export function slugify(s: string, max: number): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

async function listFiles(folder: string): Promise<PostingFile[]> {
  const out: PostingFile[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (HIDDEN_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, relPath);
      else {
        const s = await stat(abs);
        out.push({ path: relPath, bytes: s.size, modifiedAt: s.mtime.toISOString() });
      }
    }
  };
  await walk(folder, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
