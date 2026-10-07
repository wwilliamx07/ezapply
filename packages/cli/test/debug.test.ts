import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "@ezapply/companion";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDebug, setDebug } from "../src/debug.js";
import { initWorkspace } from "../src/workspace-init.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-debug-cli-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = async (...args: string[]) => {
  let out = "";
  const code = await runDebug(root, args, (s) => {
    out += s;
  });
  return { code, out };
};

describe("ezapply debug", () => {
  it("turns debug mode on and off, keeping the rest of ezapply.config.json as written", async () => {
    await writeFile(
      join(root, "ezapply.config.json"),
      JSON.stringify({ schemaVersion: 1, documents: { attach: "immediately" } }),
    );
    expect((await run("on")).out).toMatch(/Debug mode on/);
    expect(JSON.parse(await readFile(join(root, "ezapply.config.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      documents: { attach: "immediately" },
      debug: { enabled: true },
    });
    await setDebug(root, false);
    expect(JSON.parse(await readFile(join(root, "ezapply.config.json"), "utf8")).debug).toEqual({ enabled: false });
  });

  it("reports the newest session, says when there is none, and cleans up", async () => {
    expect(await run("report")).toMatchObject({ code: 1, out: expect.stringMatching(/No debug sessions yet/) });
    await mkdir(join(root, "debug", "2026-10-01-p"), { recursive: true });
    await mkdir(join(root, "debug", "2026-10-02-q"), { recursive: true });
    expect((await run("report")).out).toMatch(/^Debug session 2026-10-02-q: 0 form calls/);
    expect((await run("report", "2026-10-01-p")).out).toMatch(/^Debug session 2026-10-01-p/);
    await run("clean");
    expect(await run("report")).toMatchObject({ code: 1 });
  });

  it("exports a saved page of the newest session as a fixture candidate, its profile strings replaced", async () => {
    expect(await run("export")).toMatchObject({ code: 2, out: expect.stringMatching(/debug export <session/) });
    const session = join(root, "debug", "2026-10-02-q");
    await mkdir(session, { recursive: true });
    await mkdir(join(root, "profile"), { recursive: true });
    await writeFile(join(root, "profile", "profile.yaml"), "identity: { firstName: Janelle }\n");
    await writeFile(join(session, "0002-before.html"), "<!doctype html><html><body><p>Hi Janelle</p></body></html>");
    const { code, out } = await run("export", "latest", "2");
    expect(code).toBe(0);
    expect(out).toMatch(/0002-before\.fixture\.html: 0 values blanked; replaced 1 profile strings/);
    expect(await readFile(join(session, "0002-before.fixture.html"), "utf8")).toMatch(/<p>Hi REDACTED<\/p>/);
  });

  it("denies the workspace agent reads of debug/", async () => {
    const config: AppConfig = {
      schemaVersion: 1,
      host: "127.0.0.1",
      port: 17373,
      mcpToken: "t".repeat(32),
      pairingToken: "AAAA-BBBB-CCCC-DDDD",
      workspace: join(root, "ws"),
    };
    await initWorkspace(config);
    const settings = JSON.parse(await readFile(join(config.workspace, ".claude", "settings.json"), "utf8"));
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Read(/debug/**)", "Read(./debug/**)"]));
  });
});
