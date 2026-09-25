import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { GitHubService } from "../github/service.js";
import type { Logger } from "../logger.js";
import { run } from "../util/proc.js";
import { readJson, type Workspace, writeJsonAtomic } from "../workspace/workspace.js";

/** knowledge/<key>/meta.json */
export const KnowledgeMeta = z.object({
  schemaVersion: z.literal(1),
  repo: z.string(),
  url: z.string(),
  indexedSha: z.string(),
  indexedAt: z.string(),
  fileCount: z.number().int().optional(),
  depthPolicy: z.string().default(">15 source files or >2k LOC per component → subfolder, max depth 3"),
});
export type KnowledgeMeta = z.infer<typeof KnowledgeMeta>;

/** knowledge/<key>/claims.yaml */
export const Claim = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case"),
  claim: z.string().min(10),
  skills: z.array(z.string()).default([]),
  impact: z.string().nullable().default(null),
  evidence: z
    .array(
      z.object({
        path: z.string().min(1),
        lines: z
          .string()
          .regex(/^\d+(-\d+)?$/, 'like "12" or "12-40"')
          .optional(),
        sha: z.string().min(7).optional(),
      }),
    )
    .min(1),
  confidence: z.enum(["high", "medium"]),
  user_edited: z.boolean().default(false),
});
export const ClaimsFile = z.object({ schemaVersion: z.literal(1), repo: z.string(), claims: z.array(Claim) });

export interface SyncResult {
  repo: string;
  path: string;
  headSha: string;
  indexedSha: string | null;
  /** Files changed since the last index; null when there is no usable previous index (index everything). */
  changedSince: string[] | null;
  fileCount: number;
}

type RepoSource = "app" | "public-url";

/**
 * Read-only mirrors of the user's repos under repo-cache/. Only this service writes there; files are
 * marked read-only after every sync, and credentials are passed per command, never stored.
 */
export class RepoService {
  constructor(
    private readonly ws: Workspace,
    private readonly github: GitHubService,
    private readonly log: Logger,
    private readonly cloneUrl: (fullName: string) => string = (n) => `https://github.com/${n}.git`,
  ) {}

  static key(fullName: string): string {
    return fullName.replace("/", "__");
  }

  cachePath(fullName: string): string {
    return this.ws.path("repo-cache", RepoService.key(fullName));
  }

  knowledgePath(fullName: string): string {
    return this.ws.path("knowledge", RepoService.key(fullName));
  }

