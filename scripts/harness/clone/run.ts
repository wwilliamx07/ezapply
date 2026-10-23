import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CLONE_DESCRIPTIONS, type CloneDescription } from "@ezapply/sites/clones";
import type { BrowserContext, Page } from "playwright";
import { Adapter, challenged, launch, quietness, Recorder, siteFor } from "../lib/browser.ts";
import { openClone, pixelDifference } from "../lib/open.ts";
import { CLONES, type Clone, loadClone, newCloneDir, writeClone, writeMeta } from "../lib/store.ts";
import { StandIn } from "../standin/engine.ts";
import { checkPass } from "./check.ts";
import { type Coverage, explore } from "./explore.ts";
import { normalise, timingSummary } from "./normalise.ts";
import { proposalSource, propose } from "./propose.ts";

export interface CloneOptions {
  headed: boolean;
  log: (line: string) => void;
  /** The site's description; by default the site's `clone.ts`, if it has one. */
  desc?: CloneDescription;
  /** Where clones go (`.clones/` by default). */
  root?: string;
  /** Before the browser opens a page: the tests route the hand-written site here. */
  setup?: (context: BrowserContext) => Promise<void>;
  maxQueries?: number;
}

/** The share of differing pixels a clone's first screen may have against the live one. */
const MAX_PIXEL_DIFFERENCE = 0.01;

/**
 * Clones a posting's application: explores it live through the site's adapter, recording every request, then takes a
 * second, held-out path with different answers; keeps what `normalise` keeps; and checks the clone (`checkClone`).
 * Never submits: the adapter refuses Submit, and a request the description calls a submit is stopped.
 */
