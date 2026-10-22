import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppConfig,
  defaultWorkspaceConfig,
  exists,
  TIMING_FILE,
  timingFileTemplate,
  WORKSPACE_DIRS,
  writeFileAtomic,
  writeJsonAtomic,
} from "@ezapply/companion";

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates");
const CLI_MAIN = resolve(dirname(fileURLToPath(import.meta.url)), "main.js");

export interface InitReport {
  created: string[];
  updated: string[];
  kept: string[];
}

interface InitOptions {
  /**
   * The Antigravity CLI's settings folder (`~/.gemini/antigravity-cli`). When it exists, ezapply's tools are allowed
   * there; tests leave it out so they never touch the real one.
   */
  antigravityHome?: string;
}

/**
 * Create or refresh a workspace. Idempotent: user-owned files are never overwritten; ezapply-managed
 * files (.mcp.json server entry, permission rules, skills) are updated in place.
 */
export async function initWorkspace(config: AppConfig, opts: InitOptions = {}): Promise<InitReport> {
  const root = config.workspace;
  const report: InitReport = { created: [], updated: [], kept: [] };

  for (const dir of WORKSPACE_DIRS) await mkdir(join(root, dir), { recursive: true });

  await writeIfMissing(
    join(root, "ezapply.config.json"),
    `${JSON.stringify(defaultWorkspaceConfig(), null, 2)}\n`,
    report,
  );
  await migrateWorkspaceConfig(join(root, "ezapply.config.json"), report);
  // The user's to tune; every setting starts commented out, so defaults changed in a later build still apply.
  await writeIfMissing(join(root, TIMING_FILE), timingFileTemplate(), report);

  // EZAPPLY.md is ours and always refreshed; CLAUDE.md belongs to the user and only imports it.
  const agentDoc = await readFile(join(TEMPLATES, "workspace", "EZAPPLY.md"), "utf8");
  await writeFileAtomic(join(root, "EZAPPLY.md"), agentDoc.replaceAll("{{EZAPPLY}}", `node "${CLI_MAIN}"`));
  report.updated.push(join(root, "EZAPPLY.md"));
  await ensureClaudeMd(join(root, "CLAUDE.md"), report);
  await installDefaultCoverTemplate(join(root, "templates", "cover"), report);

  await mergeJson(join(root, ".mcp.json"), report, (cur) => ({
    ...cur,
    mcpServers: {
      ...(cur.mcpServers as object | undefined),
      // `ezapply mcp` relays to the companion inside `ezapply`; while it isn't running every tool says so.
      ezapply: { type: "stdio", command: process.execPath, args: [CLI_MAIN, "mcp"] },
    },
  }));

  await mergeJson(join(root, ".claude", "settings.json"), report, (cur) => {
    const perms = (cur.permissions as { allow?: string[]; deny?: string[] } | undefined) ?? {};
    return {
      // Claude Code's auto memory loads a memory index and instructions into every session, and has Claude
      // spend turns writing notes that duplicate the profile, answers and preferences (and can go stale
      // against them). Off by default; a value the user set is kept.
      autoMemoryEnabled: false,
      ...cur,
      enabledMcpjsonServers: union(cur.enabledMcpjsonServers as string[] | undefined, ["ezapply"]),
      permissions: {
        ...perms,
        allow: union(perms.allow, ["mcp__ezapply"]),
        deny: union(perms.deny, [...REPO_CACHE_DENY, ...DEBUG_READ_DENY, ...SCRIPT_EDIT_DENY]),
      },
    };
  });

  const skillsSrc = join(TEMPLATES, "skills");
  if (await exists(skillsSrc)) {
    await cp(skillsSrc, join(root, ".claude", "skills"), { recursive: true, force: true });
    report.updated.push(".claude/skills/");
  }
  await removeLegacySkills(join(root, ".claude", "skills"), report);
  // The panel's agent settings were kept here before the extension kept them; nothing reads this any more.
  const oldSettings = join(root, "agent", "settings.json");
  if (await exists(oldSettings)) {
    await rm(oldSettings, { force: true });
    report.updated.push(`${oldSettings} (removed: the extension keeps the agent settings)`);
  }
  await initAntigravity(root, skillsSrc, report, opts.antigravityHome);
  await writeLauncher(root, report);
  return report;
}