  async sync(fullName: string, source: RepoSource): Promise<SyncResult> {
    assertRepoName(fullName);
    const dir = this.cachePath(fullName);
    const auth = source === "app" ? await this.github.gitAuthHeader() : null;
    const remote = this.cloneUrl(fullName);
    // Real remotes are HTTPS only: no file://, ssh, ext:: or submodule transports.
    const transport = remote.startsWith("https://")
      ? ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always"]
      : [];
    const safe = [
      ...transport,
      "-c",
      "core.symlinks=false",
      "-c",
      "core.hooksPath=",
      "-c",
      "credential.helper=",
      ...(auth ? ["-c", `http.extraHeader=${auth}`] : []),
    ];
    const exists = await stat(join(dir, ".git")).then(
      () => true,
      () => false,
    );

    if (!exists) {
      await rm(dir, { recursive: true, force: true });
      await this.git(safe, ["clone", "--filter=blob:none", "--no-tags", "--single-branch", "--", remote, dir]);
    } else {
      await setReadOnly(dir, false);
      await this.git(safe, ["-C", dir, "fetch", "--no-tags", "--filter=blob:none", "origin", "HEAD"]);
      await this.git(safe, ["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
      await this.git(safe, ["-C", dir, "clean", "-fdx"]);
    }
    await setReadOnly(dir, true);

    const headSha = (await this.git([], ["-C", dir, "rev-parse", "HEAD"])).trim();
    const meta = await this.knowledgeMeta(fullName);
    let changedSince: string[] | null = null;
    if (meta && meta.indexedSha !== headSha) {
      const diff = await run("git", ["-C", dir, "diff", "--name-only", meta.indexedSha, headSha], {
        timeoutMs: 60_000,
      });
      changedSince = diff.exitCode === 0 ? diff.stdout.split(/\r?\n/).filter(Boolean) : null;
    } else if (meta) {
      changedSince = [];
    }
    const files = (await this.git([], ["-C", dir, "ls-files"])).split(/\r?\n/).filter(Boolean);
    this.log.info({ repo: fullName, headSha, files: files.length }, "repo synced");
    return {
      repo: fullName,
      path: dir,
      headSha,
      indexedSha: meta?.indexedSha ?? null,
      changedSince,
      fileCount: files.length,
    };
  }

  /** How much of the repo is the user's own work, from commit history (no file contents needed). */
  async contributions(fullName: string) {
    assertRepoName(fullName);
    const dir = await this.requireCache(fullName);
    const me = await this.github.identity();
    const log = await this.git([], ["-C", dir, "log", "--no-merges", "--format=%H%x09%an%x09%ae%x09%aI"]);
    const commits = log
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [sha, name, email, date] = l.split("\t");
        return { sha: sha ?? "", name: name ?? "", email: email ?? "", date: date ?? "" };
      });
    const mine = (c: { name: string; email: string }) =>
      me !== null &&
      (c.email.toLowerCase().endsWith(`+${me.login.toLowerCase()}@users.noreply.github.com`) ||
        c.email.toLowerCase() === `${me.login.toLowerCase()}@users.noreply.github.com` ||
        c.name.toLowerCase() === me.login.toLowerCase() ||
        (me.name !== null && c.name.toLowerCase() === me.name.toLowerCase()));
    const own = commits.filter(mine);
    const authors = new Map<string, number>();
    for (const c of commits) authors.set(`${c.name} <${c.email}>`, (authors.get(`${c.name} <${c.email}>`) ?? 0) + 1);

    const areas = new Map<string, number>();
    if (own.length > 0) {
      const shas = new Set(own.map((c) => c.sha));
      const touched = await this.git([], ["-C", dir, "log", "--no-merges", "--name-only", "--format=@%H"]);
      let current = "";
      for (const line of touched.split(/\r?\n/)) {
        if (line.startsWith("@")) current = line.slice(1);
        else if (line && shas.has(current)) {
          const area = line.split("/").slice(0, 2).join("/");
          areas.set(area, (areas.get(area) ?? 0) + 1);
        }
      }
    }
    return {
      repo: fullName,
      identity: me ? { login: me.login, name: me.name } : null,
      totalCommits: commits.length,
      userCommits: own.length,
      userShare: commits.length ? Math.round((own.length / commits.length) * 100) / 100 : 0,
      firstUserCommit: own.at(-1)?.date ?? null,
      lastUserCommit: own[0]?.date ?? null,
      userAreas: [...areas.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([path, changes]) => ({ path, changes })),
      topAuthors: [...authors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([author, n]) => ({ author, commits: n })),
      hint:
        own.length === 0 && commits.length > 0
          ? "No commits matched the GitHub login/name. Ask the user which author name/email they commit with."
          : undefined,
    };
  }

  async knowledgeMeta(fullName: string): Promise<KnowledgeMeta | null> {
    const parsed = KnowledgeMeta.safeParse(
      await readJson(join(this.knowledgePath(fullName), "meta.json")).catch(() => null),
    );
    return parsed.success ? parsed.data : null;
  }

  /** Record that knowledge/<repo> now reflects the cached HEAD. */
  async markIndexed(fullName: string): Promise<KnowledgeMeta> {
    const dir = await this.requireCache(fullName);
    const headSha = (await this.git([], ["-C", dir, "rev-parse", "HEAD"])).trim();
    const fileCount = (await this.git([], ["-C", dir, "ls-files"])).split(/\r?\n/).filter(Boolean).length;
    const claims = await this.checkClaims(fullName);
    if (!claims.valid) {
      throw new EzError(
        ErrorCode.BadRequest,
        "claims.yaml has problems; fix them before marking the repo indexed.",
        JSON.stringify(claims.errors.slice(0, 5)),
      );
    }
    const meta: KnowledgeMeta = {
      schemaVersion: 1,
      repo: fullName,
      url: `https://github.com/${fullName}`,
      indexedSha: headSha,
      indexedAt: new Date().toISOString(),
      fileCount,
      depthPolicy: ">15 source files or >2k LOC per component → subfolder, max depth 3",
    };
    await writeJsonAtomic(join(this.knowledgePath(fullName), "meta.json"), meta);
    return meta;
  }

