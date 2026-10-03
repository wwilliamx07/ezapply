import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EzError } from "@ezapply/protocol";
import { WorkspaceConfig } from "../config/workspace.js";
import type { Logger } from "../logger.js";
import type { Workspace } from "../workspace/workspace.js";

/**
 * Autofill debug mode, the companion's part: with `debug.autofill` on in ezapply.config.json, every form call is
 * written to `debug/<date>-<postingId>/` in the workspace. One `NNNN-<tool>.json` per call (the parameters,
 * every bridge call with its full result, the tab, timings, the autofill plan, the result the agent got) and a
 * line in `index.jsonl`. None of it enters the conversation.
 *
 * Why a flag and not a tool: the agent learns a call went wrong only after it happened, and by then the page has
 * moved on. Why this part first: it changes nothing in the page, so it can record a live run without being an
 * adapter change of its own (references/development.md, "One adapter change per live run").
 *
 * Read on every call (like autofill-timing.yaml), so turning it on applies to the next call. Writing happens
 * after the call has returned, off its path.
 */

export const DEBUG_DIR = "debug";

export interface DebugSettings {
  on: boolean;
  maxMB: number;
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
  bridge: { method: string; params: Record<string, unknown>; ms: number; result?: unknown; error?: string }[];
  /** Extra notes from the call, such as autofill_step's plan per stage (each pass, each Oracle item). */
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
      if (!parsed.success) return { on: false, maxMB: 500 };
      return { on: parsed.data.debug.autofill, maxMB: parsed.data.debug.maxMB };
    } catch {
      return { on: false, maxMB: 500 };
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
    const name = `${String(record.seq).padStart(4, "0")}-${record.tool}.json`;
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
  const autofill = r.result as { filled?: unknown[]; failed?: unknown[]; kept?: number; sections?: unknown[] };
  const shown = r.shown as { hidden?: boolean } | undefined;
  return {
    seq: r.seq,
    ts: r.startedAt,
    tool: r.tool,
    ok: r.error === undefined,
    ms: r.ms,
    queuedMs: r.queuedMs,
    ...(failed.length ? { failedFields: failed } : {}),
    ...(shown?.hidden ? { tabHidden: true } : {}),
    ...(r.tool === "autofill_step" && autofill?.filled
      ? { autofill: { filled: autofill.filled.length, failed: autofill.failed?.length ?? 0, kept: autofill.kept } }
      : {}),
    ...(r.error ? { error: r.error.message } : {}),
    debug: true,
  };
}

interface FillLike {
  fieldId: string;
  ok: boolean;
}

/** File contents don't belong in a dump: an upload's base64 is replaced by its size. */
export function stripBulk(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "timing" || k === "tabId") continue;
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
