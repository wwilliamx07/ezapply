import { readFile } from "node:fs/promises";
import { DEFAULT_TIMING, resolveTiming, TIMING_DOCS, type Timing, type TimingKey } from "@ezapply/protocol";
import { parse } from "yaml";
import type { Workspace } from "../workspace/workspace.js";

/** In the workspace root; the user's (created by `ezapply init`, never overwritten). */
export const TIMING_FILE = "autofill-timing.yaml";

const DEFAULT_FILL_TIMEOUT_SECONDS = 120;
const MAX_WAIT_MS = 120_000;

export interface LoadedTiming {
  /** Every wait, resolved against the defaults and scaled: what the adapter gets. */
  timing: Timing;
  /** How long the companion waits for one `form.fill`. */
  fillTimeoutMs: number;
  /** What was wrong with the file (that part fell back to the default), for get_form to pass on. */
  issues: string[];
}

/**
 * Read `autofill-timing.yaml`. It's read on every form call, so a saved edit applies to the next call without a
 * restart. A missing file means the defaults; anything wrong in it (bad YAML, an unknown key, a value out of
 * range) falls back to the default for that part and is reported, never failing the call.
 */
export async function loadTiming(ws: Workspace): Promise<LoadedTiming> {
  const issues: string[] = [];
  let raw: unknown = null;
  try {
    raw = parse(await readFile(ws.path(TIMING_FILE), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      issues.push(
        `${TIMING_FILE} couldn't be read, so the defaults are used: ${(err as Error).message.split("\n")[0]}`,
      );
    }
  }
  const file = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (raw !== null && raw !== undefined && file !== raw) issues.push(`${TIMING_FILE} should hold "key: value" lines.`);

  const number = (key: string, min: number, max: number): number | undefined => {
    const v = file[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) return v;
    issues.push(`${TIMING_FILE}: ${key} must be a number from ${min} to ${max}; using the default.`);
    return undefined;
  };
  const overrides: Partial<Record<TimingKey, number>> = {};
  for (const key of Object.keys(file)) {
    if (key === "scale" || key === "fillTimeoutSeconds") continue;
    if (!(key in DEFAULT_TIMING)) {
      issues.push(`${TIMING_FILE}: unknown key "${key}" ignored.`);
      continue;
    }
    const v = number(key, key === "pollMs" ? 5 : 0, MAX_WAIT_MS);
    if (v !== undefined) overrides[key as TimingKey] = v;
  }
  const scale = number("scale", 0.1, 10) ?? 1;
  const fillTimeoutSeconds = number("fillTimeoutSeconds", 10, 600) ?? DEFAULT_FILL_TIMEOUT_SECONDS;
  return { timing: resolveTiming(overrides, scale), fillTimeoutMs: fillTimeoutSeconds * 1000, issues };
}

/** The file `ezapply init` writes: every setting commented out at its default, with what it does. */
export function timingFileTemplate(): string {
  const width = Math.max(...Object.keys(DEFAULT_TIMING).map((k) => k.length)) + 8;
  const lines = (Object.keys(DEFAULT_TIMING) as TimingKey[]).map((k) =>
    `# ${`${k}: ${DEFAULT_TIMING[k]}`.padEnd(width)}# ${TIMING_DOCS[k]}`.trimEnd(),
  );
  return [
    "# ezapply autofill timing: how long the Workday adapter waits, in milliseconds.",
    "#",
    "# Read on every form call: save, and the next call uses it (no restart). Uncomment a line to change it.",
    "# Most waits end as soon as what they wait for happens and cost their full length only when it doesn't.",
    '# A "quiet" wait ends once the page has stopped changing for that long; its "max" ends it regardless.',
    '# Too short, and fields fail ("Could not open the dropdown", a value that didn\'t stick): raise it again.',
    "# A mistake here never stops a fill: that setting falls back to its default and get_form says so.",
    "# Delete the file and run `ezapply init` to get it back with the current defaults.",
    "",
    "# Multiplies the defaults of every wait you leave commented out (not pollMs): 0.5 = half as long.",
    "# A wait you set below is used exactly as written.",
    "scale: 1",
    "",
    "# How long the companion waits for one fill_fields call before giving up (the page may still be filling).",
    `# fillTimeoutSeconds: ${DEFAULT_FILL_TIMEOUT_SECONDS}`,
    "",
    ...lines,
    "",
  ].join("\n");
}
