import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DebugRequest, EzError } from "@ezapply/protocol";
import { WorkspaceConfig } from "../config/workspace.js";
import type { Logger } from "../logger.js";
import type { Workspace } from "../workspace/workspace.js";

/**
 * Debug mode: with `debug.enabled` on in ezapply.config.json, every form call is written to
 * `debug/<date>-<postingId>/` in the workspace. One `NNNN-<tool>.json` per call (the parameters, every bridge call
 * with its full result and the adapter's trace of it, the tab, timings, the result the agent
 * got) and a line in `index.jsonl`. The page's markup (`debug.markup`) and failure screenshots the trace brings go
 * into files of their own beside it: `NNNN-before.html`, `NNNN-after.html`, `NNNN-fail-<fieldId>.html`,
 * `NNNN-fail.png`. None of it enters the conversation: the trace comes back beside the bridge's result, never in it
 * (protocol's `WithDebug`), and goes only into the record.
 *
 * Why a flag and not a tool: the agent learns a call went wrong only after it happened, and by then the page has
 * moved on.
 *
 * Read on every call (like autofill-timing.yaml), so turning it on applies to the next call. Writing happens
 * after the call has returned, off its path.
 */

export const DEBUG_DIR = "debug";

export type MarkupSetting = "failures" | "always" | "none";

export interface DebugSettings {
  on: boolean;
  maxMB: number;
  markup: MarkupSetting;
}

const OFF: DebugSettings = { on: false, maxMB: 500, markup: "failures" };

/**
 * What a debugged bridge call asks the adapter for: its trace always, and the markup `debug.markup` says. The page
 * before the call is saved once per record (before its first adapter call), the page after it with "always" (the
 * last one is kept), failures unless "none".
 */
export function debugRequest(markup: MarkupSetting, first: boolean): DebugRequest {
  if (markup === "none") return {};
  return { ...(first ? { before: true } : {}), ...(markup === "always" ? { after: true } : {}), failures: true };
}

/** One form call as recorded. */
export interface CallRecord {
  seq: number;
  tool: string;
  params: Record<string, unknown>;
  startedAt: string;
  /** Time spent waiting behind earlier calls on the same tab. */
  queuedMs: number;
  ms?: number;
  tab?: Record<string, unknown>;
  posting?: string;
  postingMismatch?: unknown;
  extensionVersion?: string;
  browser?: unknown;
  timing?: unknown;
  fillTimeoutMs?: number;
  shown?: unknown;
  bridge: {
    method: string;
    params: Record<string, unknown>;
    ms: number;
    result?: unknown;
    error?: string;
    /** The adapter's trace of this call (adapters/engine/trace.ts); its markup and screenshot as file names. */
    trace?: Trace;
  }[];
  /** Extra notes from the call, such as `noTrace` when the extension sent no adapter trace. */
  notes: Record<string, unknown[]>;
  result?: unknown;
  error?: { code: string; message: string };
  debug: true;
}

/** Reads the setting for each call and writes the records. */
export class DebugRecorder {
  private writes: Promise<void> = Promise.resolve();
  /** The next sequence number per session folder. */
  private readonly next = new Map<string, number>();
  private sinceLastPrune = 0;

  constructor(
    private readonly ws: Workspace,
    private readonly log: Logger,
  ) {}

  /** The setting in ezapply.config.json; off when the file is missing or can't be read. */
  async settings(): Promise<DebugSettings> {
    try {
      const raw = JSON.parse(await readFile(this.ws.path("ezapply.config.json"), "utf8"));
      const parsed = WorkspaceConfig.safeParse(raw);
      if (!parsed.success) return OFF;
      const { enabled, maxMB, markup } = parsed.data.debug;
      return { on: enabled, maxMB, markup };
    } catch {
      return OFF;
    }
  }

  start(tool: string, params: Record<string, unknown>, queuedMs: number): CallRecord {
    return {
      seq: 0,
      tool,
      params: stripBulk(params),
      startedAt: new Date().toISOString(),
      queuedMs,
      bridge: [],
      notes: {},
      debug: true,
    };
  }

  /**
   * Queue the record for writing (after the call returned or failed). `postingId` names the session folder,
   * with today's date. Never throws: a dump that can't be written is logged.
   */
  finish(record: CallRecord, settings: DebugSettings, outcome: { result?: unknown; error?: unknown }): void {
    record.ms = Date.now() - Date.parse(record.startedAt);
    if (outcome.error !== undefined) {
      const e = EzError.from(outcome.error);
      record.error = { code: e.code, message: e.message };
    } else {
      record.result = outcome.result;
    }
    const folder = this.ws.path(DEBUG_DIR, `${record.startedAt.slice(0, 10)}-${record.posting ?? "no-posting"}`);
    this.writes = this.writes
      .then(() => this.write(folder, record, settings))
      .catch((err: unknown) => this.log.warn({ err: (err as Error).message }, "debug dump not written"));
  }

  /** Resolves once every queued record is on disk (tests). */
  idle(): Promise<void> {
    return this.writes;
  }