export async function cloneSite(url: string, o: CloneOptions): Promise<{ dir: string; usable: boolean }> {
  const site = siteFor(url);
  const desc = o.desc ?? CLONE_DESCRIPTIONS[site.id as keyof typeof CLONE_DESCRIPTIONS];
  const root = o.root ?? CLONES;
  const { dir } = newCloneDir(site.id, root);
  const context = await launch(join(root, ".profile"), o.headed);
  const submits: string[] = [];
  let coverage: Coverage | undefined;
  let heldOut: Coverage | undefined;
  let stopped: string | undefined;
  const recorder = new Recorder();
  const capturedAt = new Date().toISOString();
  let live: { png: Buffer; form: unknown } | undefined;
  try {
    await o.setup?.(context);
    for (const e of desc?.endpoints.filter((x) => x.kind === "submit") ?? []) {
      await context.route(e.url, (route) => {
        submits.push(route.request().url());
        return route.abort("blockedbyclient");
      });
    }
    recorder.attach(context);
    const quiet = quietness(context);
    const page = context.pages()[0] ?? (await context.newPage());
    const adapter = new Adapter(page, site);
    const open = async () => {
      recorder.action = "load";
      await page.goto(url, { waitUntil: "load" });
      await quiet();
      const challenge = await challenged(page);
      if (challenge)
        throw new Error(`A bot challenge is on screen (${challenge}): the harness doesn't work around one.`);
    };
    await open();
    live = { png: await screenshot(page), form: await adapter.call("getForm") };
    const common = {
      adapter,
      recorder,
      quiet,
      ...(desc ? { desc } : {}),
      log: o.log,
      waitForSignIn: () => signIn(page, adapter),
      ...(o.maxQueries ? { maxQueries: o.maxQueries } : {}),
    };
    o.log("exploring");
    coverage = await explore({ ...common, mode: "explore", set: "first" });
    o.log("taking the held-out path");
    recorder.pass = "held-out";
    await open();
    heldOut = await explore({ ...common, mode: "path", set: "second" });
  } catch (err) {
    stopped = (err as Error).message;
    o.log(`stopped: ${stopped}`);
  } finally {
    await recorder.settle();
    await context.close();
  }

  const { exchanges, bodies } = normalise(recorder.raw, desc);
  const report: Record<string, unknown> = {
    ...(stopped ? { stopped } : {}),
    submitsStopped: submits,
    coverage: coverage && summarise(coverage),
    heldOut: heldOut && { steps: heldOut.steps, notes: heldOut.notes },
    draftLeft:
      "On a site that saves steps, a draft application with placeholder values may now be in the account used.",
  };
  await writeClone(dir, { site: site.id, url, capturedAt, usable: false, report }, exchanges, bodies);
  if (live) {
    await writeFile(join(dir, "live.png"), live.png);
    await writeFile(join(dir, "live-form.json"), `${JSON.stringify(live.form, null, 2)}\n`);
  }
  const clone = await loadClone(dir);
  await writeFile(join(dir, "proposed-clone.ts"), proposalSource(site.id, propose(clone)));
  if (coverage) await writeFile(join(dir, "coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
  const usable = await checkClone(clone, desc ?? { endpoints: [] }, o.log, !stopped && !submits.length);
  return { dir, usable };
}

/**
 * The checks a clone must pass to be usable, run again whenever the site's description changes (`npm run clone --
 * --check`): it opens with no network, no request unanswered, looking as the live page did and reading as the same
 * form; and the stand-in answers every recorded request, and every one of the held-out path's, as the site did.
 */
export async function checkClone(
  clone: Clone,
  desc: CloneDescription,
  log: (l: string) => void,
  recorded = true,
): Promise<boolean> {
  const explorePass = checkPass(clone, desc, "explore");
  const held = checkPass(clone, desc, "held-out");
  const offline = await openClone(clone, desc, { latency: 0 });
  let opened: Record<string, unknown>;
  try {
    const png = await screenshot(offline.page);
    await writeFile(join(clone.dir, "offline.png"), png);
    const form = await new Adapter(offline.page, siteFor(clone.meta.url))
      .call("getForm")
      .catch((e: Error) => ({ error: e.message }));
    const liveForm = await readFile(join(clone.dir, "live-form.json"), "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
    const livePng = await readFile(join(clone.dir, "live.png")).catch(() => undefined);
    opened = {
      unanswered: offline.standIn.problems.map((p) => `${p.method} ${p.url}: ${p.detail}`),
      pixelDifference: livePng ? await pixelDifference(offline.page, livePng, png) : 1,
      sameForm: JSON.stringify(form) === JSON.stringify(liveForm),
    };
  } finally {
    await offline.close();
  }
  const usable =
    recorded &&
    !(opened.unanswered as string[]).length &&
    (opened.pixelDifference as number) <= MAX_PIXEL_DIFFERENCE &&
    !!opened.sameForm &&
    !explorePass.differences.length &&
    held.total > 0 &&
    !held.differences.length;
  const timings = timingSummary(new StandIn(clone, desc, { latency: 1 }).timings());
  clone.meta.usable = usable;
  clone.meta.report = { ...clone.meta.report, opened, equivalence: { explore: explorePass, heldOut: held }, timings };
  await writeMeta(clone.dir, clone.meta);
  log(`clone: ${clone.dir}`);
  log(
    `  opens offline: ${(opened.unanswered as string[]).length} unanswered, ${pct(opened.pixelDifference as number)} pixels differ, same form: ${opened.sameForm}`,
  );
  log(`  stand-in matches: ${explorePass.same}/${explorePass.total} recorded, ${held.same}/${held.total} held out`);
  log(`  usable: ${usable}`);
  return usable;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

const screenshot = (page: Page) => page.screenshot({ animations: "disabled", caret: "hide", fullPage: false });

function summarise(c: Coverage) {
  const touched = c.fields.filter((f) => f.touched).length;
  return {
    steps: c.steps,
    fieldsTouched: `${touched}/${c.fields.length}`,
    untouched: c.fields.filter((f) => !f.touched).map((f) => f.id),
    lists: c.lists.length,
    searches: c.searches.map(
      (s) =>
        `${s.id}: ${s.size} results from ${s.queries} queries, ${s.stable ? "stable" : "still growing"}, ${s.rule ?? "no rule"}`,
    ),
    sectionsOpened: c.sections.length,
    refusals: c.refusals.length,
    rows: c.rows,
    notes: c.notes,
  };
}

/** Waits (up to 15 minutes) for the user to sign in: until the page is no longer a sign-in page. */
async function signIn(page: Page, adapter: Adapter): Promise<void> {
  const end = Date.now() + 15 * 60_000;
  while (Date.now() < end) {
    await page.waitForTimeout(2000);
    const kind = await adapter.call<string>("pageKind").catch(() => "auth");
    if (kind !== "auth") return;
  }
  throw new Error("No sign-in within 15 minutes.");
}
