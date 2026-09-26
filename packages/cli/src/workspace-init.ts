import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DaemonConfig, defaultWorkspaceConfig, WORKSPACE_DIRS } from "@ezapply/companion";

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
export async function initWorkspace(config: DaemonConfig): Promise<InitReport> {
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
      // `ezapply mcp` starts the daemon if needed and relays to it, so there is no daemon to start by hand.
      ezapply: { type: "stdio", command: process.execPath, args: [CLI_MAIN, "mcp"] },
    },
  }));

  await mergeJson(join(root, ".claude", "settings.json"), report, (cur) => {
    const perms = (cur.permissions as { allow?: string[]; deny?: string[] } | undefined) ?? {};
    return {
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
  return report;
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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
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
