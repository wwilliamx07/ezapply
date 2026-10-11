import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFER_MAX_HOURS, FreshnessService } from "../src/freshness/service.js";
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
    await expect(svc.mark([changes[0]?.id ?? ""], "done")).rejects.toThrow(/re-index/);
  });

  it("stops reporting new commits once the repo is re-indexed in the same chat", async () => {
    const svc = service();
    expect((await svc.changes()).changes.map((c) => c.kind)).toEqual(["repo-pushed"]);
    const before = (await repos.knowledgeMeta("jane/proj"))?.indexedSha ?? "";
    await markIndexed("jane/proj", git(origin, "rev-parse", "HEAD"));
    expect((await svc.changes()).changes).toEqual([]); // no refresh: the check isn't run again
    await markIndexed("jane/proj", before);
  });

  it("puts a repo off for a day across chats, without asking its remote, and lists the timer", async () => {
    const svc = service();
    const [first] = (await svc.changes()).changes;
    const before = Date.now();
    const { marked } = await svc.mark([first?.id ?? ""], "later");
    const until = Date.parse(marked[0]?.until ?? "");
    expect(until - before).toBeGreaterThanOrEqual(24 * 3_600_000);
    expect(until - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    expect((await svc.changes()).changes).toEqual([]);
    expect((await ws.readState()).deferred?.repos?.["jane/proj"]?.until).toBe(marked[0]?.until);

    await push("more.ts", "export {}\n");
    const ask = vi.spyOn(repos, "remoteHead");
    const next = service(); // a new chat, with a push made meanwhile
    expect(await next.changes({ refresh: true })).toEqual({
      changes: [],
      deferred: [{ repo: "jane/proj", until: marked[0]?.until }],
    });
    expect(ask).not.toHaveBeenCalled();
    ask.mockRestore();
  });

  it("checks a repo whose timer ran out, reporting pushes made while it was put off", async () => {
    const head = git(origin, "rev-parse", "HEAD");
    const past = new Date(Date.now() - 1000).toISOString();
    await writeFile(
      ws.path("state.json"),
      JSON.stringify({ schemaVersion: 1, deferred: { repos: { "jane/proj": { until: past, at: past } } } }),
    );
    const r = await service().changes();
    expect(r.changes.map((c) => c.id)).toEqual([`repo-pushed:jane/proj@${head.slice(0, 7)}`]);
    expect(r.deferred).toBeUndefined();
    await ws.updateState({}); // any write drops the expired timer
    expect((await ws.readState()).deferred).toBeUndefined();
  });

  it("takes a length, caps it at 90 days, and refuses hours on a change that isn't a repo's", async () => {
    const svc = service();
    const [change] = (await svc.changes()).changes;
    const week = (await svc.mark([change?.id ?? ""], "later", 168)).marked[0]?.until ?? "";
    expect(Date.parse(week) - Date.now()).toBeGreaterThan(167 * 3_600_000);
    expect(Date.parse(week) - Date.now()).toBeLessThanOrEqual(168 * 3_600_000);
    await ws.dropDeferredRepos(() => true);

    const capped = (await svc.mark([change?.id ?? ""], "later", 10_000)).marked[0]?.until ?? "";
    expect(Date.parse(capped) - Date.now()).toBeLessThanOrEqual(DEFER_MAX_HOURS * 3_600_000);
    expect(Date.parse(capped) - Date.now()).toBeGreaterThan((DEFER_MAX_HOURS - 1) * 3_600_000);
    await ws.dropDeferredRepos(() => true);
  });

  it("re-indexing a repo, or deselecting it, ends its timer", async () => {
    const svc = service();
    const [change] = (await svc.changes()).changes;
    await svc.mark([change?.id ?? ""], "later");
    await repos.sync("jane/proj", "public-url");
    await writeFile(
      join(repos.knowledgePath("jane/proj"), "claims.yaml"),
      "schemaVersion: 1\nrepo: jane/proj\nclaims: []\n",
    );
    const before = (await repos.knowledgeMeta("jane/proj"))?.indexedSha ?? "";
    await repos.markIndexed("jane/proj");
    expect((await ws.readState()).deferred).toBeUndefined();
    await markIndexed("jane/proj", before);

    await svc.mark([change?.id ?? ""], "later");
    await profile.writeRepos({ schemaVersion: 1, repos: [{ fullName: "jane/proj", source: "public-url" }] });
    expect((await ws.readState()).deferred?.repos).toHaveProperty("jane/proj"); // still selected: kept
    await profile.writeRepos({ schemaVersion: 1, repos: [] });
    expect((await ws.readState()).deferred).toBeUndefined();
    await profile.writeRepos({ schemaVersion: 1, repos: [{ fullName: "jane/proj", source: "public-url" }] });
    expect((await service().changes()).changes.map((c) => c.kind)).toEqual(["repo-pushed"]);
    await markIndexed("jane/proj", git(origin, "rev-parse", "HEAD"));
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
    // Every id is checked first: one that isn't current, or hours on a change that isn't a repo's, marks none.
    await expect(svc.mark(["repo-deselected:jane/gone", "repo-pushed:jane/x@0000000"], "done")).rejects.toThrow(
      /No current change/,
    );
    await expect(svc.mark(ids, "later", 24)).rejects.toThrow(/repo's new commits only/);
    expect((await svc.changes()).changes.map((c) => c.id).sort()).toEqual(ids);
    // Several put off in one call, for this chat only.
    const other = service();
    await other.mark(ids, "later");
    expect((await other.changes()).changes).toEqual([]);
    expect((await ws.readState()).deferred).toBeUndefined();
    const [r] = (await svc.mark(["repo-deselected:jane/gone"], "done")).marked;
    expect(r?.removed).toEqual(["knowledge/jane__gone"]);
    await expect(stat(repos.knowledgePath("jane/gone"))).rejects.toThrow();
    expect((await svc.changes()).changes.map((c) => c.id)).toEqual(["repo-deselected:jane/private"]);
    await rm(repos.knowledgePath("jane/private"), { recursive: true });
    expect((await svc.changes()).changes).toEqual([]);
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
    await templates.importTemplate({ source: src, kind: "resume" });
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
    await svc.mark([change?.id ?? ""], "done");
    expect((await svc.changes()).changes).toEqual([]);
  });

  it("after a re-import, reports the resume edit for the profile with its diff", async () => {
    await templates.importTemplate({ source: src, kind: "resume", replace: true });
    const svc = service();
    const { changes } = await svc.changes();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "resume-edited", affects: ["profile", "forms"] });
    expect(changes[0]?.diff).toContain("+\\item Intern at Initech");
    expect(changes[0]?.diff).not.toContain("documentclass");
    await svc.mark([changes[0]?.id ?? ""], "done");
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
    expect(r.notChecked).toEqual([{ what: "templates/resume", reason: expect.stringMatching(/: not found/) }]);
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
    await svc.mark([change?.id ?? ""], "done");
    expect((await svc.changes()).changes).toEqual([]);
    expect((await ws.readState()).synced?.profileIdentity).toBeDefined();
  });

  it("reports a template imported from a scratchpad copy, and a newer resume put in library/", async () => {
    const file = ws.path("templates", "resume", "template.json");
    const meta = JSON.parse(await readFile(file, "utf8"));
    const pad = join(root, "claude", "C--Users-jane-ezapply-home", "0000-session", "scratchpad", "resume-src");
    await writeFile(file, JSON.stringify({ ...meta, importedFrom: pad }));
    const svc = service();
    expect((await svc.changes()).changes).toEqual([
      expect.objectContaining({ id: "template-untracked:resume", kind: "template-untracked", affects: ["resume"] }),
    ]);

    await mkdir(ws.path("library", "old"), { recursive: true });
    await writeFile(ws.path("library", "old", "notes.tex"), "\\section{Not a document}\n");
    await writeFile(
      ws.path("library", "resume.tex"),
      "\\documentclass{article}\n\\begin{document}\nEngineer at Initech\n\\end{document}\n",
    );
    let { changes } = await svc.changes();
    expect(changes.map((c) => c.kind)).toEqual(["template-untracked", "library-template"]);
    expect(changes[0]?.detail).toMatch(/library document listed here/);
    expect(changes[1]).toMatchObject({ affects: ["resume", "cover"] });
    expect(changes[1]?.id).toMatch(/^library-template:library\/resume\.tex@[0-9a-f]{12}$/);
    expect(changes[1]?.detail).toContain(JSON.stringify(ws.path("library", "resume.tex")));

    // Importing it ends both, and the profile then hears about the new resume.
    await templates.importTemplate({ source: ws.path("library", "resume.tex"), kind: "resume", replace: true });
    changes = (await svc.changes()).changes;
    expect(changes.map((c) => c.kind)).toEqual(["resume-edited"]);
    expect(changes[0]?.diff).toContain("+Engineer at Initech");
    await svc.mark([changes[0]?.id ?? ""], "done");
    expect((await svc.changes()).changes).toEqual([]);
  });

  it("names the library file a scratchpad import matches, and stops watching the copy on done", async () => {
    const file = ws.path("templates", "resume", "template.json");
    const meta = JSON.parse(await readFile(file, "utf8"));
    const pad = join(root, "claude", "C--Users-jane-ezapply-home", "0000-session", "scratchpad", "resume.tex");
    await writeFile(file, JSON.stringify({ ...meta, importedFrom: pad }));
    const svc = service();
    const { changes } = await svc.changes();
    expect(changes.map((c) => c.kind)).toEqual(["template-untracked"]);
    expect(changes[0]?.detail).toMatch(/^library\/resume\.tex has the same text/);
    await svc.mark([changes[0]?.id ?? ""], "done");
    expect((await svc.changes()).changes).toEqual([]);
    expect(await templates.templateMeta("resume")).not.toHaveProperty("importedFrom");
    expect(await templates.templateMeta("resume")).not.toHaveProperty("sourceHash");
  });

  it("keeps a library document that isn't a template quiet until it changes", async () => {
    const letter = ws.path("library", "sample-letter.tex");
    await writeFile(letter, "\\documentclass{letter}\n\\begin{document}\nDear team\n\\end{document}\n");
    const svc = service();
    const [change] = (await svc.changes()).changes;
    expect(change?.kind).toBe("library-template");
    await svc.mark([change?.id ?? ""], "done");
    expect((await svc.changes()).changes).toEqual([]);
    expect(Object.keys((await ws.readState()).synced?.library ?? {})).toEqual(["library/sample-letter.tex"]);

    await writeFile(letter, "\\documentclass{letter}\n\\begin{document}\nDear hiring team\n\\end{document}\n");
    const again = (await svc.changes()).changes;
    expect(again.map((c) => c.kind)).toEqual(["library-template"]);
    expect(again[0]?.id).not.toBe(change?.id);
    await svc.mark([again[0]?.id ?? ""], "done");
  });

  it("refuses an id that isn't current", async () => {
    await expect(service().mark(["resume-edited@000000000000"], "done")).rejects.toThrow(/No current change/);
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
