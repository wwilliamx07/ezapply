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

  it("explains a damaged config.json and what to do", async () => {
    await writeFile(join(appDir, "config.json"), "{ not json");
    const r = ezapply("debug", "report");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/config\.json is invalid: not valid JSON/);
    expect(r.stderr).toMatch(/run `ezapply init`/);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

describe("commands", () => {
  it("has no daemon commands, no chat and no status (doctor says whether ezapply runs)", () => {
    for (const command of ["start", "stop", "restart", "daemon", "pair", "chat", "status"]) {
      const r = ezapply(command);
      expect(r.status, command).toBe(2);
      expect(r.stderr).toMatch(/Unknown command/);
    }
  });
});