  private async write(folder: string, record: CallRecord, settings: DebugSettings): Promise<void> {
    await mkdir(folder, { recursive: true });
    record.seq = await this.seq(folder);
    const nnnn = String(record.seq).padStart(4, "0");
    for (const [file, content] of extractFiles(record, nnnn)) await writeFile(join(folder, file), content);
    const name = `${nnnn}-${record.tool}.json`;
    await writeFile(join(folder, name), `${JSON.stringify(record, null, 1)}\n`, "utf8");
    await appendFile(join(folder, "index.jsonl"), `${JSON.stringify(indexLine(record))}\n`, "utf8");
    if (++this.sinceLastPrune >= 50 || record.seq === 1) {
      this.sinceLastPrune = 0;
      await pruneDebug(this.ws.path(DEBUG_DIR), settings.maxMB * 1024 * 1024, folder);
    }
  }

  private async seq(folder: string): Promise<number> {
    let n = this.next.get(folder);
    if (n === undefined) {
      const index = await readFile(join(folder, "index.jsonl"), "utf8").catch(() => "");
      n = index.split("\n").filter((l) => l.trim()).length + 1;
    }
    this.next.set(folder, n + 1);
    return n;
  }
}

/** What `index.jsonl` holds per call: enough to find the calls worth opening. */
function indexLine(r: CallRecord) {
  const fills = r.bridge.filter((b) => b.method === "form.fill").flatMap((b) => (b.result as FillLike[]) ?? []);
  const failed = fills.filter((f) => f && f.ok === false).map((f) => f.fieldId);
  const shown = r.shown as { hidden?: boolean; focused?: boolean } | undefined;
  return {
    seq: r.seq,
    ts: r.startedAt,
    tool: r.tool,
    ok: r.error === undefined,
    ms: r.ms,
    queuedMs: r.queuedMs,
    ...(failed.length ? { failedFields: failed } : {}),
    ...(shown?.hidden ? { tabHidden: true } : {}),
    ...(shown?.focused === false ? { windowInBackground: true } : {}),
    ...(r.error ? { error: r.error.message } : {}),
    debug: true,
  };
}

interface FillLike {
  fieldId: string;
  ok: boolean;
}

/** A bridge call's trace as the adapter sends it: what this file needs of it. */
export interface Trace {
  markup?: { before?: string; after?: string; failures?: { fieldId: string; html: string }[] };
  screenshot?: string;
  [key: string]: unknown;
}

/**
 * Take the markup and screenshots out of a record's traces, as files: the page before the call (from its first
 * bridge call that has it), after it (its last), each failed field's snapshot, each screenshot. The trace keeps
 * their file names. Returns [file name, contents].
 */
export function extractFiles(record: CallRecord, nnnn: string): [string, string | Buffer][] {
  const files = new Map<string, string | Buffer>();
  const unique = (base: string, ext: string) => {
    let name = `${base}${ext}`;
    for (let n = 2; files.has(name); n++) name = `${base}-${n}${ext}`;
    return name;
  };
  for (const entry of record.bridge) {
    const t = entry.trace;
    if (!t) continue;
    const kept: Record<string, unknown> = {};
    if (t.markup?.before !== undefined) {
      const name = `${nnnn}-before.html`;
      if (!files.has(name)) files.set(name, t.markup.before);
      kept.before = name;
    }
    if (t.markup?.after !== undefined) {
      const name = `${nnnn}-after.html`;
      files.set(name, t.markup.after);
      kept.after = name;
    }
    if (t.markup?.failures?.length) {
      kept.failures = t.markup.failures.map((f) => {
        const name = unique(`${nnnn}-fail-${safeName(f.fieldId)}`, ".html");
        files.set(name, f.html);
        return { fieldId: f.fieldId, file: name };
      });
    }
    if (t.markup) t.markup = kept as Trace["markup"];
    if (typeof t.screenshot === "string") {
      const name = unique(`${nnnn}-fail`, ".png");
      files.set(name, Buffer.from(t.screenshot, "base64"));
      t.screenshot = name;
    }
  }
  return [...files];
}

/** A field id as part of a file name: `work-experience-1.jobTitle#2` → `work-experience-1.jobTitle_2`. */
const safeName = (id: string) => id.replace(/[^\w.-]+/g, "_").slice(0, 80);

/** File contents don't belong in a dump: an upload's base64 is replaced by its size. */
export function stripBulk(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "timing" || k === "tabId" || k === "debug") continue;
    if (k === "file" && v && typeof v === "object" && "base64" in v) {
      const { base64, ...rest } = v as { base64: string };
      out[k] = { ...rest, bytes: Math.floor((base64.length * 3) / 4) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Keep `debug/` under `maxBytes`: delete whole session folders, oldest first (by name, which starts with the
 * date), never the one being written.
 */
export async function pruneDebug(root: string, maxBytes: number, keep?: string): Promise<string[]> {
  const sessions = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => join(root, d.name))
    .sort();
  const sizes = new Map<string, number>();
  for (const s of sessions) sizes.set(s, await folderSize(s));
  let total = [...sizes.values()].reduce((a, b) => a + b, 0);
  const removed: string[] = [];
  for (const s of sessions) {
    if (total <= maxBytes) break;
    if (s === keep) continue;
    await rm(s, { recursive: true, force: true });
    total -= sizes.get(s) ?? 0;
    removed.push(s);
  }
  return removed;
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await folderSize(p) : ((await stat(p).catch(() => null))?.size ?? 0);
  }
  return total;
}
