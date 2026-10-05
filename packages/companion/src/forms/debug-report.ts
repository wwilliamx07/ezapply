import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CallRecord, Trace } from "./debug.js";

/**
 * `ezapply debug report`: a summary of one debug session (a folder under debug/), for Claude working on ezapply
 * to read before opening single records. Where time went, what failed and why, and how autofill did: fills
 * by rule, fills the model or user changed afterwards (a wrong rule), profile fills no rule covered (a missing
 * hint), and loose matches the strict check refused (a missing alias). From the adapter's trace: the slowest fields
 * and waits, waits that ran to their maximum, the slow paths the fillers took, the page's own errors and failed
 * requests, and what was saved at each failure.
 */
export async function debugReport(dir: string): Promise<string> {
  const records = await loadRecords(dir);
  const out: string[] = [];
  const total = sum(records.map((r) => r.ms ?? 0));
  const queued = sum(records.map((r) => r.queuedMs));
  out.push(
    `Debug session ${basename(dir)}: ${records.length} form calls, ${secs(total)} in calls, ${secs(queued)} queued.`,
  );
  if (records.length === 0) return `${out.join("\n")}\n`;

  out.push("", "## Calls by tool", table(byTool(records), ["tool", "calls", "total", "slowest"]));

  const slowest = [...records].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 10);
  out.push(
    "",
    "## Slowest calls",
    ...slowest.map(
      (r) =>
        `- #${r.seq} ${r.tool}: ${secs(r.ms ?? 0)}${r.queuedMs > 50 ? ` (+${secs(r.queuedMs)} queued)` : ""}${hidden(r) ? ", tab hidden" : ""}`,
    ),
  );

  const hiddenMs = sum(records.filter(hidden).map((r) => r.ms ?? 0));
  if (hiddenMs > 0) out.push("", `Time in calls with the tab hidden: ${secs(hiddenMs)}.`);
  // Focus events don't reach a page in a window behind another app, and some widgets need them (dates on Workday).
  const behind = records.filter(inBackground);
  if (behind.length) {
    out.push(
      "",
      `Calls with the browser window behind another app: ${behind.length} of ${records.length} (${behind.map((r) => `#${r.seq}`).join(", ")}).`,
    );
  }

  const errors = records.filter((r) => r.error);
  if (errors.length) {
    out.push("", "## Calls that failed", ...errors.map((r) => `- #${r.seq} ${r.tool}: ${r.error?.message}`));
  }

  const failedFields = new Map<string, string[]>();
  for (const r of records) {
    for (const b of r.bridge.filter((x) => x.method === "form.fill")) {
      for (const f of (b.result as FillLike[] | undefined) ?? []) {
        if (f.ok) continue;
        const key = (f.error ?? "failed").slice(0, 100);
        failedFields.set(key, [...(failedFields.get(key) ?? []), `#${r.seq} ${f.fieldId}`]);
      }
    }
  }
  if (failedFields.size) {
    out.push(
      "",
      "## Failed fields by error",
      ...[...failedFields].map(([error, ids]) => `- ${error} (${ids.length}): ${ids.join(", ")}`),
    );
  }

  out.push(...autofillSection(records));
  out.push(...traceSection(records));
  return `${out.join("\n")}\n`;
}

/** The newest session folder under `root` (folder names start with the date). */
export async function latestDebugSession(root: string): Promise<string | null> {
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const last = dirs.at(-1);
  return last ? join(root, last) : null;
}

