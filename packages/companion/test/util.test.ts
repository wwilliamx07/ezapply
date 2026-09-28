import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateDaemonConfig } from "../src/config/daemon.js";
import { rotateLog } from "../src/logger.js";
import { KeyedQueue } from "../src/util/keyed-queue.js";
import { assertLocalUrl } from "../src/util/open.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-util-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("KeyedQueue", () => {
  it("runs one task at a time per key, in order, and keys independently", async () => {
    const q = new KeyedQueue();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([
      q.run("a", task("a1", 30)),
      q.run("a", task("a2", 1)),
      q.run("b", task("b1", 1)),
    ]);
    expect(results).toEqual(["a1", "a2", "b1"]);
    expect(events.indexOf("a2:start")).toBeGreaterThan(events.indexOf("a1:end"));
    expect(events.indexOf("b1:start")).toBeLessThan(events.indexOf("a1:end"));
  });

  it("keeps going after a task fails", async () => {
    const q = new KeyedQueue();
    await expect(q.run("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await q.run("k", async () => "next")).toBe("next");
  });
});

describe("rotateLog", () => {
  it("keeps three files once the log passes the limit, dropping the oldest", async () => {
    const dir = join(root, "logs");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir);
    const log = join(dir, "companion.log");
    await writeFile(log, "small");
    expect(rotateLog(log, 10, 3)).toBe(false);

    for (const gen of ["one", "two", "three"]) {
      await writeFile(log, `${gen} ${"x".repeat(20)}`);
      expect(rotateLog(log, 10, 3)).toBe(true);
    }
    expect((await readdir(dir)).sort()).toEqual(["companion.log.1", "companion.log.2"]);
    expect(await readFile(`${log}.1`, "utf8")).toMatch(/^three/);
    expect(await readFile(`${log}.2`, "utf8")).toMatch(/^two/);
  });
});

describe("assertLocalUrl", () => {
  it("lets only the daemon's own loopback pages through to the OS opener", () => {
    expect(() => assertLocalUrl("http://127.0.0.1:17373/github/start?nonce=x")).not.toThrow();
    for (const bad of [
      "https://127.0.0.1:17373/x",
      "http://localhost:17373/x",
      "http://127.0.0.1/x",
      "http://evil.example/x",
      "file:///etc/passwd",
      "http://user:pw@127.0.0.1:1/x",
      "C:\\Windows\\notepad.exe",
    ]) {
      expect(() => assertLocalUrl(bad), bad).toThrow(/only http:\/\/127\.0\.0\.1/);
    }
  });
});

describe("updateDaemonConfig", () => {
  it("changes only what it's asked to, on the file as it is now", async () => {
    const path = join(root, "daemon.json");
    const base = {
      schemaVersion: 1 as const,
      host: "127.0.0.1" as const,
      port: 17373,
      mcpToken: "t".repeat(43),
      pairingToken: "ABCD-EFGH-JKLM-NPQR",
      workspace: join(root, "ws"),
    };
    await writeFile(path, JSON.stringify({ ...base, port: 18000 }));
    const next = await updateDaemonConfig((c) => ({ ...c, pairedExtensionId: "a".repeat(32) }), base, path);
    expect(next).toMatchObject({ port: 18000, pairedExtensionId: "a".repeat(32) });
    expect(JSON.parse(await readFile(path, "utf8")).port).toBe(18000);
  });
});
