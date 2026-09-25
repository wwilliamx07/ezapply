import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { AnswersFile } from "../src/profile/schema.js";
import { seedAnswers } from "../src/profile/seed-answers.js";
import { ProfileService } from "../src/profile/service.js";
import { Workspace } from "../src/workspace/workspace.js";

let root: string;
let svc: ProfileService;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-profile-"));
  svc = new ProfileService(new Workspace(join(root, "ws")), createLogger({ toFile: false, level: "silent" }));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("answer bank", () => {
  it("seed is valid and fully unanswered", () => {
    const parsed = AnswersFile.parse({ schemaVersion: 1, entries: seedAnswers() });
    expect(parsed.entries.length).toBeGreaterThan(30);
    expect(
      parsed.entries.every((e) => e.answer === null || (typeof e.answer === "object" && e.answer.default === null)),
    ).toBe(true);
  });

  it("writes the seed once with a header, then reports unanswered questions", async () => {
    expect(await svc.ensureAnswerSeed()).toBe(true);
    expect(await svc.ensureAnswerSeed()).toBe(false);
    const text = await readFile(join(root, "ws/profile/answers.yaml"), "utf8");
    expect(text.startsWith("# Screening-question answer bank")).toBe(true);
    const check = await svc.checkAnswers();
    expect(check).toMatchObject({ exists: true, valid: true, answered: 0 });
    expect(check.unanswered?.find((u) => u.id === "gov_official_relationship")).toMatchObject({ suggested: "No" });
  });

  it("reports YAML and schema errors with paths", async () => {
    await writeFile(
      join(root, "ws/profile/answers.yaml"),
      "schemaVersion: 1\nentries:\n  - id: Bad Id\n    canonical: hi\n    answer: 3\n",
    );
    const check = await svc.checkAnswers();
    expect(check.valid).toBe(false);
    expect(check.errors?.map((e) => e.path)).toEqual(expect.arrayContaining(["entries.0.id", "entries.0.canonical"]));
  });
});

describe("profile", () => {
  it("validates and lists commonly missing fields", async () => {
    await mkdir(join(root, "ws/profile"), { recursive: true });
    await writeFile(
      join(root, "ws/profile/profile.yaml"),
      [
        "schemaVersion: 1",
        "identity: { firstName: Jane, lastName: Doe }",
        "contact:",
        "  email: jane@example.com",
        "  address: { city: Austin, country: United States }",
        "work:",
        "  - { company: Acme, title: Engineer, start: 2024-06, end: null }",
      ].join("\n"),
    );
    const check = await svc.checkProfile();
    expect(check).toMatchObject({ exists: true, valid: true });
    expect(check.missing).toEqual(
      expect.arrayContaining(["contact.phone", "workAuthorization.requiresSponsorshipNow"]),
    );
  });

  it("rejects bad dates", async () => {
    await writeFile(
      join(root, "ws/profile/profile.yaml"),
      "schemaVersion: 1\nidentity: { firstName: J, lastName: D }\ncontact: { email: j@x.com, address: { city: A, country: B } }\nwork:\n  - { company: A, title: B, start: June 2024, end: null }\n",
    );
    const check = await svc.checkProfile();
    expect(check.errors?.[0]).toMatchObject({ path: "work.0.start", message: "use YYYY-MM" });
  });
});

describe("template import", () => {
  it("copies sources, skips build artifacts and detects the main file", async () => {
    const src = join(root, "my-resume");
    await mkdir(join(src, "sections"), { recursive: true });
    await writeFile(
      join(src, "resume.tex"),
      "\\documentclass{article}\\begin{document}\\input{sections/exp}\\end{document}",
    );
    await writeFile(join(src, "sections/exp.tex"), "Experience");
    await writeFile(join(src, "resume.aux"), "junk");
    await mkdir(join(src, ".git"));
    await writeFile(join(src, ".git/HEAD"), "ref");

    const r = await svc.importTemplate({ sourceDir: src, kind: "resume" });
    expect(r.files).toEqual(["resume.tex", "sections/exp.tex"]);
    expect(await svc.templateMain("resume")).toBe(join(root, "ws/templates/resume/resume.tex"));

    await expect(svc.importTemplate({ sourceDir: src, kind: "resume" })).rejects.toMatchObject({ code: "bad_request" });
    const again = await svc.importTemplate({ sourceDir: src, kind: "resume", replace: true });
    expect(again.previous).toBeDefined();
    expect((await stat(again.previous as string)).isDirectory()).toBe(true);
  });

  it("asks for the main file when ambiguous", async () => {
    const src = join(root, "two");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.tex"), "\\documentclass{article}\\begin{document}A\\end{document}");
    await writeFile(join(src, "b.tex"), "\\documentclass{article}\\begin{document}B\\end{document}");
    await expect(svc.importTemplate({ sourceDir: src, kind: "cover" })).rejects.toMatchObject({
      message: expect.stringMatching(/candidates: a.tex, b.tex/),
    });
    const r = await svc.importTemplate({ sourceDir: src, kind: "cover", main: "b.tex" });
    expect(r.main.endsWith("b.tex")).toBe(true);
  });

  it("requires an absolute path outside the workspace", async () => {
    await expect(svc.importTemplate({ sourceDir: "relative/dir", kind: "resume" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});
