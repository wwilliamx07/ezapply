import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { GitHubService } from "../github/service.js";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import { installHint } from "../util/install-hints.js";
import { KeyedQueue } from "../util/keyed-queue.js";
import { run, which } from "../util/proc.js";
import type { Workspace } from "../workspace/workspace.js";
import { type Component, componentsOver, type IndexMode, ignoredPath, indexMode } from "./index-plan.js";

/** claims.yaml as it was at the last repo_sync, beside it (`snapshotClaims`). */
const CLAIMS_AT_SYNC = ".claims-at-sync.yaml";

/** knowledge/<key>/meta.json */
const KnowledgeMeta = z.object({
  schemaVersion: z.literal(1),
  repo: z.string(),
  url: z.string(),
  indexedSha: z.string(),
  indexedAt: z.string(),
  fileCount: z.number().int().optional(),
  depthPolicy: z.string().default(">15 source files or >2k LOC per component → subfolder, max depth 3"),
});
type KnowledgeMeta = z.infer<typeof KnowledgeMeta>;

/** knowledge/<key>/claims.yaml */
const Claim = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case"),
  claim: z.string().min(10),
  skills: z.array(z.string()).default([]),
  impact: z.string().nullable().default(null),
  /** Repo paths (files or folders) that show the claim: what a re-index checks when they change. */
  files: z.array(z.string().min(1)).min(1),
  confidence: z.enum(["high", "medium"]),
  user_edited: z.boolean().default(false),
});
const ClaimsFile = z.object({ schemaVersion: z.literal(1), repo: z.string(), claims: z.array(Claim) });

/** One file changed since the last index; `added`/`removed` are null for a binary file. */
interface ChangedFile {
  path: string;
  added: number | null;
  removed: number | null;
}

interface SyncResult {
  repo: string;
  path: string;
  headSha: string;
  indexedSha: string | null;
  /**
   * Files changed since the last index, with line counts; `[]` when current; null when there is no usable
   * previous index (never indexed, or the indexed commit is gone from the history).
   */
  changedSince: ChangedFile[] | null;
  /** Ids of claims whose `files` include a changed path (or a folder holding one): the claims to re-check. */
  affectedClaims: string[];
  fileCount: number;
  /** What to do (`index-plan.ts`): from `indexedSha` and `changedSince` without its ignored paths. */
  mode: IndexMode;
  /** How many changed paths were left out of `changedSince` as lock, vendored or generated files. */
  ignored?: number;
  /** For a full index or a rebuild: the folders the depth policy splits (`componentsOver`). */
  components?: Component[];
}

/** What `repo_diff` returns at most, so one call can't flood the context. */
const DIFF_MAX_CHARS = 60_000;

type RepoSource = "app" | "public-url";

interface ClaimsCheck {
  valid: boolean;
  claims: number;
  errors: { path: string; message: string }[];
}

/**
 * Read-only mirrors of the user's repos under repo-cache/. Only this service writes there; files are
 * marked read-only after every sync, and credentials are passed per command, never stored.
 */
