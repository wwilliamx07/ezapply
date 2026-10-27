import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/github/secrets.js";
import { GitHubService } from "../src/github/service.js";
import { createLogger } from "../src/logger.js";
import { RepoService } from "../src/repos/service.js";
import type { RunOptions } from "../src/util/proc.js";
import { Workspace } from "../src/workspace/workspace.js";

// Record every git invocation (arguments and environment) while still running real git.
const gitCalls = vi.hoisted(() => [] as { args: string[]; env: NodeJS.ProcessEnv | undefined }[]);
vi.mock("../src/util/proc.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/util/proc.js")>();
  return {
    ...real,
    run: (cmd: string, args: string[], opts?: RunOptions) => {
      if (cmd === "git") gitCalls.push({ args, env: opts?.env });
      return real.run(cmd, args, opts);
    },
  };
});

const log = createLogger({ toFile: false, level: "silent" });
let root: string;
let origin: string;
let repos: RepoService;
let github: GitHubService;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function commit(author: string, email: string, files: Record<string, string>, msg: string) {
  return (async () => {
    for (const [p, content] of Object.entries(files)) {
      await mkdir(join(origin, p, ".."), { recursive: true });
      await writeFile(join(origin, p), content);
    }
    git(origin, "add", "-A");
    git(origin, "-c", `user.name=${author}`, "-c", `user.email=${email}`, "commit", "-q", "-m", msg);
  })();
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-repos-"));
  origin = join(root, "origin");
  await mkdir(origin);
  git(origin, "init", "-q", "-b", "main");
  await commit(
    "Jane Doe",
    "123+jane@users.noreply.github.com",
    { "src/limiter.ts": "a\nb\nc\nd\n", "README.md": "# x\n" },
    "limiter",
  );
  await commit("Bob", "bob@example.com", { "docs/guide.md": "guide\n" }, "docs");

  const secrets = new MemoryStore();
  await secrets.set(
    "github-user-token",
    JSON.stringify({
      accessToken: "ghu_x",
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
      login: "jane",
      name: "Jane Doe",
      userId: 123,
    }),
  );
  const ws = new Workspace(join(root, "ws"));
  github = new GitHubService({
    secrets,
    appFilePath: join(root, "app.json"),
    localBaseUrl: () => "http://127.0.0.1:1",
    log,
  });
  repos = new RepoService(ws, github, log, () => origin);
});

afterAll(async () => {
  // Read-only files must be made writable before cleanup on Windows.
  if (process.platform === "win32") spawnSync("attrib", ["-R", join(root, "*"), "/S", "/D"]);
  else spawnSync("chmod", ["-R", "u+w", root]);
  await rm(root, { recursive: true, force: true });
});

