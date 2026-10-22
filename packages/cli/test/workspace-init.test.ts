import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppConfig, agentFileStatus } from "@ezapply/companion";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initWorkspace, writeLauncher } from "../src/workspace-init.js";

let root: string;
let config: AppConfig;

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

describe("Antigravity config", () => {
  it("includes EZAPPLY.md from AGENTS.md, copies the skills, adds the MCP server, and allows ezapply's tools", async () => {
    const home = join(root, "agy-home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "settings.json"), JSON.stringify({ permissions: { allow: ["command(git)"] } }));
    await initWorkspace(config, { antigravityHome: home });

    const agents = await readFile(join(config.workspace, "AGENTS.md"), "utf8");
    expect(agents.startsWith("@[EZAPPLY.md](EZAPPLY.md)\n@[preferences](profile/preferences.md)")).toBe(true);
    const server = JSON.parse(await readFile(join(config.workspace, ".agents", "mcp_config.json"), "utf8")).mcpServers
      .ezapply;
    expect(server).toMatchObject({ command: process.execPath, args: [expect.stringMatching(/main\.js$/), "mcp"] });
    expect(await readdir(join(config.workspace, ".agents", "skills"))).toContain("ezapply-apply");
    const settings = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
    // Headless agy denied every write in the workspace without a rule for it; repo clones stay read-only.
    expect(settings.permissions.allow).toEqual(["command(git)", "mcp(ezapply/*)", `write_file(${config.workspace})`]);
    expect(settings.permissions.deny).toEqual([`write_file(${join(config.workspace, "repo-cache")})`]);

    // An AGENTS.md of the user's own gets the include on top.
    await writeFile(join(config.workspace, "AGENTS.md"), "My rules\n");
    await initWorkspace(config);
    const mine = await readFile(join(config.workspace, "AGENTS.md"), "utf8");
    expect(mine).toBe("@[EZAPPLY.md](EZAPPLY.md)\n@[preferences](profile/preferences.md)\n\nMy rules\n");
  });
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

  it("turns Claude Code's auto memory off, unless the user set it, and keeps their other settings", async () => {
    await initWorkspace(config);
    const path = join(config.workspace, ".claude", "settings.json");
    const read = async () => JSON.parse(await readFile(path, "utf8"));
    expect(await read()).toMatchObject({ autoMemoryEnabled: false, enabledMcpjsonServers: ["ezapply"] });
    expect((await read()).permissions.deny).toEqual(expect.arrayContaining(["Bash(python:*)", "Edit(/repo-cache/**)"]));

    await writeFile(path, JSON.stringify({ ...(await read()), autoMemoryEnabled: true, model: "opus" }));
    await initWorkspace(config);
    expect(await read()).toMatchObject({ autoMemoryEnabled: true, model: "opus" });

    await writeFile(path, JSON.stringify({ model: "opus" }));
    await initWorkspace(config);
    expect(await read()).toMatchObject({ autoMemoryEnabled: false, model: "opus" });
  });

  it("writes a launcher so `ezapply` runs from the workspace", async () => {
    const report = await initWorkspace(config);
    const launcher = join(config.workspace, process.platform === "win32" ? "ezapply.cmd" : "ezapply");
    expect(report.created.concat(report.updated)).toContain(launcher);
    const node = process.execPath.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    const empty = () => ({ created: [], updated: [], kept: [] });
    await mkdir(join(root, "launchers"), { recursive: true });
    const posix = await writeLauncher(join(root, "launchers"), empty(), "linux");
    expect(await readFile(posix, "utf8")).toMatch(new RegExp(`^#!/bin/sh\\nexec "${node}" ".+main\\.js" "\\$@"\\n$`));
    const windows = await writeLauncher(join(root, "launchers"), empty(), "win32");
    expect(windows).toMatch(/ezapply\.cmd$/);
    expect(await readFile(windows, "utf8")).toMatch(new RegExp(`^@echo off\\r\\n"${node}" ".+main\\.js" %\\*\\r\\n$`));
  });

  it("gives Claude runnable ezapply commands in EZAPPLY.md", async () => {
    await initWorkspace(config);
    const doc = await readFile(join(config.workspace, "EZAPPLY.md"), "utf8");
    expect(doc).not.toContain("{{EZAPPLY}}");
    // A hint's `ezapply <command>`, as Claude can run it.
    expect(doc).toMatch(/`node ".+main\.js" <command>`/);
    // No background daemon: nothing to start, stop or restart.
    expect(doc).not.toMatch(/main\.js" (start|stop|restart)|`(start|stop|restart)`/);
    expect(doc).toMatch(/first request about a posting, right after `posting_get`,\s+call `claims_list`/);
    expect(doc).toContain("## Untrusted content and prompt injection");
    expect(doc).toContain("## Application requirements");
  });

  it("makes CLAUDE.md import EZAPPLY.md, and the agent file check notices when it doesn't", async () => {
    await initWorkspace(config);
    expect(await agentFileStatus(config.workspace)).toMatchObject({ done: true });

    const claudeMd = join(config.workspace, "CLAUDE.md");
    const withImport = await readFile(claudeMd, "utf8");
    await writeFile(claudeMd, withImport.replace("@EZAPPLY.md", "See `@EZAPPLY.md`"));
    expect(await agentFileStatus(config.workspace)).toMatchObject({
      done: false,
      detail: expect.stringMatching(/import/),
    });

    await writeFile(claudeMd, "# My notes\n");
    await initWorkspace(config);
    expect(await readFile(claudeMd, "utf8")).toMatch(/^@EZAPPLY\.md\n/);
    expect(await agentFileStatus(config.workspace)).toMatchObject({ done: true });
  });
});

describe("skills", () => {
  const skills = () => join(config.workspace, ".claude", "skills");

  it("are installed under ezapply- names that can't shadow Claude Code commands", async () => {
    await initWorkspace(config);
    const names = await readdir(skills());
    expect(names).toEqual(expect.arrayContaining(["ezapply-resume", "ezapply-apply"]));
    expect(names).not.toContain("ezapply-onboard");
    for (const n of names.filter((n) => n.startsWith("ezapply-"))) {
      const md = await readFile(join(skills(), n, "SKILL.md"), "utf8");
      // The frontmatter is `name` and a one-line `description`, closed by `---` on its own line. A reflow once
      // wrapped the description and joined the closing `---` to it, which is no frontmatter at all.
      expect(md).toMatch(new RegExp(`^---\\nname: ${n}\\ndescription: [^\\n]{40,}\\n---\\n`));
    }
  });

  it("removes ezapply's old bare-named skills but keeps the user's own", async () => {
    await mkdir(join(skills(), "resume"), { recursive: true });
    await writeFile(join(skills(), "resume", "SKILL.md"), "---\nname: resume\n---\n1. `posting_active`\n");
    await mkdir(join(skills(), "apply"), { recursive: true });
    await writeFile(join(skills(), "apply", "SKILL.md"), "---\nname: apply\n---\nMy own apply notes.\n");

    const report = await initWorkspace(config);
    await expect(stat(join(skills(), "resume"))).rejects.toThrow();
    expect(await readFile(join(skills(), "apply", "SKILL.md"), "utf8")).toContain("My own apply notes.");
    expect(report.updated.some((u) => u.includes("renamed to ezapply-resume"))).toBe(true);
  });

  it("removes a retired skill an earlier init copied, for both agents, but keeps a user's skill of that name", async () => {
    const agents = join(config.workspace, ".agents", "skills");
    for (const dir of [skills(), agents]) {
      await mkdir(join(dir, "ezapply-repos"), { recursive: true });
      await writeFile(join(dir, "ezapply-repos", "SKILL.md"), "---\nname: ezapply-repos\n---\n`github_list_repos`\n");
    }
    const report = await initWorkspace(config);
    await expect(stat(join(skills(), "ezapply-repos"))).rejects.toThrow();
    await expect(stat(join(agents, "ezapply-repos"))).rejects.toThrow();
    expect(report.updated.some((u) => u.includes("the setup page chooses repos"))).toBe(true);

    await mkdir(join(skills(), "ezapply-repos"), { recursive: true });
    await writeFile(join(skills(), "ezapply-repos", "SKILL.md"), "---\nname: ezapply-repos\n---\nMine.\n");
    await initWorkspace(config);
    expect(await readFile(join(skills(), "ezapply-repos", "SKILL.md"), "utf8")).toContain("Mine.");
  });
});

describe("the agent settings an older build kept", () => {
  it("are removed, since the extension keeps them now; the conversations stay", async () => {
    const agent = join(config.workspace, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({ schemaVersion: 1, effort: "high" }));
    await writeFile(join(agent, "conversations.json"), "{}");
    const report = await initWorkspace(config);
    await expect(stat(join(agent, "settings.json"))).rejects.toThrow();
    expect(await readFile(join(agent, "conversations.json"), "utf8")).toBe("{}");
    expect(report.updated.some((u) => u.includes("the extension keeps the agent settings"))).toBe(true);
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

describe("autofill-timing.yaml", () => {
  it("is written once, with every wait commented out at its default, and the user's edits are kept", async () => {
    await initWorkspace(config);
    const path = join(config.workspace, "autofill-timing.yaml");
    const text = await readFile(path, "utf8");
    expect(text).toContain("scale: 1");
    expect(text).toMatch(/^# dropdownOpenMs: 200 +# dropdown: wait for its list to appear/m);
    await writeFile(path, "scale: 0.5\n");
    const report = await initWorkspace(config);
    expect(report.kept).toContain(path);
    expect(await readFile(path, "utf8")).toBe("scale: 0.5\n");
  });
});

describe("ezapply.config.json", () => {
  it("carries debug mode's old switch (debug.autofill) over to debug.enabled, keeping the rest", async () => {
    await initWorkspace(config);
    const path = join(config.workspace, "ezapply.config.json");
    const cur = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...cur, debug: { autofill: true, markup: "always" } }));
    const report = await initWorkspace(config);
    expect(report.updated).toContain(`${path} (debug.autofill → debug.enabled (on))`);
    expect(JSON.parse(await readFile(path, "utf8")).debug).toEqual({ enabled: true, markup: "always" });
    // Once moved, nothing more to do; a debug.enabled already set wins over a stale old switch.
    expect((await initWorkspace(config)).updated).not.toContain(expect.stringContaining("debug.autofill"));
    await writeFile(path, JSON.stringify({ ...cur, debug: { autofill: true, enabled: false } }));
    await initWorkspace(config);
    expect(JSON.parse(await readFile(path, "utf8")).debug).toEqual({ enabled: false });
  });

  it("removes forms.focusBrowser, which focus emulation replaced", async () => {
    await initWorkspace(config);
    const path = join(config.workspace, "ezapply.config.json");
    const cur = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...cur, forms: { focusBrowser: "off" } }));
    const report = await initWorkspace(config);
    expect(report.updated).toContain(`${path} (forms.focusBrowser removed (focus emulation replaced it))`);
    expect(JSON.parse(await readFile(path, "utf8"))).not.toHaveProperty("forms");
  });

  it("removes context.restartOnCapture, which only `ezapply chat` read", async () => {
    await initWorkspace(config);
    const path = join(config.workspace, "ezapply.config.json");
    const cur = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...cur, context: { restartOnCapture: false } }));
    const report = await initWorkspace(config);
    expect(report.updated).toContain(`${path} (context.restartOnCapture removed (\`ezapply chat\` is gone))`);
    expect(JSON.parse(await readFile(path, "utf8"))).not.toHaveProperty("context");
  });
});
