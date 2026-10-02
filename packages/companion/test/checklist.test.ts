import type { Field, FormSchema } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import { handoff, stepWarnings } from "../src/forms/checklist.js";
import { Profile } from "../src/profile/schema.js";

const profile = Profile.parse({
  schemaVersion: 1,
  identity: { firstName: "Jane", lastName: "Doe" },
  contact: { email: "j@example.com", address: { city: "Toronto", country: "Canada" } },
  links: { github: "https://github.com/jane" },
  work: [
    { company: "A", title: "Dev", start: "2024-05", end: "2024-08" },
    { company: "B", title: "Dev", start: "2025-05", end: null },
  ],
  education: [{ school: "Example U", degree: "BSc" }],
  languages: [
    { language: "English", proficiency: "native" },
    { language: "French", proficiency: "professional" },
  ],
});

const field = (id: string, f: Partial<Field> = {}): Field => ({
  id,
  label: id,
  required: false,
  kind: "text",
  currentValue: "",
  ...f,
});

function form(
  sections: { id: string; title: string; fields?: Field[] }[],
  addButtons: FormSchema["addButtons"],
  adapter = "workday",
): FormSchema {
  return {
    adapter,
    tabId: 1,
    url: "https://acme.wd5.myworkdayjobs.com/x/apply",
    pageKind: "step",
    sections: sections.map((s) => ({ fields: [], ...s })),
    addButtons,
    actions: [],
    errors: [],
  };
}

describe("stepWarnings", () => {
  it("compares each repeatable section's rows with the profile's list, both ways", () => {
    const f = form(
      [
        { id: "work-experience-1", title: "Work Experience 1" },
        { id: "education-1", title: "Education 1" },
        { id: "education-2", title: "Education 2" },
      ],
      [
        { id: "add.work-experience", label: "Add", section: "Work Experience" },
        { id: "add.education", label: "Add", section: "Education" },
        { id: "add.languages", label: "Add", section: "Languages" },
        { id: "add.websites", label: "Add", section: "Websites" },
      ],
    );
    expect(stepWarnings(f, profile, new Set())).toEqual([
      "Work Experience: the page has 1 row, the profile has 2 work entries.",
      "Education: the page has 2 rows, the profile has 1 education entries (left from a previous application?).",
      "Languages: the page has 0 rows, the profile has 2 languages.",
      "Websites: the page has 0 rows, the profile has 1 links besides LinkedIn.",
    ]);
  });

  it("counts Oracle's saved items, and skips an open form's Save button", () => {
    const f = form(
      [
        { id: "languages.item-1", title: "Languages: English" },
        { id: "languages.item-2", title: "Languages: French" },
      ],
      [
        { id: "add.language", label: "Add Language", section: "Languages" },
        { id: "save.languages", label: "Save", section: "Languages" },
      ],
      "oracle",
    );
    expect(stepWarnings(f, profile, new Set())).toEqual([]);
  });

  it("flags files this application didn't upload", () => {
    const f = form(
      [
        {
          id: "q",
          title: "Questions",
          fields: [field("q.resume", { kind: "file", label: "Resume/CV", currentValue: ["resume.pdf", "cover.pdf"] })],
        },
      ],
      [],
    );
    expect(stepWarnings(f, null, new Set(["resume.pdf"]))).toEqual([
      "Resume/CV holds cover.pdf, which this application didn't upload (left from a previous application? remove_items it).",
    ]);
  });
});

describe("handoff", () => {
  it("summarises the application from its log", () => {
    const h = handoff([
      { event: "fill", fieldId: "mi.first", value: "Jane", source: "profile", ok: true, auto: true, was: "Old" },
      { event: "fill", fieldId: "mi.country", value: "Canada", source: "profile", ok: true, auto: true },
      { event: "fill", fieldId: "q.salary", value: "60000", source: "user", ok: true },
      { event: "fill", fieldId: "q.relocate", value: "No", source: "judgment", ok: true },
      // corrected later by the user: the last fill counts
      { event: "fill", fieldId: "q.relocate", value: "Yes", source: "user", ok: true },
      { event: "fill", fieldId: "q.failed", value: "x", source: "judgment", ok: false },
      { event: "remove", fieldId: "q.cover", removed: ["cover.pdf"], ok: true, reason: "old" },
      { event: "step-check", step: "Experience", stepIndex: 2, warnings: ["Languages: the page has 0 rows"] },
      { event: "step-check", step: "Experience", stepIndex: 2, warnings: [] },
      { event: "step-check", step: "Questions", stepIndex: 3, warnings: ["Resume/CV holds old.pdf"] },
    ]);
    expect(h).toEqual({
      steps: [{ step: "3", warnings: ["Resume/CV holds old.pdf"] }],
      answersToFlag: [
        { fieldId: "q.salary", value: "60000", source: "user" },
        { fieldId: "q.relocate", value: "Yes", source: "user" },
      ],
      automatic: { mi: ['first = "Jane"', 'country = "Canada"'] },
      replaced: [{ fieldId: "mi.first", was: "Old", now: "Jane" }],
      removed: [{ what: 'q.cover: ["cover.pdf"]', reason: "old" }],
    });
  });
});
