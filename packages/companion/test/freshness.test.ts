import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FreshnessService } from "../src/freshness/service.js";
import { MemoryStore } from "../src/github/secrets.js";
import { GitHubService } from "../src/github/service.js";
import { createLogger } from "../src/logger.js";
import { ProfileService } from "../src/profile/service.js";
import { RepoService } from "../src/repos/service.js";
import { TemplateService } from "../src/templates/service.js";
import { unifiedDiff } from "../src/util/line-diff.js";
import { Workspace } from "../src/workspace/workspace.js";

const log = createLogger({ toFile: false, level: "silent" });
let root: string;
let origin: string;
let ws: Workspace;
let profile: ProfileService;
let templates: TemplateService;
let repos: RepoService;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

async function push(file: string, content: string): Promise<string> {
  await writeFile(join(origin, file), content);
  git(origin, "add", "-A");
  git(origin, "-c", "user.name=Jane Doe", "-c", "user.email=jane@example.com", "commit", "-q", "-m", file);
  return git(origin, "rev-parse", "HEAD");
}

async function markIndexed(fullName: string, sha: string) {
  const dir = repos.knowledgePath(fullName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ schemaVersion: 1, repo: fullName, url: "", indexedSha: sha, indexedAt: "2026-01-01" }),
  );
}

/** A fresh service is a fresh chat: nothing put off, the repos checked again. */
function service() {
  return new FreshnessService(ws, profile, templates, repos, log, { waitMs: 20_000 });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-fresh-"));
  origin = join(root, "origin");
  await mkdir(origin);
  git(origin, "init", "-q", "-b", "main");
  await push("README.md", "# x\n");

  ws = new Workspace(join(root, "ws"));
  await mkdir(ws.path("profile"), { recursive: true });
  profile = new ProfileService(ws, log);
  templates = new TemplateService(ws, log);
  const github = new GitHubService({
    secrets: new MemoryStore(),
    appFilePath: join(root, "app.json"),
    localBaseUrl: () => "http://127.0.0.1:1",
    log,
  });
  // jane/proj is the local origin; anything else points at a folder that doesn't exist.
  repos = new RepoService(ws, github, log, (n) => (n === "jane/proj" ? origin : join(root, "nowhere", n)));
});

afterAll(async () => {
  if (process.platform === "win32") spawnSync("attrib", ["-R", join(root, "*"), "/S", "/D"]);
  else spawnSync("chmod", ["-R", "u+w", root]);
  await rm(root, { recursive: true, force: true });
});

