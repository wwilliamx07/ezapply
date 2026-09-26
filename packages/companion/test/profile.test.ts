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
    expect(again.texProgram).toBeUndefined();
  });

  it("marks a pdfTeX-only main file for pdflatex, and keeps an existing comment", async () => {
    const src = join(root, "jake");
    await mkdir(src, { recursive: true });
    const body =
      "\\documentclass{article}\n\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\begin{document}x\\end{document}\n";
    await writeFile(join(src, "resume.tex"), body);
    const r = await svc.importTemplate({ sourceDir: src, kind: "resume", replace: true });
    expect(r.texProgram).toMatchObject({
      engine: "pdflatex",
      added: true,
      note: expect.stringMatching(/glyphtounicode/),
    });
    expect(await readFile(r.main, "utf8")).toBe(`% !TEX program = pdflatex\n${body}`);
    expect(await readFile(join(src, "resume.tex"), "utf8")).toBe(body); // the user's original is untouched

    await writeFile(join(src, "resume.tex"), `% !TeX program = lualatex\n${body}`);
    const again = await svc.importTemplate({ sourceDir: src, kind: "resume", replace: true });
    expect(again.texProgram).toEqual({ engine: "lualatex", added: false });
    expect(await readFile(again.main, "utf8")).toBe(`% !TeX program = lualatex\n${body}`);
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

describe("cover template: default and example", () => {
  let ws: string;
  let cover: ProfileService;

  beforeAll(async () => {
    ws = join(root, "cover-ws");
    cover = new ProfileService(new Workspace(ws), createLogger({ toFile: false, level: "silent" }));
    // What `ezapply init` installs.
    await mkdir(join(ws, "templates/cover"), { recursive: true });
    await writeFile(join(ws, "templates/cover/cover.tex"), "\\documentclass{article}");
    await writeFile(
      join(ws, "templates/cover/template.json"),
      JSON.stringify({ schemaVersion: 1, main: "cover.tex", origin: "default" }),
    );
  });

  it("records an example letter and keeps the previous one", async () => {
    const pdf = join(root, "Example Letter.pdf");
    await writeFile(pdf, "%PDF-1.4");
    const r = await cover.importExample({ sourcePath: pdf });
    expect(r).toMatchObject({ format: "pdf", path: join(ws, "templates/cover/example/Example Letter.pdf") });
    expect(await cover.templateMeta("cover")).toMatchObject({
      origin: "default",
      example: "example/Example Letter.pdf",
    });

    const png = join(root, "letter.png");
    await writeFile(png, "png");
    const again = await cover.importExample({ sourcePath: png });
    expect(again.format).toBe("image");
    expect(again.previous).toBeDefined();
    expect((await cover.templateMeta("cover"))?.example).toBe("example/letter.png");
  });

  it("asks for a PDF export of Word files and needs an absolute path", async () => {
    const docx = join(root, "letter.docx");
    await writeFile(docx, "PK");
    await expect(cover.importExample({ sourcePath: docx })).rejects.toMatchObject({
      code: "bad_request",
      hint: expect.stringMatching(/PDF/),
    });
    await expect(cover.importExample({ sourcePath: "letter.pdf" })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("marks a reworked default as custom, so importing over it then needs confirmation", async () => {
    await cover.setTemplateMain("cover", "cover.tex");
    expect(await cover.templateMeta("cover")).toMatchObject({ origin: "custom", example: "example/letter.png" });

    const src = join(root, "my-cover");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "letter.tex"), "\\documentclass{article}\\begin{document}Hi\\end{document}");
    await expect(cover.importTemplate({ sourceDir: src, kind: "cover" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("replaces the untouched default without asking", async () => {
    const fresh = join(root, "fresh-ws");
    const svc2 = new ProfileService(new Workspace(fresh), createLogger({ toFile: false, level: "silent" }));
    await mkdir(join(fresh, "templates/cover"), { recursive: true });
    await writeFile(
      join(fresh, "templates/cover/template.json"),
      JSON.stringify({ schemaVersion: 1, main: "cover.tex", origin: "default" }),
    );
    await writeFile(join(fresh, "templates/cover/cover.tex"), "default");

    const r = await svc2.importTemplate({ sourceDir: join(root, "my-cover"), kind: "cover" });
    expect(r.previous).toBeDefined();
    expect(await svc2.templateMeta("cover")).toMatchObject({ origin: "imported", main: "letter.tex" });
  });
});
