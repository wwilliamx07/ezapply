import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppConfig, defaultWorkspaceConfig, exists, WORKSPACE_DIRS } from "@ezapply/companion";

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates");
const CLI_MAIN = resolve(dirname(fileURLToPath(import.meta.url)), "main.js");

export interface InitReport {
  created: string[];
  updated: string[];
  kept: string[];
}

/**
 * Create or refresh a workspace. Idempotent: user-owned files are never overwritten; ezapply-managed
 * files (.mcp.json server entry, permission rules, skills) are updated in place.
 */
export async function initWorkspace(config: AppConfig): Promise<InitReport> {
  const root = config.workspace;
  const report: InitReport = { created: [], updated: [], kept: [] };

  for (const dir of WORKSPACE_DIRS) await mkdir(join(root, dir), { recursive: true });

  await writeIfMissing(
    join(root, "ezapply.config.json"),
    `${JSON.stringify(defaultWorkspaceConfig(), null, 2)}\n`,
    report,
  );
  await migrateWorkspaceConfig(join(root, "ezapply.config.json"), report);

  // EZAPPLY.md is ours and always refreshed; CLAUDE.md belongs to the user and only imports it.
  const agentDoc = await readFile(join(TEMPLATES, "workspace", "EZAPPLY.md"), "utf8");
  await writeFile(join(root, "EZAPPLY.md"), agentDoc.replaceAll("{{EZAPPLY}}", `node "${CLI_MAIN}"`), "utf8");
  report.updated.push(join(root, "EZAPPLY.md"));
  await ensureClaudeMd(join(root, "CLAUDE.md"), report);
  await installDefaultCoverTemplate(join(root, "templates", "cover"), report);

  await mergeJson(join(root, ".mcp.json"), report, (cur) => ({
    ...cur,
    mcpServers: {
      ...(cur.mcpServers as object | undefined),
      // `ezapply mcp` relays to the companion inside `ezapply chat`; outside a chat every tool says so.
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
        deny: union(perms.deny, REPO_CACHE_DENY),
      },
    };
  });

  const skillsSrc = join(TEMPLATES, "skills");
  if (await exists(skillsSrc)) {
    await cp(skillsSrc, join(root, ".claude", "skills"), { recursive: true, force: true });
    report.updated.push(".claude/skills/");
  }
  await removeLegacySkills(join(root, ".claude", "skills"), report);
  await writeLauncher(root, report);
  return report;
}

/**
 * `ezapply` in the workspace, so `ezapply chat` (how ezapply is used) runs from there without putting the CLI
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
const EZAPPLY_TOOL =
  /\b(workspace_check|posting_active|posting_update_meta|tex_compile|pdf_merge|get_form|fill_fields|repo_sync|github_list_repos|repos_selection_set|answers_check|claims_check)\b/;

async function removeLegacySkills(skillsDir: string, report: InitReport): Promise<void> {
  for (const name of LEGACY_SKILLS) {
    const dir = join(skillsDir, name);
    const text = await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null);
    if (text === null) continue;
    if (EZAPPLY_TOOL.test(text)) {
      await rm(dir, { recursive: true, force: true });
      report.updated.push(`${dir} (removed: renamed to ezapply-${name})`);
    } else {
      report.kept.push(`${dir} (not ezapply's)`);
    }
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

const IMPORT_LINE = "@EZAPPLY.md";

async function ensureClaudeMd(path: string, report: InitReport): Promise<void> {
  const stub = await readFile(join(TEMPLATES, "workspace", "CLAUDE.md"), "utf8");
  if (!(await exists(path))) {
    await writeFile(path, stub, "utf8");
    report.created.push(path);
    return;
  }
  const current = await readFile(path, "utf8");
  if (current.includes(IMPORT_LINE)) {
    report.kept.push(path);
    return;
  }
  if (current.startsWith("# ezapply workspace")) {
    // Written by ezapply 0.1 before the managed/user split: keep a backup, replace with the stub.
    await writeFile(`${path}.bak`, current, "utf8");
    await writeFile(path, stub, "utf8");
    report.updated.push(`${path} (previous version saved as CLAUDE.md.bak)`);
    return;
  }
  await writeFile(path, `${IMPORT_LINE}\n\n${current}`, "utf8");
  report.updated.push(`${path} (added ${IMPORT_LINE} import)`);
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
  const raw = JSON.parse(await readFile(path, "utf8")) as { tex?: Record<string, unknown> };
  const tex = raw.tex;
  // 0.1 defaulted to latexmk, which fails on MiKTeX without Perl; "auto" falls back to xelatex.
  if (tex && tex.engine === "latexmk" && tex.timeoutSeconds === undefined) {
    tex.engine = "auto";
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    report.updated.push(`${path} (tex.engine: latexmk → auto)`);
  }
}

function union(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])];
}

async function writeIfMissing(path: string, content: string, report: InitReport): Promise<void> {
  if (await exists(path)) {
    report.kept.push(path);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  report.created.push(path);
}

async function mergeJson(
  path: string,
  report: InitReport,
  fn: (cur: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const existed = await exists(path);
  const cur = existed ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>) : {};
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(fn(cur), null, 2)}\n`, "utf8");
  (existed ? report.updated : report.created).push(path);
}
