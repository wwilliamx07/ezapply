import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { findContentFiles, TemplateService } from "../src/templates/service.js";
import { Workspace } from "../src/workspace/workspace.js";

let root: string;
let svc: TemplateService;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-templates-"));
  svc = new TemplateService(new Workspace(join(root, "ws")), createLogger({ toFile: false, level: "silent" }));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
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
    expect(r.contentFiles).toEqual(["sections/exp.tex"]);
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
  let cover: TemplateService;

  beforeAll(async () => {
    ws = join(root, "cover-ws");
    cover = new TemplateService(new Workspace(ws), createLogger({ toFile: false, level: "silent" }));
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
    const svc2 = new TemplateService(new Workspace(fresh), createLogger({ toFile: false, level: "silent" }));
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

describe("content files", () => {
  it("follows \\input, \\include and \\subfile through the template, skipping comments and packages", async () => {
    const t = join(root, "multi");
    await mkdir(join(t, "src/sections"), { recursive: true });
    await writeFile(
      join(t, "src/main.tex"),
      [
        "\\documentclass{article}",
        "\\input{glyphtounicode} % a package, not in the template",
        "% \\input{sections/old}",
        "\\begin{document}",
        "\\input{sections/experience}",
        "\\include{sections/projects.tex}",
        "\\end{document}",
      ].join("\n"),
    );
    await writeFile(join(t, "src/sections/experience.tex"), "\\subfile{sections/job1}");
    await writeFile(join(t, "src/sections/job1.tex"), "Job");
    await writeFile(join(t, "src/sections/projects.tex"), "Projects");
    await writeFile(join(t, "src/sections/old.tex"), "Old");
    expect(await findContentFiles(t, "src/main.tex")).toEqual([
      "sections/experience.tex",
      "sections/job1.tex",
      "sections/projects.tex",
    ]);
  });

  it("records them when the main file is set, and keeps main inside the template folder", async () => {
    const ws = join(root, "main-ws");
    const t = new TemplateService(new Workspace(ws), createLogger({ toFile: false, level: "silent" }));
    await mkdir(join(ws, "templates/resume/parts"), { recursive: true });
    await writeFile(join(ws, "templates/resume/cv.tex"), "\\input{parts/body}");
    await writeFile(join(ws, "templates/resume/parts/body.tex"), "Body");
    expect(await t.setTemplateMain("resume", "cv.tex")).toMatchObject({ contentFiles: ["parts/body.tex"] });
    expect(await t.templateMeta("resume")).toMatchObject({ main: "cv.tex", contentFiles: ["parts/body.tex"] });

    await expect(t.setTemplateMain("resume", "../../profile/x.tex")).rejects.toMatchObject({
      code: "path_not_allowed",
    });
    await expect(t.setTemplateMain("resume", "parts/body.txt")).rejects.toMatchObject({ code: "bad_request" });
  });
});
