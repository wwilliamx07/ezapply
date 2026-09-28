import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// npm test builds first, so dist/quiet.js exists.
const CHILD = join(import.meta.dirname, "quiet-child.mjs");
let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("ezapply chat leaves the terminal to Claude", () => {
  it("sends console, stderr, jsdom and uncaught errors to the log, and keeps running", async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-quiet-"));
    const r = spawnSync(process.execPath, [CHILD], {
      encoding: "utf8",
      env: { ...process.env, CHILD_DIR: dir, EZAPPLY_APP_DIR: join(dir, "app") },
      timeout: 30_000,
    });
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "alive"))).toBe(true);

    const logged = await readFile(join(dir, "app", "logs", "companion.log"), "utf8");
    for (const text of [
      "console.log reached",
      "console.warn reached",
      "console.error reached",
      "stderr reached",
      "a bug in a timer",
      "a forgotten promise",
      "posting captured",
    ]) {
      expect(logged).toContain(text);
    }
  }, 40_000);
});
