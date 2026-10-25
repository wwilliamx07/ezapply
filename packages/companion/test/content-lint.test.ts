import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSources, contentLint, neverMentioned, withContentLint } from "../src/documents/content-lint.js";
import type { Services } from "../src/services.js";
import { Workspace } from "../src/workspace/workspace.js";

let root: string;
let s: Services;
const folder = () => join(root, "postings", "p1");

const TEMPLATE = [
  "\\section{Experience}",
  "\\resumeItem{Kept the build green} % src: work.0",
  "\\textbf{Languages}{: TypeScript, Go, SQL}",
  "\\vspace{4pt}",
  "",
].join("\n");

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-content-"));
  await mkdir(join(root, "templates", "resume"), { recursive: true });
  await mkdir(folder(), { recursive: true });
  await writeFile(join(root, "templates", "resume", "main.tex"), TEMPLATE);
  await writeFile(join(folder(), "posting.md"), "Wanted: Kubernetes, 5 years of Go.");
  const ws = new Workspace(root);
  s = {
    workspace: ws,
    postings: { folder: (id: string) => join(root, "postings", id) },
    templates: {
      templateMain: async (kind: string) => (kind === "resume" ? join(root, "templates", "resume", "main.tex") : null),
      templateMeta: async (kind: string) => (kind === "resume" ? { main: "main.tex" } : null),
    },
    repos: {
      claimRecords: async () => [
        {
          id: "rate-limiter",
          claim: "Built a rate limiter serving 1,200 requests a second",
          skills: ["Redis"],
          impact: null,
        },
      ],
    },
    profile: {
      rawProfile: async () => ({ work: [{ company: "Example Co", highlights: ["Cut deploys to 15 minutes"] }] }),
      preferences: async () => ({ neverMention: "- blockchain\n- Acme Corp" }),
    },
  } as unknown as Services;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const resume = (lines: string[]) =>
  writeFile(join(folder(), "resume.tex"), [...TEMPLATE.split("\n"), ...lines].join("\n"));

describe("the content lint", () => {
  it("checks only the lines the tailoring changed, each against the evidence", async () => {
    await resume([
      "\\resumeItem{Built a rate limiter for 1200 requests a second} % src: rate-limiter",
      "\\resumeItem{Cut deploys to 15 minutes, 40\\% faster} % src: profile.work[0].highlights.0",
      "\\resumeItem{Ran 5 teams}",
      "\\resumeItem{Wrote a blockchain ledger}",
      "% src: nope, work.7",
      "\\textbf{Tools}{: Redis, Kubernetes, Docker}",
    ]);
    const issues = await contentLint(s, join(folder(), "resume.tex"));
    expect(issues.map(({ kind, line, text }) => [kind, line, text])).toEqual([
      ["unsourced-number", 7, "40"],
      // 5 is in the posting; the bullet has no src.
      ["missing-src", 8, "Ran 5 teams"],
      // The comment line below the bullet is its src, and names nothing known.
      ["never-mention", 9, "blockchain"],
      ["unknown-src", 10, "nope"],
      ["unknown-src", 10, "work.7"],
      // Kubernetes is only in the posting, Docker nowhere.
      ["unbacked-skill", 11, "Kubernetes"],
      ["unbacked-skill", 11, "Docker"],
    ]);
  });

  it("leaves other files alone, and refuses a review only for missing or unknown sources", async () => {
    expect(await contentLint(s, join(root, "templates", "resume", "main.tex"))).toEqual([]);
    await resume(["\\resumeItem{Wrote a blockchain ledger, 99 times} % src: rate-limiter"]);
    await expect(checkSources(s, ["postings/p1/resume.pdf"])).resolves.toBeUndefined();
    await resume(["\\resumeItem{Wrote a ledger}"]);
    await expect(checkSources(s, ["postings/p1/resume.pdf"])).rejects.toMatchObject({
      code: "bad_request",
      message: expect.stringMatching(/resume\.tex:6 no % src/),
    });
  });

  it("adds its findings to a build's lint and hint", async () => {
    await resume(["\\resumeItem{Wrote 7 ledgers} % src: rate-limiter"]);
    const build: { ok: boolean; lint: object[]; hint?: string } = { ok: true, lint: [{ kind: "short-line" }] };
    const r = await withContentLint(s, "postings/p1/resume.tex", build);
    expect(r.lint).toEqual([
      { kind: "short-line" },
      { kind: "unsourced-number", file: "resume.tex", line: 6, text: "7" },
    ]);
    expect(r.hint).toMatch(/1 content finding in lint \(unsourced-number\)/);
    expect(await withContentLint(s, "postings/p1/resume.tex", { ok: false })).toEqual({ ok: false });
  });

  it("finds never-mention terms as words", () => {
    expect(neverMentioned("- blockchain\n- Acme Corp", "Not at acme corp, no Blockchain")).toEqual([
      "blockchain",
      "Acme Corp",
    ]);
    expect(neverMentioned("- chain", "blockchain")).toEqual([]);
  });
});