describe("FreshnessService: repos", () => {
  it("reports nothing while every indexed repo is at its remote's head", async () => {
    await profile.writeRepos({ schemaVersion: 1, repos: [{ fullName: "jane/proj", source: "public-url" }] });
    await markIndexed("jane/proj", git(origin, "rev-parse", "HEAD"));
    expect(await service().changes()).toEqual({ changes: [] });
  });

  it("reports commits pushed since indexing, without fetching them, and refuses to mark them done", async () => {
    const head = await push("src.ts", "export {}\n");
    const svc = service();
    const { changes } = await svc.changes();
    expect(changes).toEqual([
      expect.objectContaining({ id: `repo-pushed:jane/proj@${head.slice(0, 7)}`, kind: "repo-pushed" }),
    ]);
    await expect(stat(repos.cachePath("jane/proj"))).rejects.toThrow(); // nothing cloned or fetched
    await expect(svc.mark(changes[0]?.id ?? "", "done")).rejects.toThrow(/re-index/);
  });

  it("hides a change put off until the chat ends, and shows a newer push again", async () => {
    const svc = service();
    const [first] = (await svc.changes()).changes;
    await svc.mark(first?.id ?? "", "later");
    expect((await svc.changes()).changes).toEqual([]);
    const head = await push("more.ts", "export {}\n");
    expect((await svc.changes({ refresh: true })).changes[0]?.id).toBe(`repo-pushed:jane/proj@${head.slice(0, 7)}`);
    expect((await service().changes()).changes).toHaveLength(1);
    await markIndexed("jane/proj", head);
  });

  it("lists a repo it can't reach under notChecked, and one needing a login with the hint", async () => {
    await profile.writeRepos({
      schemaVersion: 1,
      repos: [
        { fullName: "jane/proj", source: "public-url" },
        { fullName: "jane/gone", source: "public-url" },
        { fullName: "jane/private", source: "app" },
      ],
    });
    await markIndexed("jane/gone", "a".repeat(40));
    await markIndexed("jane/private", "b".repeat(40));
    const r = await service().changes();
    expect(r.changes).toEqual([]);
    expect(r.notChecked?.map((n) => n.what).sort()).toEqual(["jane/gone", "jane/private"]);
    expect(r.notChecked?.find((n) => n.what === "jane/private")?.hint).toMatch(/github_login/);
  });

  it("reports knowledge from a repo no longer selected, and deletes it when marked done", async () => {
    await profile.writeRepos({ schemaVersion: 1, repos: [{ fullName: "jane/proj", source: "public-url" }] });
    const svc = service();
    const ids = (await svc.changes()).changes.map((c) => c.id).sort();
    expect(ids).toEqual(["repo-deselected:jane/gone", "repo-deselected:jane/private"]);
    const r = await svc.mark("repo-deselected:jane/gone", "done");
    expect(r.removed).toEqual(["knowledge/jane__gone"]);
    await expect(stat(repos.knowledgePath("jane/gone"))).rejects.toThrow();
    await rm(repos.knowledgePath("jane/private"), { recursive: true });
  });
});