function autofillSection(records: CallRecord[]): string[] {
  const steps = records.filter((r) => r.tool === "autofill_step");
  if (steps.length === 0) return [];
  const out = ["", "## Autofill"];
  const byRule = new Map<string, { filled: number; failed: number }>();
  const auto = new Map<string, { value: unknown; seq: number; rule: string }>();
  const left = new Map<string, string>();
  for (const r of steps) {
    const res = r.result as AutofillLike | undefined;
    out.push(
      `- #${r.seq}: filled ${res?.filled?.length ?? 0}, failed ${res?.failed?.length ?? 0}, kept ${res?.kept ?? 0}` +
        (res?.note ? ` (${res.note})` : ""),
    );
    for (const f of res?.filled ?? []) {
      bump(byRule, f.rule, "filled");
      auto.set(f.fieldId, { value: f.value, seq: r.seq, rule: f.rule });
    }
    for (const f of res?.failed ?? []) bump(byRule, f.rule, "failed");
    for (const pass of (r.notes.autofill as PassLike[] | undefined) ?? []) {
      for (const [id, reason] of Object.entries(pass.left ?? {})) left.set(id, reason);
    }
  }
  out.push(
    "",
    "### Fills by rule",
    ...[...byRule].sort().map(([rule, n]) => `- ${rule}: ${n.filled} filled${n.failed ? `, ${n.failed} failed` : ""}`),
  );

  const misses = steps.flatMap((r) =>
    ((r.notes.readBack as ReadBackLike[] | undefined) ?? [])
      .filter((c) => !c.ok && c.selected)
      .map((c) => `- #${r.seq} ${c.fieldId}: wanted ${show(c.wanted)}, the page picked ${show(c.selected)}`),
  );
  if (misses.length) out.push("", "### Loose matches refused (alias candidates)", ...misses);

  const changed: string[] = [];
  const uncovered: string[] = [];
  for (const r of records.filter((x) => x.tool === "fill_fields")) {
    for (const f of (r.params.fills as FillParam[] | undefined) ?? []) {
      const a = auto.get(f.fieldId);
      if (a && a.seq < r.seq && JSON.stringify(a.value) !== JSON.stringify(f.value)) {
        changed.push(`- ${f.fieldId}: ${a.rule} put ${show(a.value)}, #${r.seq} (${f.source}) set ${show(f.value)}`);
      }
      if (f.source === "profile" && !a) {
        const field = lastSeen(records, r.seq, f.fieldId);
        const why = left.get(f.fieldId);
        uncovered.push(
          `- #${r.seq} ${f.fieldId}${field ? ` "${field.label}" (${field.kind}${field.automationId ? `, ${field.automationId}` : ""}, section "${field.section}")` : ""}: ${show(f.value)}${why ? `, left as ${why}` : ""}`,
        );
      }
    }
  }
  if (changed.length) out.push("", "### Automatic fills changed afterwards (wrong rule?)", ...changed);
  if (uncovered.length) out.push("", "### Profile fills no rule covered (hint candidates)", ...uncovered);
  return out;
}

interface TraceEventLike {
  t: number;
  k: string;
  ms?: number;
  [key: string]: unknown;
}

/** What the adapter's traces say: where the time went inside the page, and what went wrong there. */
function traceSection(records: CallRecord[]): string[] {
  const traced = records.flatMap((r) =>
    r.bridge.filter((b) => b.trace).map((b) => ({ seq: r.seq, trace: b.trace as Trace })),
  );
  const out: string[] = [];
  const untraced = records.filter((r) => r.notes.noTrace);
  if (untraced.length) {
    out.push("", `No adapter trace in ${untraced.length} calls: the extension was built before it (reload it).`);
  }
  if (traced.length === 0) return out;
  const events = traced.flatMap(({ seq, trace }) =>
    ((trace.events as TraceEventLike[] | undefined) ?? []).map((e) => ({ seq, e })),
  );
  out.push("", "## Inside the page (adapter trace)");

  const slowest = (k: string) =>
    events
      .filter(({ e }) => e.k === k && typeof e.ms === "number")
      .sort((a, b) => (b.e.ms ?? 0) - (a.e.ms ?? 0))
      .slice(0, 10);
  const fields = slowest("field");
  if (fields.length) {
    out.push(
      "",
      "### Slowest fields",
      ...fields.map(
        ({ seq, e }) =>
          `- #${seq} ${e.fieldId} (${e.op}): ${secs(e.ms ?? 0)}${e.ok === false ? `, failed: ${e.error ?? ""}` : ""}`,
      ),
    );
  }
  const waits = slowest("wait");
  if (waits.length) {
    out.push(
      "",
      "### Slowest waits",
      ...waits.map(({ seq, e }) => `- #${seq} ${e.name} (${e.kind}): ${ms(e.ms)} of ${ms(e.max)}, ended by ${e.end}`),
    );
  }

  // A settle at its maximum: the page never went quiet. A waitFor at its maximum: what it waited for never came.
  const atMax = new Map<string, { n: number; ms: number; seqs: Set<number> }>();
  for (const { seq, e } of events) {
    if (e.k !== "wait" || e.end !== "max") continue;
    const key = `${e.name} (${e.kind})`;
    const v = atMax.get(key) ?? { n: 0, ms: 0, seqs: new Set<number>() };
    v.n++;
    v.ms += e.ms ?? 0;
    v.seqs.add(seq);
    atMax.set(key, v);
  }
  if (atMax.size) {
    out.push(
      "",
      "### Waits that ran to their maximum",
      ...[...atMax]
        .sort((a, b) => b[1].ms - a[1].ms)
        .map(([key, v]) => `- ${key}: ${v.n}×, ${secs(v.ms)} (${calls(v.seqs)})`),
    );
  }

  const paths = new Map<string, { n: number; seqs: Set<number> }>();
  for (const { seq, e } of events) {
    const key =
      e.k === "branch"
        ? String(e.name)
        : e.k === "react"
          ? `React's ${e.handler} called directly${e.missing ? " (none found)" : ""}`
          : undefined;
    if (!key) continue;
    const v = paths.get(key) ?? { n: 0, seqs: new Set<number>() };
    v.n++;
    v.seqs.add(seq);
    paths.set(key, v);
  }
  if (paths.size) {
    out.push("", "### Slow paths taken", ...[...paths].map(([key, v]) => `- ${key}: ${v.n}× (${calls(v.seqs)})`));
  }

  const errors = traced.flatMap(({ seq, trace }) =>
    ((trace.errors as TraceEventLike[] | undefined) ?? []).map((e) => `- #${seq} ${e.k}: ${e.message}`),
  );
  if (errors.length) out.push("", `### Page errors (${errors.length})`, ...errors.slice(0, 20));

  const failedRequests = traced.flatMap(({ seq, trace }) =>
    ((trace.requests as TraceEventLike[] | undefined) ?? [])
      .filter((q) => typeof q.status === "string" || (typeof q.status === "number" && q.status >= 400))
      .map((q) => `- #${seq} ${q.method} ${q.path}: ${q.status}`),
  );
  if (failedRequests.length) {
    out.push("", `### Failed requests (${failedRequests.length})`, ...failedRequests.slice(0, 20));
  }

  const saved = traced.flatMap(({ seq, trace }) => [
    ...((trace.markup?.failures ?? []) as { fieldId: string; file?: string }[]).map(
      (f) => `- #${seq} ${f.fieldId}: ${f.file}`,
    ),
    ...(typeof trace.screenshot === "string" ? [`- #${seq} screenshot: ${trace.screenshot}`] : []),
  ]);
  if (saved.length) out.push("", "### Saved at failures", ...saved);

  const cut = [...new Set(traced.filter(({ trace }) => trace.dropped).map(({ seq }) => seq))];
  if (cut.length) out.push("", `Trace lists cut at their cap in ${calls(new Set(cut))}.`);
  return out;
}