/**
 * What the Antigravity CLI reads in the workspace, beside Claude Code's: `AGENTS.md` (the user's, including
 * `EZAPPLY.md` and the preferences, as `CLAUDE.md` imports them), the skills in `.agents/skills/`, and ezapply's
 * server in `.agents/mcp_config.json`. Its permissions live only in the user's own settings, where headless runs deny
 * every MCP tool and file write not allowed: so, when that CLI is installed, ezapply's tools and writes inside the
 * workspace are allowed there, and writes into `repo-cache/` denied.
 */
async function initAntigravity(root: string, skillsSrc: string, report: InitReport, home?: string): Promise<void> {
  await ensureImport(join(root, "AGENTS.md"), AGENTS_IMPORT, report);
  if (await exists(skillsSrc)) {
    await cp(skillsSrc, join(root, ".agents", "skills"), { recursive: true, force: true });
    report.updated.push(".agents/skills/");
  }
  await removeRetiredSkills(join(root, ".agents", "skills"), report);
  await mergeJson(join(root, ".agents", "mcp_config.json"), report, (cur) => ({
    ...cur,
    mcpServers: {
      ...(cur.mcpServers as object | undefined),
      ezapply: { command: process.execPath, args: [CLI_MAIN, "mcp"] },
    },
  }));
  if (!home || !(await exists(home))) return;
  const settings = join(home, "settings.json");
  try {
    await mergeJson(settings, report, (cur) => {
      const perms = (cur.permissions as { allow?: string[]; deny?: string[] } | undefined) ?? {};
      return {
        ...cur,
        permissions: {
          ...perms,
          allow: union(perms.allow, antigravityAllow(root)),
          deny: union(perms.deny, antigravityDeny(root)),
        },
      };
    });
  } catch {
    report.kept.push(
      `${settings} (not plain JSON: add ${antigravityAllow(root).join(", ")} to permissions.allow and ` +
        `${antigravityDeny(root).join(", ")} to permissions.deny yourself)`,
    );
  }
}

/**
 * In the Antigravity CLI's rule syntax: ezapply's tools, and file writes under the workspace (a folder's rule covers
 * everything in it). Without the write rule headless `agy` denied the agent's first edit in the workspace.
 */
function antigravityAllow(root: string): string[] {
  return ["mcp(ezapply/*)", `write_file(${resolve(root)})`];
}

/** Repo clones are strictly read-only; a deny wins over the workspace's allow. */
function antigravityDeny(root: string): string[] {
  return [`write_file(${join(resolve(root), "repo-cache")})`];
}

/**
 * `ezapply` in the workspace, so ezapply runs from there without putting the CLI
 * on PATH: a global `npm link` needs write access to npm's global folder, which many installs don't give.
 * Absolute paths to this Node and this build, like `.mcp.json`; rewritten by every init.
 */
export async function writeLauncher(root: string, report: InitReport, platform = process.platform): Promise<string> {
  const path = join(root, platform === "win32" ? "ezapply.cmd" : "ezapply");
  const body =
    platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${CLI_MAIN}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${CLI_MAIN}" "$@"\n`;
  const existed = await exists(path);
  await writeFile(path, body, { encoding: "utf8", mode: 0o755 });
  (existed ? report.updated : report.created).push(path);
  return path;
}

/**
 * ezapply's skills before 0.2 had bare names that clashed with Claude Code: a project `resume` skill replaces
 * the built-in /resume, and a personal skill of the same name overrides a project one. They're now
 * `ezapply-<name>`. Remove an old folder only when its SKILL.md uses ezapply's tools, so a skill of the
 * user's own that happens to share a name is kept.
 */
