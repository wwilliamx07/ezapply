import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("adds newer seed questions to an older answer bank once, keeping answers, comments and deletions", async () => {
    const path = join(root, "ws/profile/answers.yaml");
    await mkdir(join(root, "ws/profile"), { recursive: true });
    await writeFile(
      path,
      [
        "# my notes",
        "schemaVersion: 1",
        "entries:",
        "  - id: how_heard",
        "    canonical: How did you hear about us?",
        '    answer: "Job Board" # confirmed',
        "",
      ].join("\n"),
    );
    const first = await svc.ensureAnswerSeed();
    expect(first.created).toBe(false);
    expect(first.added).toEqual(expect.arrayContaining(["year_of_study", "expected_graduation", "full_time_interest"]));
    expect(first.added).not.toContain("criminal_conviction"); // a version-1 question the file doesn't have
    const text = await readFile(path, "utf8");
    expect(text).toContain("# my notes");
    expect(text).toContain('answer: "Job Board" # confirmed');
    expect(text).toMatch(/seedVersion: 2/);
    expect(await svc.checkAnswers()).toMatchObject({ valid: true, answered: 1 });

    await writeFile(path, text.replace(/ {2}- id: year_of_study[\s\S]*?(?= {2}- id:)/, ""));
    expect(await svc.ensureAnswerSeed()).toEqual({ created: false, added: [] });
    expect(await readFile(path, "utf8")).not.toContain("year_of_study");
    await rm(path);
  });

  it("writes the seed once with a header, then reports unanswered questions", async () => {
    expect(await svc.ensureAnswerSeed()).toEqual({ created: true, added: [] });
    expect(await svc.ensureAnswerSeed()).toEqual({ created: false, added: [] });
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

  it("takes an education date with a day, such as an expected graduation date", async () => {
    const base =
      "schemaVersion: 1\nidentity: { firstName: J, lastName: D }\ncontact: { email: j@x.com, address: { city: A, country: B } }\neducation:\n";
    await writeFile(
      join(root, "ws/profile/profile.yaml"),
      `${base}  - { school: Example U, degree: BSc, start: 2025-09, end: 2030-04-30 }\n`,
    );
    expect(await svc.checkProfile()).toMatchObject({ valid: true });
    await writeFile(join(root, "ws/profile/profile.yaml"), `${base}  - { school: Example U, degree: BSc, start: 2025 }\n`);
    expect((await svc.checkProfile()).errors?.[0]).toMatchObject({ path: "education.0.start" });
  });
});
