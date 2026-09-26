import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonConfig } from "@ezapply/companion";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initWorkspace } from "../src/workspace-init.js";

let root: string;
let config: DaemonConfig;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-init-"));
  config = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port: 17373,
    mcpToken: "t".repeat(32),
    pairingToken: "AAAA-BBBB-CCCC-DDDD",
    workspace: join(root, "ws"),
  };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Claude Code config", () => {
  it("runs ezapply over stdio, with no token in the workspace", async () => {
    await initWorkspace(config);
    const raw = await readFile(join(config.workspace, ".mcp.json"), "utf8");
    const server = JSON.parse(raw).mcpServers.ezapply;
    expect(server).toMatchObject({ type: "stdio", command: process.execPath });
    expect(server.args[1]).toBe("mcp");
    expect(server.args[0]).toMatch(/main\.js$/);
    expect(raw).not.toContain(config.mcpToken);
  });

  it("gives Claude runnable ezapply commands in EZAPPLY.md", async () => {
    await initWorkspace(config);
    const doc = await readFile(join(config.workspace, "EZAPPLY.md"), "utf8");
    expect(doc).not.toContain("{{EZAPPLY}}");
    expect(doc).toMatch(/node ".+main\.js" doctor/);
    expect(doc).toContain("extension_pair");
  });
});

describe("default cover letter template", () => {
  it("is installed into an empty workspace", async () => {
    await initWorkspace(config);
    const meta = JSON.parse(await readFile(join(config.workspace, "templates/cover/template.json"), "utf8"));
    expect(meta).toEqual({ schemaVersion: 1, main: "cover.tex", origin: "default" });
    const tex = await readFile(join(config.workspace, "templates/cover/cover.tex"), "utf8");
    expect(tex).toContain("% BODY START");
  });

  it("never overwrites a template the user has", async () => {
    const mine = join(config.workspace, "templates/cover/cover.tex");
    await writeFile(mine, "my letter");
    const report = await initWorkspace(config);
    expect(await readFile(mine, "utf8")).toBe("my letter");
    expect(report.kept).toContain(join(config.workspace, "templates", "cover"));
  });
});