const LEGACY_SKILLS = ["onboard", "repos", "index-repo", "resume", "cover-letter", "bundle", "apply", "answers"];
/**
 * Skills ezapply no longer ships: the copy step only adds and overwrites, so an earlier init's copy would stay and
 * keep running. Choosing repos is the setup page's step.
 */
const RETIRED_SKILLS: Record<string, string> = { "ezapply-repos": "the setup page chooses repos" };
const EZAPPLY_TOOL =
  /\b(workspace_check|posting_active|posting_update_meta|tex_compile|pdf_merge|get_form|fill_fields|repo_sync|github_list_repos|repos_selection_set|answers_check|claims_check)\b/;

async function removeLegacySkills(skillsDir: string, report: InitReport): Promise<void> {
  for (const name of LEGACY_SKILLS) {
    await removeIfOurs(join(skillsDir, name), `renamed to ezapply-${name}`, report);
  }
  await removeRetiredSkills(skillsDir, report);
}

async function removeRetiredSkills(skillsDir: string, report: InitReport): Promise<void> {
  for (const [name, why] of Object.entries(RETIRED_SKILLS)) await removeIfOurs(join(skillsDir, name), why, report);
}

/** Remove a skill folder only when its SKILL.md uses ezapply's tools, so a skill of the user's own is kept. */
async function removeIfOurs(dir: string, why: string, report: InitReport): Promise<void> {
  const text = await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null);
  if (text === null) return;
  if (EZAPPLY_TOOL.test(text)) {
    await rm(dir, { recursive: true, force: true });
    report.updated.push(`${dir} (removed: ${why})`);
  } else {
    report.kept.push(`${dir} (not ezapply's)`);
  }
}

/** Repo clones are strictly read-only: deny every write path Claude Code has into them. */
const REPO_CACHE_DENY = [
  "Edit(/repo-cache/**)",
  "Write(/repo-cache/**)",
  "NotebookEdit(/repo-cache/**)",
  "Edit(./repo-cache/**)",
  "Write(./repo-cache/**)",
  "NotebookEdit(./repo-cache/**)",
];

/**
 * debug/ (debug mode) holds the user's filled values and the pages, for working on ezapply, not for the
 * applying agent: reading it would only cost context.
 */
const DEBUG_READ_DENY = ["Read(/debug/**)", "Read(./debug/**)"];

/**
 * Nothing in the workspace needs Python, and the agent reached for it to edit `.tex` files despite `EZAPPLY.md`
 * telling it to use the Edit tool: a script's string escapes turn LaTeX's backslashes into tabs and newlines, and
 * where Python is missing the edit fails and costs a retry. Denied, the agent goes straight to Edit.
 */
const SCRIPT_EDIT_DENY = ["Bash(python:*)", "Bash(python3:*)", "Bash(py:*)"].flatMap((r) => [
  r,
  // The panel's shell is PowerShell on Windows without Git Bash (`panelShell`).
  r.replace("Bash", "PowerShell"),
]);

const IMPORT_LINE = "@EZAPPLY.md";
/** Antigravity's inline include (its bare `@path` only names a file); `EZAPPLY.md`'s own `@` import is Claude Code's. */
const AGENTS_IMPORT = "@[EZAPPLY.md](EZAPPLY.md)\n@[preferences](profile/preferences.md)";

async function ensureClaudeMd(path: string, report: InitReport): Promise<void> {
  if (await ensureImport(path, IMPORT_LINE, report)) return;
  const current = await readFile(path, "utf8");
  if (current.startsWith("# ezapply workspace")) {
    // Written by ezapply 0.1 before the managed/user split: keep a backup, replace with the stub.
    await writeFileAtomic(`${path}.bak`, current);
    await writeFileAtomic(path, await readFile(join(TEMPLATES, "workspace", "CLAUDE.md"), "utf8"));
    report.updated.push(`${path} (previous version saved as CLAUDE.md.bak)`);
    return;
  }
  await writeFileAtomic(path, `${IMPORT_LINE}\n\n${current}`);
  report.updated.push(`${path} (added ${IMPORT_LINE} import)`);
}