describe("FreshnessService: templates and profile", () => {
  let src: string;

  beforeAll(async () => {
    src = join(root, "my-resume");
    await mkdir(join(src, "sections"), { recursive: true });
    await writeFile(
      join(src, "resume.tex"),
      "\\documentclass{article}\n\\pdfgentounicode=1\n\\begin{document}\n\\input{sections/work}\n\\end{document}\n",
    );
    await writeFile(join(src, "sections", "work.tex"), "\\item Engineer at Acme, 2024--\n");
    await templates.importTemplate({ sourceDir: src, kind: "resume" });
  });

  it("records the source's hash at import and reports nothing for a fresh import", async () => {
    const meta = await templates.templateMeta("resume");
    expect(meta?.sourceHash).toMatch(/^[0-9a-f]{12}$/);
    expect((await service().changes()).changes).toEqual([]);
    // The first check takes the template as the profile's baseline, with a copy to diff against.
    expect((await ws.readState()).synced?.resume?.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(await readFile(ws.path("templates", ".synced", "resume", "sections", "work.tex"), "utf8")).toContain("Acme");
  });

  it("ignores a build in the source folder, reports an edit, and takes `done` as current", async () => {
    await writeFile(join(src, "resume.aux"), "\\relax\n");
    await writeFile(join(src, "resume.log"), "log\n");
    expect((await service().changes()).changes).toEqual([]);

    await writeFile(join(src, "sections", "work.tex"), "\\item Engineer at Acme, 2024--\n\\item Intern at Initech\n");
    const svc = service();
    const [change] = (await svc.changes()).changes;
    expect(change).toMatchObject({ kind: "template-source", affects: ["resume"] });
    expect(change?.id).toMatch(/^template-source:resume@[0-9a-f]{12}$/);
    await svc.mark(change?.id ?? "", "done");
    expect((await svc.changes()).changes).toEqual([]);
  });

  it("after a re-import, reports the resume edit for the profile with its diff", async () => {
    await templates.importTemplate({ sourceDir: src, kind: "resume", replace: true });
    const svc = service();
    const { changes } = await svc.changes();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "resume-edited", affects: ["profile", "forms"] });
    expect(changes[0]?.diff).toContain("+\\item Intern at Initech");
    expect(changes[0]?.diff).not.toContain("documentclass");
    await svc.mark(changes[0]?.id ?? "", "done");
    expect((await svc.changes()).changes).toEqual([]);
    expect(await readFile(ws.path("templates", ".synced", "resume", "sections", "work.tex"), "utf8")).toContain(
      "Initech",
    );
  });

  it("records the hash of a template imported before it existed when the source still matches", async () => {
    const file = ws.path("templates", "resume", "template.json");
    const { sourceHash: _, ...old } = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify(old));
    // The import added a `% !TEX program` line to the copy (\pdfgentounicode): that's not a difference.
    expect(await readFile(ws.path("templates", "resume", "resume.tex"), "utf8")).toMatch(/^% !TEX program = pdflatex/);
    expect((await service().changes()).changes).toEqual([]);
    expect((await templates.templateMeta("resume"))?.sourceHash).toMatch(/^[0-9a-f]{12}$/);

    await writeFile(file, JSON.stringify(old));
    await writeFile(join(src, "resume.tex"), "\\documentclass{article}\n\\begin{document}\n\\end{document}\n");
    const [change] = (await service().changes()).changes;
    expect(change?.summary).toMatch(/differs from the copy/);
    await templates.setSourceHash("resume", (change?.id ?? "").split("@")[1] ?? "");
  });

  it("lists a source folder that's gone under notChecked", async () => {
    const file = ws.path("templates", "resume", "template.json");
    const meta = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...meta, importedFrom: join(root, "moved") }));
    const r = await service().changes();
    expect(r.changes).toEqual([]);
    expect(r.notChecked).toEqual([{ what: "templates/resume", reason: expect.stringMatching(/folder not found/) }]);
    await writeFile(file, JSON.stringify(meta));
  });

  it("reports the profile's contact changing under the cover template, not its work history", async () => {
    await mkdir(ws.path("templates", "cover"), { recursive: true });
    await writeFile(ws.path("templates", "cover", "cover.tex"), "\\newcommand{\\myname}{Jane Doe}\n");
    await writeFile(ws.path("templates", "cover", "template.json"), '{"schemaVersion":1,"main":"cover.tex"}');
    const yaml = (email: string, company: string) =>
      [
        "schemaVersion: 1",
        "identity: { firstName: Jane, lastName: Doe }",
        `contact: { email: ${email}, address: { city: Austin, country: United States } }`,
        "work:",
        `  - { company: ${company}, title: Engineer, start: 2024-06, end: null }`,
      ].join("\n");
    await writeFile(ws.path("profile", "profile.yaml"), yaml("jane@example.com", "Acme"));
    const svc = service();
    expect((await svc.changes()).changes).toEqual([]); // the first sight is the baseline

    await writeFile(ws.path("profile", "profile.yaml"), yaml("jane@example.com", "Initech"));
    expect((await svc.changes()).changes).toEqual([]);

    await writeFile(ws.path("profile", "profile.yaml"), yaml("jane.doe@example.com", "Initech"));
    const [change] = (await svc.changes()).changes;
    expect(change).toMatchObject({ kind: "profile-identity", affects: ["cover"] });
    await svc.mark(change?.id ?? "", "done");
    expect((await svc.changes()).changes).toEqual([]);
    expect((await ws.readState()).synced?.profileIdentity).toBeDefined();
  });

  it("refuses an id that isn't current", async () => {
    await expect(service().mark("resume-edited@000000000000", "done")).rejects.toThrow(/No current change/);
  });
});

describe("unifiedDiff", () => {
  it("shows changed lines with context and nothing for equal texts", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\n";
    const after = "a\nb\nc\nD\ne\nf\ng\nh\ni\nj\n";
    expect(unifiedDiff(before, before, "x.tex")).toBe("");
    expect(unifiedDiff(before, after, "x.tex")).toBe(
      [
        "--- x.tex",
        "+++ x.tex",
        "@@ -2,5 +2,5 @@",
        " b",
        " c",
        "-d",
        "+D",
        " e",
        " f",
        "@@ -8,2 +8,3 @@",
        " h",
        " i",
        "+j",
      ].join("\n"),
    );
  });
});
