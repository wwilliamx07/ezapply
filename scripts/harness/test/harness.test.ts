import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Coverage } from "../clone/explore.ts";
import { cloneSite } from "../clone/run.ts";
import { fillRun } from "../fill/run.ts";
import { hasBrowser } from "../lib/browser.ts";
import { loadClone } from "../lib/store.ts";
import { TEST_URL, testDescription, testServer } from "./site/server.ts";

/**
 * The whole harness on the hand-written site, in Playwright's Chromium: cloned through the generic adapter's built
 * bundle, checked, and filled from its clone. Skips where Chromium (`npx playwright install chromium`) or the built
 * extension isn't there, as in CI.
 */
const bundle = join(import.meta.dirname, "..", "..", "..", "packages", "extension", "dist", "generic-main.js");
const runnable = hasBrowser() && existsSync(bundle);

describe.skipIf(!runnable)("the harness on the test site", () => {
  let root: string;
  const server = testServer();
  const log = () => {};

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("clones it, and the clone opens offline and matches the site", { timeout: 180_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), "ezapply-clones-"));
    const { dir, usable } = await cloneSite(TEST_URL, {
      headed: false,
      log,
      desc: testDescription,
      root,
      setup: async (context) => {
        await context.route("**/*", async (route) => {
          const r = route.request();
          const res = server.handle({
            method: r.method(),
            url: r.url(),
            headers: r.headers(),
            ...(r.postDataBuffer() ? { body: r.postDataBuffer() as Buffer } : {}),
          });
          await route.fulfill(res);
        });
      },
    });
    const clone = await loadClone(dir);
    expect(clone.meta.report).toMatchObject({ opened: { unanswered: [], sameForm: true } });
    expect(usable).toBe(true);
    const coverage = JSON.parse(await readFile(join(dir, "coverage.json"), "utf8")) as Coverage;
    expect(coverage.fields.filter((f) => !f.touched).map((f) => f.id)).toEqual(["work-authorisation.resume"]);
    expect(coverage.sections.map((s) => s.answer)).toEqual(expect.arrayContaining(["Canada", "Yes"]));
    expect(server.submits).toEqual([]);
    expect(Object.keys(server.saved)).toEqual(expect.arrayContaining(["first", "country", "sponsor"]));
  });

  it("fills its clone to the hand-off with every value read back", { timeout: 120_000 }, async () => {
    const dir = join(root, "generic", (await loadCloneDirName(root)) ?? "");
    const report = await fillRun(dir, { latency: 0, log, desc: testDescription });
    expect(report).toMatchObject({ ok: true, failures: [], problems: [], blockedSubmits: [] });
    expect(report.steps).toHaveLength(1);
  });

  it("fails a fill run on a request the clone has no answer for, and names it", { timeout: 120_000 }, async () => {
    const dir = join(root, "generic", (await loadCloneDirName(root)) ?? "");
    const broken = join(root, "broken");
    await cp(dir, broken, { recursive: true });
    const file = join(broken, "exchanges.json");
    const kept = (JSON.parse(await readFile(file, "utf8")) as { url: string }[]).filter(
      (e) => !e.url.includes("country=CA"),
    );
    await writeFile(file, JSON.stringify(kept));
    const report = await fillRun(broken, { latency: 0, log, desc: testDescription });
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([expect.stringContaining("/api/regions?country=CA")]);
  });
});

async function loadCloneDirName(root: string): Promise<string | undefined> {
  return (await readdir(join(root, "generic"))).sort().at(-1);
}