/**
 * The user's agent file (`CLAUDE.md`, `AGENTS.md`) with ezapply's import: its stub when there's none (true), kept
 * when it has the import (true), else false for the caller to add it. `AGENTS.md` gets its import added here.
 */
async function ensureImport(path: string, line: string, report: InitReport): Promise<boolean> {
  const name = path.split(/[\\/]/).pop() as string;
  if (!(await exists(path))) {
    await writeFileAtomic(path, await readFile(join(TEMPLATES, "workspace", name), "utf8"));
    report.created.push(path);
    return true;
  }
  const current = await readFile(path, "utf8");
  if (current.includes(line.split("\n")[0] as string)) {
    report.kept.push(path);
    return true;
  }
  if (name !== "AGENTS.md") return false;
  await writeFileAtomic(path, `${line}\n\n${current}`);
  report.updated.push(`${path} (added the EZAPPLY.md include)`);
  return true;
}

/** A plain cover letter template so letters work out of the box. Never touches one the user already has. */
async function installDefaultCoverTemplate(dest: string, report: InitReport): Promise<void> {
  const existing = (await readdir(dest).catch(() => [] as string[])).filter((f) => !f.startsWith("."));
  if (existing.length > 0) {
    report.kept.push(dest);
    return;
  }
  await cp(join(TEMPLATES, "cover"), dest, { recursive: true });
  report.created.push(`${dest} (default cover letter template)`);
}

/** Upgrade untouched defaults written by older versions. Anything the user changed is left alone. */
async function migrateWorkspaceConfig(path: string, report: InitReport): Promise<void> {
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    tex?: Record<string, unknown>;
    debug?: Record<string, unknown>;
    forms?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };
  const changes: string[] = [];
  const tex = raw.tex;
  // 0.1 defaulted to latexmk, which fails on MiKTeX without Perl; "auto" falls back to xelatex.
  if (tex && tex.engine === "latexmk" && tex.timeoutSeconds === undefined) {
    tex.engine = "auto";
    changes.push("tex.engine: latexmk → auto");
  }
  // Debug mode's switch was debug.autofill until it became debug.enabled. The config schema drops keys it
  // doesn't know, so an old switch left in place turns debug mode off without a word.
  const debug = raw.debug;
  if (debug && "autofill" in debug) {
    if (debug.enabled === undefined && typeof debug.autofill === "boolean") debug.enabled = debug.autofill;
    delete debug.autofill;
    changes.push(`debug.autofill → debug.enabled (${debug.enabled === true ? "on" : "off"})`);
  }
  // forms.focusBrowser brought the browser window to the front before a call; focus emulation replaced it.
  if (raw.forms && Object.keys(raw.forms).every((k) => k === "focusBrowser")) {
    delete raw.forms;
    changes.push("forms.focusBrowser removed (focus emulation replaced it)");
  }
  // context.restartOnCapture restarted the terminal's Claude on a new posting under `ezapply chat`, which is gone.
  if (raw.context && Object.keys(raw.context).every((k) => k === "restartOnCapture")) {
    delete raw.context;
    changes.push("context.restartOnCapture removed (`ezapply chat` is gone)");
  }
  if (changes.length === 0) return;
  await writeJsonAtomic(path, raw);
  report.updated.push(`${path} (${changes.join("; ")})`);
}

function union(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])];
}

async function writeIfMissing(path: string, content: string, report: InitReport): Promise<void> {
  if (await exists(path)) {
    report.kept.push(path);
    return;
  }
  await writeFileAtomic(path, content);
  report.created.push(path);
}

async function mergeJson(
  path: string,
  report: InitReport,
  fn: (cur: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const existed = await exists(path);
  const cur = existed ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>) : {};
  await writeJsonAtomic(path, fn(cur));
  (existed ? report.updated : report.created).push(path);
}
