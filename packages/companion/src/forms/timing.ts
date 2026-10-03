import { readFile } from "node:fs/promises";
import {
  FORM_SITE_IDS,
  resolveTiming,
  SITES,
  STANDARD_WAITS,
  siteInfo,
  TIMING_DOCS,
  type Timing,
  type TimingKey,
} from "@ezapply/protocol";
import { parse } from "yaml";
import type { Workspace } from "../workspace/workspace.js";

/** In the workspace root; the user's (created by `ezapply init`, never overwritten). */
export const TIMING_FILE = "autofill-timing.yaml";

const DEFAULT_FILL_TIMEOUT_SECONDS = 120;
const MAX_WAIT_MS = 120_000;

export interface LoadedTiming {
  /** Every wait, resolved against the site's own waits and scaled: what the adapter gets. */
  timing: Timing;
  /** How long the companion waits for one `form.fill`. */
  fillTimeoutMs: number;
  /** What was wrong with the file (that part fell back to the default), for get_form to pass on. */
  issues: string[];
}

/**
 * Read `autofill-timing.yaml` for one site's form call. It's read on every form call, so a saved edit applies to the
 * next call without a restart. Each site owns its waits (its registry entry); the file overrides them: a top-level
 * key for every site, a key under the site's own name (`workday:`, `oracle:`) for that site only, winning over the
 * top-level one. A missing file means the site's own waits; anything wrong in it (bad YAML, an unknown key, a value
 * out of range) falls back for that part and is reported, never failing the call.
 */
export async function loadTiming(ws: Workspace, site = "workday"): Promise<LoadedTiming> {
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

  const number = (where: Record<string, unknown>, key: string, min: number, max: number, name = key) => {
    const v = where[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) return v;
    issues.push(`${TIMING_FILE}: ${name} must be a number from ${min} to ${max}; using the default.`);
    return undefined;
  };
  const waits = (where: Record<string, unknown>, prefix: string) => {
    const out: Partial<Record<TimingKey, number>> = {};
    for (const key of Object.keys(where)) {
      if (!prefix && (key === "scale" || key === "fillTimeoutSeconds" || FORM_SITE_IDS.includes(key as never))) {
        continue;
      }
      if (!(key in STANDARD_WAITS)) {
        issues.push(`${TIMING_FILE}: unknown key "${prefix}${key}" ignored.`);
        continue;
      }
      const v = number(where, key, key === "pollMs" ? 5 : 0, MAX_WAIT_MS, `${prefix}${key}`);
      if (v !== undefined) out[key as TimingKey] = v;
    }
    return out;
  };
  const section = file[site];
  const own =
    section && typeof section === "object" && !Array.isArray(section) ? (section as Record<string, unknown>) : {};
  if (section !== undefined && section !== null && own !== section) {
    issues.push(`${TIMING_FILE}: ${site} should hold "key: value" lines.`);
  }
  const overrides = { ...waits(file, ""), ...waits(own, `${site}.`) };
  const scale = number(file, "scale", 0.1, 10) ?? 1;
  const fillTimeoutSeconds = number(file, "fillTimeoutSeconds", 10, 600) ?? DEFAULT_FILL_TIMEOUT_SECONDS;
  const base: Timing = siteInfo(site)?.waits ?? { ...STANDARD_WAITS };
  return { timing: resolveTiming(base, overrides, scale), fillTimeoutMs: fillTimeoutSeconds * 1000, issues };
}

/**
 * The file `ezapply init` writes: every setting commented out at its default, with what it does. A wait whose
 * default differs between sites lists each site's.
 */
export function timingFileTemplate(): string {
  const width = Math.max(...Object.keys(STANDARD_WAITS).map((k) => k.length)) + 8;
  const lines = (Object.keys(STANDARD_WAITS) as TimingKey[]).map((k) => {
    const values = new Set(SITES.map((s) => s.waits[k]));
    const value = values.size === 1 ? String([...values][0]) : "";
    const each = values.size === 1 ? "" : ` (${SITES.map((s) => `${s.id} ${s.waits[k]}`).join(", ")})`;
    return `# ${`${k}: ${value}`.padEnd(width)}# ${TIMING_DOCS[k]}${each}`.trimEnd();
  });
  return [
    "# ezapply autofill timing: how long the form adapters wait, in milliseconds.",
    "#",
    "# Each job site has its own waits (the defaults below). A key at the top level changes it on every site; a",
    `# key under a site's name changes it there only, e.g. "workday:" then "  dropdownOpenMs: 400". Sites: ${SITES.map((s) => s.id).join(", ")}.`,
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