export class RepoService {
  /** Two syncs of one repo would collide on git's index.lock (and on the read-only flags). */
  private readonly syncs = new KeyedQueue();

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
    return this.syncs.run(fullName.toLowerCase(), () => this.doSync(fullName, source));
  }

  /**
   * The commit the remote's default branch points at, without fetching anything (`git ls-remote`), so the
   * cache stays as it is until the user agrees to re-index. Null for an empty repo.
   */
  async remoteHead(fullName: string, source: RepoSource, timeoutMs = 10_000): Promise<string | null> {
    assertRepoName(fullName);
    const { remote, safe, authEnv } = await this.access(fullName, source);
    const out = await this.git(safe, ["ls-remote", "--", remote, "HEAD"], authEnv, timeoutMs);
    const sha = out.split(/\s/)[0]?.trim();
    return sha && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
  }

  /** The remote, the hardening flags every git command against it gets, and the token's environment. */
  private async access(fullName: string, source: RepoSource) {
    const auth = source === "app" ? await this.github.gitAuthHeader() : null;
    const remote = this.cloneUrl(fullName);
    // Real remotes are HTTPS only: no file://, ssh, ext:: or submodule transports.
    const transport = remote.startsWith("https://")
      ? ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always"]
      : [];
    const safe = [...transport, "-c", "core.symlinks=false", "-c", "core.hooksPath=", "-c", "credential.helper="];
    // The token goes through the environment, not `-c` on the command line: other local users can read a
    // process's arguments (/proc/<pid>/cmdline), but not its environment. Needs git 2.31 or later.
    const authEnv: Record<string, string> = auth
      ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: auth }
      : {};
    return { remote, safe, authEnv };
  }

  private async doSync(fullName: string, source: RepoSource): Promise<SyncResult> {
    const dir = this.cachePath(fullName);
    const { remote, safe, authEnv } = await this.access(fullName, source);
    const exists = await stat(join(dir, ".git")).then(
      () => true,
      () => false,
    );

    if (!exists) {
      await rm(dir, { recursive: true, force: true });
      await this.git(safe, ["clone", "--filter=blob:none", "--no-tags", "--single-branch", "--", remote, dir], authEnv);
    } else {
      await setReadOnly(dir, false);
      await this.git(safe, ["-C", dir, "fetch", "--no-tags", "--filter=blob:none", "origin", "HEAD"], authEnv);
      await this.git(safe, ["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
      await this.git(safe, ["-C", dir, "clean", "-fdx"]);
    }
    const headSha = (await this.git([], ["-C", dir, "rev-parse", "HEAD"])).trim();
    const meta = await this.knowledgeMeta(fullName);
    let changedSince: ChangedFile[] | null = null;
    if (meta && meta.indexedSha !== headSha) {
      // While the cache is still writable: the clone is blobless, so this also fetches the old side's blobs
      // that repo_diff needs later. A failure means the indexed commit is gone (a force-push): index anew.
      const numstat = await this.git(
        safe,
        ["-C", dir, "diff", "--numstat", "--no-renames", "--no-ext-diff", "--no-textconv", meta.indexedSha, headSha],
        authEnv,
        120_000,
      ).catch(() => null);
      changedSince = numstat === null ? null : parseNumstat(numstat);
    } else if (meta) {
      changedSince = [];
    }
    await setReadOnly(dir, true);
    const all = changedSince;
    if (changedSince) changedSince = changedSince.filter((c) => !ignoredPath(c.path));
    const ignored = all && changedSince ? all.length - changedSince.length : 0;
    const mode = indexMode(meta !== null, changedSince);
    await this.snapshotClaims(fullName);

    const files = (await this.git([], ["-C", dir, "ls-files"])).split(/\r?\n/).filter(Boolean);
    this.log.info({ repo: fullName, headSha, files: files.length, mode }, "repo synced");
    return {
      mode,
      repo: fullName,
      path: dir,
      headSha,
      indexedSha: meta?.indexedSha ?? null,
      changedSince,
      affectedClaims: changedSince?.length
        ? await this.claimsCiting(
            fullName,
            changedSince.map((c) => c.path),
          )
        : [],
      fileCount: files.length,
      ...(ignored ? { ignored } : {}),
      ...(mode === "full" || mode === "rebuild" ? { components: await componentsOver(dir, files) } : {}),
    };
  }

  /**
   * Keep claims.yaml as it is at the sync (`.claims-at-sync.yaml` beside it), so `claims_check` can tell what an
   * index run changed in a claim the user edited.
   */
  private async snapshotClaims(fullName: string): Promise<void> {
    const text = await readFile(join(this.knowledgePath(fullName), "claims.yaml"), "utf8").catch(() => null);
    if (text !== null) await writeFile(join(this.knowledgePath(fullName), CLAIMS_AT_SYNC), text, "utf8");
  }

  /**
   * The claims marked `user_edited` at the last sync that the file no longer has as they were: an index run may
   * not reword the user's own claims (the skill asks, and a re-index still could). Compared on claim, skills and
   * impact.
   */
  private async userEditsChanged(
    fullName: string,
    claims: z.infer<typeof Claim>[],
  ): Promise<{ path: string; message: string }[]> {
    const text = await readFile(join(this.knowledgePath(fullName), CLAIMS_AT_SYNC), "utf8").catch(() => null);
    if (text === null) return [];
    const before = ClaimsFile.safeParse(parseDocument(text).toJS());
    if (!before.success) return [];
    const errors: { path: string; message: string }[] = [];
    for (const old of before.data.claims.filter((c) => c.user_edited)) {
      const i = claims.findIndex((c) => c.id === old.id);
      const now = claims[i];
      const same =
        now?.user_edited &&
        now.claim === old.claim &&
        now.impact === old.impact &&
        JSON.stringify(now.skills) === JSON.stringify(old.skills);
      if (same) continue;
      errors.push({
        path: now ? `claims.${i}` : "claims",
        message: `${old.id} is the user's own (user_edited) and was ${now ? "changed" : "removed"}: put it back as it was, and ask the user before changing it`,
      });
    }
    return errors;
  }

  /** Ids of claims that cite one of `paths`, or a folder holding one. A claims.yaml that doesn't parse gives []. */
  private async claimsCiting(fullName: string, paths: string[]): Promise<string[]> {
    const loaded = await this.loadClaims(fullName);
    if ("errors" in loaded) return [];
    const cites = (cited: string, path: string) => {
      const c = cited.replace(/^\.?\//, "").replace(/\/+$/, "");
      return c === "" || c === "." || path === c || path.startsWith(`${c}/`);
    };
    return loaded.claims.filter((c) => c.files.some((f) => paths.some((p) => cites(f, p)))).map((c) => c.id);
  }

  /**
   * The unified diff from the indexed commit to the cached HEAD, limited to `paths` (files or folders) when
   * given, cut at DIFF_MAX_CHARS. Reading the diff instead of whole files is what keeps a re-index small.
   */
  async diff(
    fullName: string,
    paths: string[] = [],
  ): Promise<{ from: string; to: string; diff: string; truncated: boolean }> {
    assertRepoName(fullName);
    const dir = await this.requireCache(fullName);
    const meta = await this.knowledgeMeta(fullName);
    if (!meta) {
      throw new EzError(ErrorCode.BadRequest, `${fullName} hasn't been indexed yet.`, "Index the whole repo instead.");
    }
    for (const p of paths) {
      if (p.includes("..") || p.startsWith("/") || p.startsWith("-") || /^[a-z]:/i.test(p)) {
        throw new EzError(ErrorCode.BadRequest, `Invalid path: ${p}`, "Use paths relative to the repo root.");
      }
    }
    const headSha = (await this.git([], ["-C", dir, "rev-parse", "HEAD"])).trim();
    // Never fetches (the sync already brought both sides' blobs), and --no-ext-diff / --no-textconv so the
    // repo's .gitattributes can't make git run a driver.
    const out = await this.git(
      ["-c", "core.hooksPath=", "-c", "protocol.allow=never"],
      [
        "-C",
        dir,
        "diff",
        "--no-color",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        meta.indexedSha,
        headSha,
        "--",
        ...paths,
      ],
      {},
      120_000,
    ).catch((err: unknown) => {
      throw new EzError(
        ErrorCode.Internal,
        `Couldn't diff ${fullName} against the indexed commit.`,
        `Run repo_sync first, or read the changed files instead. (${(err as Error).message.slice(0, 200)})`,
      );
    });
    const truncated = out.length > DIFF_MAX_CHARS;
    const diff = truncated
      ? `${out.slice(0, DIFF_MAX_CHARS)}\n… (cut at ${DIFF_MAX_CHARS} characters: ask for fewer paths)`
      : out;
    return { from: meta.indexedSha, to: headSha, diff, truncated };
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

  /** Record that knowledge/<repo> now reflects the cached HEAD, once claims.yaml checks out. */
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
    // Current again, so a timer the user set for its new commits has nothing left to put off.
    await this.ws.dropDeferredRepos((r) => r.toLowerCase() === fullName.toLowerCase());
    return meta;
  }

  /** Schema, unique ids, and every cited path (a file or a folder) present in the cached repo. */
  async checkClaims(fullName: string): Promise<ClaimsCheck> {
    const loaded = await this.loadClaims(fullName);
    if ("errors" in loaded) return { valid: false, claims: 0, errors: loaded.errors };
    const errors = await this.userEditsChanged(fullName, loaded.claims);
    const ids = new Set<string>();
    for (const [i, c] of loaded.claims.entries()) {
      if (ids.has(c.id)) errors.push({ path: `claims.${i}.id`, message: `duplicate id ${c.id}` });
      ids.add(c.id);
      for (const [j, f] of c.files.entries()) {
        const where = `claims.${i}.files.${j}`;
        if (f.includes("..") || f.startsWith("/") || /^[a-z]:/i.test(f)) {
          errors.push({ path: where, message: "path must stay inside the repo" });
        } else if (!(await stat(join(this.cachePath(fullName), f)).catch(() => null))) {
          errors.push({ path: where, message: `${f} not found in the cached repo` });
        }
      }
    }
    return { valid: errors.length === 0, claims: loaded.claims.length, errors };
  }

  private async loadClaims(
    fullName: string,
  ): Promise<{ claims: z.infer<typeof Claim>[] } | { errors: { path: string; message: string }[] }> {
    const text = await readFile(join(this.knowledgePath(fullName), "claims.yaml"), "utf8").catch(() => null);
    if (text === null) return { errors: [{ path: "claims.yaml", message: "missing" }] };
    const doc = parseDocument(text);
    if (doc.errors.length) return { errors: doc.errors.map((e) => ({ path: "claims.yaml", message: e.message })) };
    const parsed = ClaimsFile.safeParse(doc.toJS());
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
    }
    return { claims: parsed.data.claims };
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

  /**
   * Every claim of every indexed repo as compact text, for `claims_list`: the repo named once as a heading,
   * then one line per claim, `id: claim`, with `(impact: …)` only when there is one. Evidence, skills and
   * confidence are left out: they matter when writing claims (`claims_check`), not when choosing them. This
   * is about half the size of a Grep over the files, which repeats the file path and a line number on every
   * line and lists `impact: null`. A repo whose claims.yaml doesn't parse gets one line saying so.
   */
  async allClaims(): Promise<string> {
    const keys = (await readdir(this.ws.path("knowledge")).catch(() => [] as string[]))
      .filter((k) => k.includes("__"))
      .sort();
    const blocks: string[] = [];
    let count = 0;
    for (const key of keys) {
      const repo = key.replace("__", "/");
      if (!(await stat(join(this.knowledgePath(repo), "claims.yaml")).catch(() => null))) continue;
      const loaded = await this.loadClaims(repo);
      if ("errors" in loaded) {
        blocks.push(`## ${repo}\n(claims.yaml has problems: run claims_check ${repo})`);
        continue;
      }
      count += loaded.claims.length;
      const lines = loaded.claims.map(
        (c) => `- ${c.id}: ${oneLine(c.claim)}${c.impact ? ` (impact: ${oneLine(c.impact)})` : ""}`,
      );
      blocks.push(`## ${repo}\n${lines.join("\n")}`);
    }
    if (blocks.length === 0) return "No claims yet: no repo has been indexed (the ezapply-index-repo skill).";
    return `${count} claims from knowledge/*/claims.yaml\n\n${blocks.join("\n\n")}`;
  }

  /** Every indexed repo's claims, parsed, for the documents' checks; a claims.yaml that doesn't parse is skipped. */
  async claimRecords(): Promise<{ id: string; claim: string; skills: string[]; impact: string | null }[]> {
    const keys = (await readdir(this.ws.path("knowledge")).catch(() => [] as string[])).filter((k) => k.includes("__"));
    const out: { id: string; claim: string; skills: string[]; impact: string | null }[] = [];
    for (const key of keys) {
      const loaded = await this.loadClaims(key.replace("__", "/"));
      if ("claims" in loaded)
        for (const { id, claim, skills, impact } of loaded.claims) out.push({ id, claim, skills, impact });
    }
    return out;
  }

  /** Every repo with a knowledge folder, whether or not it's still selected (`claims_list` reads them all). */
  async indexedRepos(): Promise<string[]> {
    const keys = await readdir(this.ws.path("knowledge")).catch(() => [] as string[]);
    return keys.filter((k) => k.includes("__")).map((k) => k.replace("__", "/"));
  }

  /** Delete a repo's knowledge folder and its cache (a repo no longer selected). */
  async forget(fullName: string): Promise<{ removed: string[] }> {
    assertRepoName(fullName);
    const removed: string[] = [];
    const cache = this.cachePath(fullName);
    if (await stat(cache).catch(() => null)) {
      await this.syncs.run(fullName.toLowerCase(), async () => {
        await setReadOnly(cache, false);
        await rm(cache, { recursive: true, force: true });
      });
      removed.push(`repo-cache/${RepoService.key(fullName)}`);
    }
    const knowledge = this.knowledgePath(fullName);
    if (await stat(knowledge).catch(() => null)) {
      await rm(knowledge, { recursive: true, force: true });
      removed.push(`knowledge/${RepoService.key(fullName)}`);
    }
    this.log.info({ repo: fullName, removed }, "repo forgotten");
    return { removed };
  }

  async cachedRepos(): Promise<string[]> {
    const entries = await readdir(this.ws.path("repo-cache")).catch(() => [] as string[]);
    return entries.filter((e) => e.includes("__")).map((e) => e.replace("__", "/"));
  }

  private async git(
    pre: string[],
    args: string[],
    env: Record<string, string> = {},
    timeoutMs = 10 * 60_000,
  ): Promise<string> {
    requireGit();
    const r = await run("git", [...pre, ...args], {
      timeoutMs,
      maxOutputBytes: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GCM_INTERACTIVE: "never", ...env },
    });
    if (r.timedOut) {
      throw new EzError(
        ErrorCode.Internal,
        `git ${args.find((a) => !a.startsWith("-")) ?? ""} timed out after ${Math.round(timeoutMs / 1000)} s.`,
      );
    }
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

/** A claim's text on one line (YAML block scalars can carry line breaks). */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** `git diff --numstat` lines: "added<TAB>removed<TAB>path", with "-" counts for a binary file. */
function parseNumstat(out: string): ChangedFile[] {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [added = "-", removed = "-", ...rest] = line.split("\t");
      return {
        path: rest.join("\t"),
        added: added === "-" ? null : Number(added),
        removed: removed === "-" ? null : Number(removed),
      };
    });
}

function requireGit(): void {
  if (!which("git")) throw new EzError(ErrorCode.NotFound, "git is not installed.", installHint("git"));
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
