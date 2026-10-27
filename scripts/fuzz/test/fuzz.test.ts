import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasBrowser } from "../../harness/lib/browser.ts";
import { fuzz, pick } from "../run.ts";

const built = existsSync(join(import.meta.dirname, "..", "..", "..", "packages", "ui", "dist", "manifest.json"));

// The whole fuzz takes minutes and runs on its own (`npm run fuzz`). This walks the scenarios that are quick, so a
// change that breaks the fuzzer itself (the fake server, the panel's page, the walk) fails here.
describe.skipIf(!hasBrowser() || !built)("the UI fuzzer", () => {
  it("walks the quick scenarios against the map with nothing failing", async () => {
    const { reports, failures } = await fuzz(pick(["panel-offline", "review-answered", "onboard-finished"]), {
      compare: false,
      steps: 5,
    });
    expect(reports.map((r) => r.scenario)).toEqual(["panel-offline", "review-answered", "onboard-finished"]);
    expect(reports.every((r) => r.screens > 0)).toBe(true);
    // The rest of each section's pages and conditions show in the scenarios not walked here.
    expect(failures.filter((f) => f.kind !== "never-seen")).toEqual([]);
  }, 120_000);
});
