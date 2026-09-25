import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CapturePayload,
  type CaptureResult,
  ErrorCode,
  EzError,
  PostingMeta,
  type PostingMetaPatch,
} from "@ezapply/protocol";
import type { Logger } from "../logger.js";
import { readJson, type Workspace, writeFileAtomic, writeJsonAtomic } from "../workspace/workspace.js";
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
  active: boolean;
}

/** Build output, snapshots and previews are noise when listing a posting folder. */
const HIDDEN_DIRS = new Set([".history", ".build", ".previews"]);

/** Job query parameters that identify a posting; everything else is dropped from the canonical URL. */
const JOB_ID_PARAMS = new Set(["gh_jid", "jobid", "job_id", "jid", "jk", "currentjobid", "id", "reqid"]);

export class PostingsService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
  ) {}

  /** Store a capture from the extension and make it the active posting. */
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

  async details(id: string): Promise<PostingDetails> {
    const meta = await this.get(id);
    const folder = this.folder(id);
    const { activePostingId } = await this.ws.readState();
    return {
      ...meta,
      folder,
      postingMd: join(folder, "posting.md"),
      visibleText: join(folder, "capture", "visible.txt"),
      rawHtml: join(folder, "capture", "raw.html"),
      files: await listFiles(folder),
      active: activePostingId === id,
    };
  }

  async activeId(): Promise<string | null> {
    const { activePostingId } = await this.ws.readState();
    if (!activePostingId) return null;
    try {
      await this.get(activePostingId);
      return activePostingId;
    } catch {
      return null;
    }
  }

  async requireActiveId(): Promise<string> {
    const id = await this.activeId();
    if (!id) {
      throw new EzError(
        ErrorCode.NoActivePosting,
        "No active posting.",
        "Ask the user to open the job posting in Chrome and click the ezapply toolbar button (Set posting), or activate a previous one with posting_activate.",
      );
    }
    return id;
  }

  async activate(id: string): Promise<PostingMeta> {
    const meta = await this.get(id);
    await this.ws.updateState({ activePostingId: id });
    return meta;
  }

  updateMeta(id: string, patch: PostingMetaPatch): Promise<PostingMeta> {
    return this.serialize(async () => {
      const meta = await this.get(id);
      const next = PostingMeta.parse({ ...meta, ...stripUndefined(patch), updatedAt: new Date().toISOString() });
      await writeJsonAtomic(this.metaPath(id), next);
      return next;
    });
  }

  folder(id: string): string {
    return this.ws.path("postings", id);
  }

  private async doCapture(p: CapturePayload): Promise<CaptureResult> {
    const canonicalUrl = canonicalizeUrl(p.url);
    const existing = (await this.list()).find((m) => m.canonicalUrl === canonicalUrl);
    const extracted = extractPosting({
      visibleHtml: p.visibleHtml,
      url: p.url,
      pageTitle: p.pageTitle,
      jsonLd: p.jsonLd,
    });

    const now = new Date().toISOString();
    const id = existing?.id ?? (await this.newId(p.capturedAt, extracted.company, extracted.role ?? p.pageTitle));
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
      pageTitle: p.pageTitle,
      site: extracted.site,
      tenant: existing?.tenant ?? extracted.tenant,
      company: existing?.company ?? extracted.company,
      role: existing?.role ?? extracted.role,
      reqId: existing?.reqId ?? extracted.reqId,
      location: existing?.location ?? extracted.location,
      deadline: existing?.deadline,
      bundleRequired: existing?.bundleRequired,
      status: existing?.status ?? "captured",
      tabId: p.tabId,
      capturedAt: p.capturedAt,
      updatedAt: now,
    });
    await writeJsonAtomic(this.metaPath(id), meta);
    await this.ws.updateState({ activePostingId: id });
    this.log.info({ id, isNew: !existing, bytes: p.html.length, site: meta.site }, "posting captured");

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

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw);
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (JOB_ID_PARAMS.has(k.toLowerCase())) keep.set(k, v);
  const query = keep.toString();
  const path = u.pathname.replace(/\/+$/, "") || "/";
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