  /** Schema + evidence check: every cited file must exist in the cache and every line range must fit. */
  async checkClaims(
    fullName: string,
  ): Promise<{ valid: boolean; claims: number; errors: { path: string; message: string }[] }> {
    const file = join(this.knowledgePath(fullName), "claims.yaml");
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) return { valid: false, claims: 0, errors: [{ path: "claims.yaml", message: "missing" }] };
    const doc = parseDocument(text);
    if (doc.errors.length) {
      return { valid: false, claims: 0, errors: doc.errors.map((e) => ({ path: "claims.yaml", message: e.message })) };
    }
    const parsed = ClaimsFile.safeParse(doc.toJS());
    if (!parsed.success) {
      return {
        valid: false,
        claims: 0,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
    }
    const errors: { path: string; message: string }[] = [];
    const ids = new Set<string>();
    const cache = this.cachePath(fullName);
    const lineCounts = new Map<string, number | null>();
    for (const [i, c] of parsed.data.claims.entries()) {
      if (ids.has(c.id)) errors.push({ path: `claims.${i}.id`, message: `duplicate id ${c.id}` });
      ids.add(c.id);
      for (const [j, ev] of c.evidence.entries()) {
        const where = `claims.${i}.evidence.${j}`;
        if (ev.path.includes("..")) {
          errors.push({ path: where, message: "path must stay inside the repo" });
          continue;
        }
        if (!lineCounts.has(ev.path)) {
          const content = await readFile(join(cache, ev.path), "utf8").catch(() => null);
          lineCounts.set(ev.path, content === null ? null : content.split("\n").length);
        }
        const lines = lineCounts.get(ev.path);
        if (lines === null || lines === undefined) {
          errors.push({ path: where, message: `${ev.path} not found in the cached repo` });
          continue;
        }
        if (ev.lines) {
          const [a, b] = ev.lines.split("-").map(Number);
          if ((a ?? 0) < 1 || (b ?? a ?? 0) > lines || (b !== undefined && b < (a ?? 0))) {
            errors.push({ path: where, message: `lines ${ev.lines} outside 1-${lines} of ${ev.path}` });
          }
        }
      }
    }
    return { valid: errors.length === 0, claims: parsed.data.claims.length, errors };
  }

  async requireCache(fullName: string): Promise<string> {
    const dir = this.cachePath(fullName);
    const ok = await stat(join(dir, ".git")).then(
      () => true,
      () => false,
    );
    if (!ok) throw new EzError(ErrorCode.NotFound, `${fullName} is not cached.`, "Call repo_sync first.");
    return dir;
  }

  async cachedRepos(): Promise<string[]> {
    const entries = await readdir(this.ws.path("repo-cache")).catch(() => [] as string[]);
    return entries.filter((e) => e.includes("__")).map((e) => e.replace("__", "/"));
  }

  private async git(pre: string[], args: string[]): Promise<string> {
    const r = await run("git", [...pre, ...args], {
      timeoutMs: 10 * 60_000,
      maxOutputBytes: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GCM_INTERACTIVE: "never" },
    });
    if (r.exitCode !== 0) {
      const msg = r.stderr.replace(/Authorization: Basic \S+/g, "Authorization: [redacted]").trim();
      throw new EzError(
        ErrorCode.Internal,
        `git ${args.find((a) => !a.startsWith("-")) ?? ""} failed: ${msg.slice(-800)}`,
        /Authentication|403|not found|Repository not found/i.test(msg)
          ? "Check that the GitHub App is installed on this repo (github_status → manageUrl) or that the URL is public."
          : undefined,
      );
    }
    return r.stdout;
  }
}

function assertRepoName(fullName: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName) || fullName.includes("..")) {
    throw new EzError(ErrorCode.BadRequest, `Invalid repo name: ${fullName}`, 'Use "owner/name".');
  }
}

/** Mark every file read-only (or writable again before a sync). */
async function setReadOnly(dir: string, readOnly: boolean): Promise<void> {
  if (process.platform === "win32") {
    await run("attrib", [readOnly ? "+R" : "-R", join(dir, "*"), "/S", "/D"], { timeoutMs: 120_000 });
  } else {
    await run("chmod", ["-R", readOnly ? "a-w" : "u+w", dir], { timeoutMs: 120_000 });
  }
}
