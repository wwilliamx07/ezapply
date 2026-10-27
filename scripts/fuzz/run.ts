import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { launchBrowser } from "../harness/lib/browser.ts";
import { readMap } from "./lib/map.ts";
import { SCENARIOS, type Scenario, type Section } from "./lib/scenarios.ts";
import { FuzzServer } from "./lib/server.ts";
import { type Failure, pool, type ScenarioReport, Walker, type WalkOptions } from "./lib/walk.ts";

const ROOT = join(import.meta.dirname, "..", "..");
export const SHOTS = join(ROOT, ".fuzz", "shots");
export const GOLDENS = join(import.meta.dirname, "goldens", process.platform);

export interface FuzzResult {
  reports: ScenarioReport[];
  /** Every failure: the scenarios', the map's own, and conditional controls no scenario showed. */
  failures: Failure[];
}

/**
 * Fuzzes the scenarios given (a section's, or named ones) against the map: the map's own problems first, then each
 * scenario walked, then each section's conditional controls checked to have shown in one of its scenarios.
 */
export async function fuzz(
  scenarios: Scenario[],
  opts: Partial<WalkOptions> & { headed?: boolean; parallel?: number; log?: (line: string) => void } = {},
): Promise<FuzzResult> {
  const log = opts.log ?? (() => {});
  const map = readMap();
  const failures: Failure[] = map.problems.map((m) => ({ kind: "map", scenario: "", page: "", path: "", message: m }));
  for (const sc of scenarios)
    if (!map.pages.has(sc.start))
      failures.push({ kind: "map", scenario: sc.name, page: "", path: "", message: `no map page ${sc.start}` });
  const server = new FuzzServer();
  await server.start();
  const browser = await launchBrowser(opts.headed ?? false);
  const walker = new Walker(map, server, browser, {
    shots: SHOTS,
    goldens: GOLDENS,
    update: false,
    compare: true,
    seed: 1,
    steps: 40,
    workers: 6,
    ...opts,
  });
  const reports: ScenarioReport[] = [];
  try {
    // Scenarios go side by side too: each run has its own fake, so nothing is shared but the browser.
    await pool(scenarios, opts.parallel ?? 3, async (sc) => {
      const started = Date.now();
      const r = await walker.scenario(sc);
      reports.push(r);
      log(
        `${sc.name} (${sc.what}): ${r.screens} screens, ${r.presses} presses, ${r.failures.length} failures, ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    });
    reports.sort(
      (a, b) => scenarios.findIndex((s) => s.name === a.scenario) - scenarios.findIndex((s) => s.name === b.scenario),
    );
    for (const r of reports) failures.push(...r.failures);
    if (opts.compare !== false) failures.push(...staleGoldens(reports, opts.goldens ?? GOLDENS, opts.update ?? false));
  } finally {
    await browser.close();
    await server.stop();
  }
  const sections = new Set(scenarios.map((s) => s.section));
  for (const section of sections)
    for (const p of walker.pagesOf(section)) {
      if (!walker.reached.has(p.id))
        failures.push({
          kind: "never-seen",
          scenario: "",
          page: p.file,
          path: "",
          message: `${p.title} was on screen in no ${section} scenario: add one that reaches it, or fix its marker`,
        });
      for (const c of p.controls)
        if (c.when && !walker.seen.has(`${p.id}:${c.line}`))
          failures.push({
            kind: "never-seen",
            scenario: "",
            page: p.file,
            path: "",
            message: `"${c.label}" (when ${c.when}) showed in no ${section} scenario: add one that shows it, or fix its selector`,
          });
    }
  return { reports, failures };
}

/**
 * Goldens no screen of their scenario matches now (a screen gone, or reached another way): removed with `--update`,
 * else each a failure, so the goldens stay the UI's screens and nothing more.
 */
function staleGoldens(reports: ScenarioReport[], dir: string, update: boolean): Failure[] {
  const out: Failure[] = [];
  for (const r of reports) {
    const goldens = join(dir, r.scenario);
    if (!existsSync(goldens)) continue;
    const shots = new Set(r.shots.map((p) => basename(p)));
    for (const f of readdirSync(goldens)) {
      if (!f.endsWith(".png") || f.endsWith(".new.png") || shots.has(f)) continue;
      if (update) rmSync(join(goldens, f));
      else
        out.push({
          kind: "screenshot",
          scenario: r.scenario,
          page: "",
          path: "",
          message: `${join(goldens, f)} matches no screen now: look at it, then run with --update to remove it`,
        });
    }
  }
  return out;
}

/** The scenarios a command line names: sections, scenario names, or every one. */
export function pick(names: string[]): Scenario[] {
  if (!names.length) return SCENARIOS;
  const out = SCENARIOS.filter((s) => names.includes(s.section) || names.includes(s.name));
  const unknown = names.filter((n) => !SCENARIOS.some((s) => s.section === n || s.name === n));
  if (unknown.length)
    throw new Error(
      `No section or scenario ${unknown.join(", ")}. Sections: ${[...new Set(SCENARIOS.map((s) => s.section))].join(", ")}; scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}`,
    );
  return out;
}

export type { Section };
