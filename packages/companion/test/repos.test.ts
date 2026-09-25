import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/github/secrets.js";
import { GitHubService } from "../src/github/service.js";
import { createLogger } from "../src/logger.js";
import { RepoService } from "../src/repos/service.js";
import { Workspace } from "../src/workspace/workspace.js";

const log = createLogger({ toFile: false, level: "silent" });
let root: string;
let origin: string;
let repos: RepoService;

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
  const github = new GitHubService({
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
    const claims = (lines: string, path = "src/limiter.ts") =>
      `schemaVersion: 1\nrepo: jane/proj\nclaims:\n  - id: rate-limiter\n    claim: Implemented a sliding-window rate limiter\n    skills: [TypeScript]\n    evidence:\n      - path: ${path}\n        lines: "${lines}"\n    confidence: high\n`;
    await writeFile(join(dir, "claims.yaml"), claims("2-9"));
    expect(await repos.checkClaims("jane/proj")).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ message: expect.stringMatching(/outside 1-5/) })],
    });
    await expect(repos.markIndexed("jane/proj")).rejects.toMatchObject({ code: "bad_request" });

    await writeFile(join(dir, "claims.yaml"), claims("1-3", "src/nope.ts"));
    expect((await repos.checkClaims("jane/proj")).errors[0]?.message).toMatch(/not found/);

    await writeFile(join(dir, "claims.yaml"), claims("1-3"));
    expect(await repos.checkClaims("jane/proj")).toEqual({ valid: true, claims: 1, errors: [] });
    const meta = await repos.markIndexed("jane/proj");
    expect(meta.indexedSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports only files changed since the last index", async () => {
    await commit("Jane Doe", "123+jane@users.noreply.github.com", { "src/limiter.ts": "a\nb\nc\nd\ne\n" }, "tweak");
    const r = await repos.sync("jane/proj", "public-url");
    expect(r.changedSince).toEqual(["src/limiter.ts"]);
    expect(r.indexedSha).not.toBe(r.headSha);
  });

  it("rejects malformed repo names", async () => {
    await expect(repos.sync("../etc", "public-url")).rejects.toMatchObject({ code: "bad_request" });
  });
});