const calls = (seqs: Set<number>) => [...seqs].map((s) => `#${s}`).join(", ");
const ms = (v: unknown) => `${Math.round(Number(v) || 0)} ms`;

/** The field as the last read before `seq` showed it (label, kind, automation id, section). */
function lastSeen(records: CallRecord[], seq: number, fieldId: string) {
  for (const r of [...records].reverse()) {
    if (r.seq >= seq) continue;
    for (const b of r.bridge.filter((x) => x.method === "form.get")) {
      const form = b.result as FormLike | undefined;
      for (const s of form?.sections ?? []) {
        const f = s.fields.find((x) => x.id === fieldId);
        if (f) return { label: f.label, kind: f.kind, automationId: f.automationId, section: s.title };
      }
    }
  }
  return undefined;
}

async function loadRecords(dir: string): Promise<CallRecord[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^\d{4}-.+\.json$/.test(n)).sort();
  const out: CallRecord[] = [];
  for (const n of names) {
    try {
      out.push(JSON.parse(await readFile(join(dir, n), "utf8")) as CallRecord);
    } catch {
      // a record cut off mid-write: skip it
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

function byTool(records: CallRecord[]): string[][] {
  const m = new Map<string, number[]>();
  for (const r of records) m.set(r.tool, [...(m.get(r.tool) ?? []), r.ms ?? 0]);
  return [...m]
    .sort((a, b) => sum(b[1]) - sum(a[1]))
    .map(([tool, ms]) => [tool, String(ms.length), secs(sum(ms)), secs(Math.max(...ms))]);
}

function table(rows: string[][], head: string[]): string {
  const all = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Counted per rule, rows together: `row:work[1].title` counts as `row:work[].title`. */
function bump(m: Map<string, { filled: number; failed: number }>, rule: string, k: "filled" | "failed") {
  rule = rule.replace(/\[\d+\]/g, "[]");
  const v = m.get(rule) ?? { filled: 0, failed: 0 };
  v[k]++;
  m.set(rule, v);
}

const hidden = (r: CallRecord) => Boolean((r.shown as { hidden?: boolean } | undefined)?.hidden);
const inBackground = (r: CallRecord) => (r.shown as { focused?: boolean } | undefined)?.focused === false;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const show = (v: unknown) => JSON.stringify(v);

interface FillLike {
  fieldId: string;
  ok: boolean;
  error?: string;
}
interface FillParam {
  fieldId: string;
  value: unknown;
  source: string;
}
interface AutofillLike {
  filled?: { fieldId: string; value: unknown; rule: string }[];
  failed?: { fieldId: string; rule: string }[];
  kept?: number;
  note?: string;
}
interface PassLike {
  left?: Record<string, string>;
}
interface ReadBackLike {
  fieldId: string;
  wanted: unknown;
  ok: boolean;
  selected?: string;
}
interface FormLike {
  sections?: { title: string; fields: { id: string; label: string; kind: string; automationId?: string }[] }[];
}
