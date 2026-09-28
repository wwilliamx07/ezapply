import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// npm test builds first, so the CLI exists.
const CLI = join(import.meta.dirname, "..", "dist", "main.js");
let appDir: string;

beforeEach(async () => {
  appDir = await mkdtemp(join(tmpdir(), "ezapply-cli-"));
});

afterEach(async () => {
  await rm(appDir, { recursive: true, force: true });
});

const ezapply = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, EZAPPLY_APP_DIR: appDir },
    timeout: 20_000,
  });

describe("ezapply command errors", () => {
  it("rejects a bad --port with one line instead of a stack trace", () => {
    const r = ezapply("init", "--port", "abc", "--workspace", join(appDir, "ws"));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe('ezapply: --port must be a whole number from 1 to 65535, not "abc".');
  });

  it("explains a damaged daemon.json and what to do", async () => {
    await writeFile(join(appDir, "daemon.json"), "{ not json");
    const r = ezapply("status");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/daemon\.json is invalid: not valid JSON/);
    expect(r.stderr).toMatch(/run `ezapply init`/);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});
