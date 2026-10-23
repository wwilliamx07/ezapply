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

  it("writes the seed once with a header, then reports unanswered questions", async () => {
    expect(await svc.ensureAnswerSeed()).toBe(true);
    expect(await svc.ensureAnswerSeed()).toBe(false);
    const text = await readFile(join(root, "ws/profile/answers.yaml"), "utf8");
    expect(text.startsWith("# Screening-question answer bank")).toBe(true);
    const check = await svc.checkAnswers();
    expect(check).toMatchObject({ exists: true, valid: true, answered: 0 });
    expect(check.unanswered?.find((u) => u.id === "gov_official_relationship")).toMatchObject({ suggested: "No" });
  });

  it("keeps both of two answer saves made at once (conversations run side by side)", async () => {
    const saved = await Promise.all([
      svc.saveAnswers({ age_18_plus: "Yes" }),
      svc.saveAnswers({ gov_official_relationship: "No" }),
    ]);
    expect(saved.every((r) => r.ok)).toBe(true);
    const check = await svc.checkAnswers();
    const unanswered = check.unanswered?.map((u) => u.id) ?? [];
    expect(unanswered).not.toContain("age_18_plus");
    expect(unanswered).not.toContain("gov_official_relationship");
    await svc.saveAnswers({ age_18_plus: null, gov_official_relationship: null });
  });

  it("remembers a card's answers: the form's wording as a variant, and a new entry for a new question", async () => {
    const items = [
      { answerId: "age_18_plus", question: "Are you at least eighteen?", value: "Yes" },
      { answerId: "Notice period", question: "What is your notice period?", value: "Two weeks" },
    ];
    expect(await svc.rememberAnswers(items)).toEqual({
      ok: true,
      set: ["age_18_plus", "notice_period"],
      created: ["notice_period"],
    });
    // Again: the entry is found by its id and the wording isn't added twice.
    await svc.rememberAnswers([{ ...(items[0] as (typeof items)[0]), question: "ARE you at least eighteen" }]);
    const text = await readFile(join(root, "ws/profile/answers.yaml"), "utf8");
    expect(text.startsWith("# Screening-question answer bank")).toBe(true);
    const a = await svc.answers();
    const entries = a.exists && a.valid ? a.value.entries : [];
    const age = entries.find((e) => e.id === "age_18_plus");
    expect(age).toMatchObject({ answer: "Yes" });
    expect(age?.variants.filter((v) => v === "Are you at least eighteen?")).toHaveLength(1);
    expect(entries.find((e) => e.id === "notice_period")).toMatchObject({
      canonical: "What is your notice period?",
      answer: "Two weeks",
    });
    await svc.saveAnswers({ age_18_plus: null, notice_period: null });
  });

  it("answers a question with a profile source from the profile, not as a screening question", async () => {
    await writeFile(
      join(root, "ws/profile/profile.yaml"),
      [
        "schemaVersion: 1",
        "identity: { firstName: Jane, lastName: Doe }",
        "contact: { email: jane@example.com }",
        "workAuthorization: { authorizedIn: [United States, Canada], requiresSponsorshipNow: false }",
        "languages: [{ language: English, proficiency: native }]",
      ].join("\n"),
    );
    const check = await svc.checkAnswers();
    const ids = check.unanswered?.map((u) => u.id) ?? [];
    expect(ids).not.toContain("sponsorship_now");
    expect(ids).toContain("age_18_plus");
    const from = Object.fromEntries((check.fromProfile ?? []).map((q) => [q.id, q.value]));
    expect(from).toMatchObject({
      authorized_to_work: "United States, Canada",
      sponsorship_now: "No",
      english_fluent: "English",
    });
    expect(from.sponsorship_future).toBeUndefined();
    expect(check.answered).toBe(0);
    await rm(join(root, "ws/profile/profile.yaml"));
  });

  it("says when a source isn't a profile path (who gave an answer isn't a source)", async () => {
    await writeFile(
      join(root, "ws/profile/answers.yaml"),
      [
        "schemaVersion: 1",
        "entries:",
        "  - { id: relocate, canonical: Are you willing to relocate?, answer: 'Yes', source: profile.jobPreferences.relocate }",
        "  - { id: newcomer, canonical: Are you a newcomer to Canada?, answer: 'No', source: user }",
      ].join("\n"),
    );
    expect((await svc.checkAnswers()).notProfileSources).toMatchObject({ ids: ["newcomer"] });
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