describe("RepoService", () => {
  it("clones read-only and reports a first sync as index-everything", async () => {
    const r = await repos.sync("jane/proj", "public-url");
    expect(r.fileCount).toBe(3);
    expect(r.indexedSha).toBeNull();
    expect(r.changedSince).toBeNull();
    // Too small to split into components.
    expect(r).toMatchObject({ mode: "full", components: [] });
    await expect(writeFile(join(r.path, "README.md"), "tampered")).rejects.toThrow();
  });

  it("attributes contributions to the logged-in user", async () => {
    const c = await repos.contributions("jane/proj");
    expect(c).toMatchObject({ totalCommits: 2, userCommits: 1, userShare: 0.5 });
    expect(c.userAreas.map((a) => a.path)).toEqual(expect.arrayContaining(["src/limiter.ts", "README.md"]));
  });

  it("validates claims against the cached files", async () => {
    const dir = repos.knowledgePath("jane/proj");
    await mkdir(dir, { recursive: true });
    const claims = (files: string) =>
      `schemaVersion: 1\nrepo: jane/proj\nclaims:\n  - id: rate-limiter\n    claim: Implemented a sliding-window rate limiter\n    skills: [TypeScript]\n    files: ${files}\n    confidence: high\n`;
    await writeFile(join(dir, "claims.yaml"), claims("[src/nope.ts]"));
    expect(await repos.checkClaims("jane/proj")).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ message: expect.stringMatching(/src\/nope.ts not found/) })],
    });
    await expect(repos.markIndexed("jane/proj")).rejects.toMatchObject({ code: "bad_request" });

    await writeFile(join(dir, "claims.yaml"), claims("[../outside]"));
    expect((await repos.checkClaims("jane/proj")).errors[0]?.message).toMatch(/inside the repo/);

    // A folder counts as a path.
    await writeFile(join(dir, "claims.yaml"), claims("[src/]"));
    expect(await repos.checkClaims("jane/proj")).toEqual({ valid: true, claims: 1, errors: [] });

    await writeFile(join(dir, "claims.yaml"), claims("[src/limiter.ts]"));
    expect((await repos.markIndexed("jane/proj")).indexedSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("lists every claim compactly: repo once, id and claim, impact only when there is one", async () => {
    const other = repos.knowledgePath("acme/app");
    await mkdir(other, { recursive: true });
    await writeFile(
      join(other, "claims.yaml"),
      "schemaVersion: 1\nrepo: acme/app\nclaims:\n  - id: payments\n    claim: >-\n      Integrated Stripe\n      Checkout\n" +
        '    impact: "$20k processed"\n    files: [a.ts]\n    confidence: high\n',
    );
    const broken = repos.knowledgePath("acme/broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "claims.yaml"), "schemaVersion: 1\nclaims: [");
    await mkdir(repos.knowledgePath("acme/docs-only"), { recursive: true }); // no claims.yaml: left out

    expect(await repos.allClaims()).toBe(
      "2 claims from knowledge/*/claims.yaml\n\n" +
        "## acme/app\n- payments: Integrated Stripe Checkout (impact: $20k processed)\n\n" +
        "## acme/broken\n(claims.yaml has problems: run claims_check acme/broken)\n\n" +
        "## jane/proj\n- rate-limiter: Implemented a sliding-window rate limiter",
    );
    // The documents' checks get the same claims, and the repo whose file doesn't load by name.
    const records = await repos.claimRecords();
    expect(records.claims.map((c) => c.id).sort()).toEqual(["payments", "rate-limiter"]);
    expect(records.broken).toEqual(["acme/broken"]);
    await rm(other, { recursive: true });
    await rm(broken, { recursive: true });
    await rm(repos.knowledgePath("acme/docs-only"), { recursive: true });
  });

  it("reports the files changed since the last index, the claims citing them, and their diff", async () => {
    await commit(
      "Jane Doe",
      "123+jane@users.noreply.github.com",
      { "src/limiter.ts": "a\nB\nc\nd\ne\n", "docs/guide.md": "guide\nmore\n", "package-lock.json": "{}\n" },
      "tweak",
    );
    const r = await repos.sync("jane/proj", "public-url");
    expect(r.indexedSha).not.toBe(r.headSha);
    // The lock file can't change a fact: left out, and counted.
    expect(r).toMatchObject({ mode: "reindex", ignored: 1 });
    expect(r).not.toHaveProperty("components");
    expect(r.changedSince).toEqual([
      { path: "docs/guide.md", added: 1, removed: 0 },
      { path: "src/limiter.ts", added: 2, removed: 1 },
    ]);
    expect(r.affectedClaims).toEqual(["rate-limiter"]);

    const d = await repos.diff("jane/proj", ["src"]);
    expect(d).toMatchObject({ from: r.indexedSha, to: r.headSha, truncated: false });
    expect(d.diff).toContain("-b\n+B");
    expect(d.diff).not.toContain("guide");
    expect((await repos.diff("jane/proj")).diff).toContain("+more");
    await expect(repos.diff("jane/proj", ["../x"])).rejects.toMatchObject({ code: "bad_request" });

    await repos.markIndexed("jane/proj");
    expect(await repos.sync("jane/proj", "public-url")).toMatchObject({
      mode: "current",
      changedSince: [],
      affectedClaims: [],
    });
  });

  it("refuses a change to a claim the user edited, against claims.yaml as it was at the sync", async () => {
    const dir = repos.knowledgePath("jane/proj");
    const claims = (claim: string, edited: boolean) =>
      `schemaVersion: 1\nrepo: jane/proj\nclaims:\n  - id: rate-limiter\n    claim: ${claim}\n    files: [src/]\n` +
      `    confidence: high\n    user_edited: ${edited}\n`;
    await writeFile(join(dir, "claims.yaml"), claims("Built a sliding-window rate limiter", true));
    await repos.sync("jane/proj", "public-url");
    await writeFile(join(dir, "claims.yaml"), claims("Designed a distributed rate limiter", true));
    expect(await repos.checkClaims("jane/proj")).toMatchObject({
      valid: false,
      errors: [{ path: "claims.0", message: expect.stringMatching(/rate-limiter is the user's own/) }],
    });
    // Unmarking it is a change too.
    await writeFile(join(dir, "claims.yaml"), claims("Built a sliding-window rate limiter", false));
    expect((await repos.checkClaims("jane/proj")).valid).toBe(false);
    await writeFile(join(dir, "claims.yaml"), claims("Built a sliding-window rate limiter", true));
    expect((await repos.checkClaims("jane/proj")).valid).toBe(true);
  });

  it("refuses a diff before the repo is indexed", async () => {
    const fresh = new RepoService(new Workspace(join(root, "ws-fresh")), github, log, () => origin);
    await fresh.sync("jane/proj", "public-url");
    await expect(fresh.diff("jane/proj")).rejects.toMatchObject({ code: "bad_request" });
  });

  it("runs concurrent syncs of one repo one after the other", async () => {
    const [a, b] = await Promise.all([repos.sync("jane/proj", "public-url"), repos.sync("jane/proj", "public-url")]);
    expect(a.headSha).toBe(b.headSha);
  });

  it("passes the GitHub token through the environment, never on git's command line", async () => {
    const secrets = new MemoryStore();
    await secrets.set(
      "github-user-token",
      JSON.stringify({
        accessToken: "ghu_SECRETTOKEN",
        expiresAt: null,
        refreshToken: null,
        refreshExpiresAt: null,
        login: "jane",
        name: "Jane Doe",
        userId: 123,
      }),
    );
    const github = new GitHubService({
      secrets,
      appFilePath: join(root, "app.json"),
      localBaseUrl: () => "http://127.0.0.1:1",
      log,
    });
    const withAuth = new RepoService(new Workspace(join(root, "ws-auth")), github, log, () => origin);
    gitCalls.length = 0;
    await withAuth.sync("jane/proj", "app");
    await withAuth.sync("jane/proj", "app"); // the fetch path too
    const header = await github.gitAuthHeader();
    const clone = gitCalls.find((c) => c.args.includes("clone"));
    const fetch = gitCalls.find((c) => c.args.includes("fetch"));
    for (const call of [clone, fetch]) {
      expect(call?.env).toMatchObject({ GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: header });
    }
    expect(gitCalls.some((c) => c.args.some((a) => a.includes("extraHeader") || a.includes(header)))).toBe(false);
  });

  it("rejects malformed repo names", async () => {
    await expect(repos.sync("../etc", "public-url")).rejects.toMatchObject({ code: "bad_request" });
  });
});
