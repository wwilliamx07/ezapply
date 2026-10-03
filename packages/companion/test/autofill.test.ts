import type { Field, FormSchema } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import {
  checkReadBack,
  missingItems,
  normLabel,
  type PlannedFill,
  planStep,
  rowsToAdd,
  strictMatch,
} from "../src/forms/autofill.js";
import { chunkBySection } from "../src/forms/service.js";
import { AnswerEntry, Profile } from "../src/profile/schema.js";

const profile = Profile.parse({
  schemaVersion: 1,
  identity: { firstName: "Jane", lastName: "Doe" },
  contact: {
    email: "jane@example.com",
    phone: { countryCode: "+1", number: "4165550100", type: "mobile" },
    address: { city: "Toronto", region: "Ontario", country: "Canada" },
  },
  links: { linkedin: "https://linkedin.com/in/jane" },
  eeo: { gender: "Woman", veteranStatus: "decline" },
});

const answer = (e: Record<string, unknown>) => AnswerEntry.parse({ canonical: "placeholder", answer: null, ...e });
const answers = [
  answer({
    id: "sponsorship_now",
    canonical: "Do you require sponsorship?",
    answer: "No",
    variants: ["I do NOT require sponsorship"],
  }),
  answer({
    id: "how_heard",
    canonical: "How did you hear about us?",
    answer: { default: "Company Website", byCompany: { "ACME Corp": "Job Board > LinkedIn" } },
  }),
  answer({
    id: "salary_expectation",
    canonical: "What are your salary expectations?",
    answer: "100k",
    sensitive: true,
  }),
  answer({ id: "relatives_employed", canonical: "Do you have relatives employed here?", answer: null }),
  answer({
    id: "willing_to_relocate",
    canonical: "Are you willing to relocate?",
    answer: "Yes",
    source: "profile.jobPreferences.relocate",
  }),
  answer({ id: "previously_employed", canonical: "Have you previously worked for us?", answer: "No" }),
  answer({
    id: "visible_minority",
    canonical: "Do you identify as a visible minority?",
    answer: "No",
    source: "user",
  }),
  answer({ id: "graduation", canonical: "Expected graduation date", answer: "2030-04-30" }),
];

function field(id: string, f: Partial<Field> = {}): Field {
  return { id, label: id, required: false, kind: "text", currentValue: "", ...f };
}

function form(sections: Record<string, Field[]>): FormSchema {
  return {
    adapter: "workday",
    tabId: 1,
    url: "https://acme.wd5.myworkdayjobs.com/x/apply",
    pageKind: "step",
    sections: Object.entries(sections).map(([title, fields]) => ({
      id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      fields,
    })),
    addButtons: [],
    actions: [],
    errors: [],
  };
}

const plan = (sections: Record<string, Field[]>, company?: string) =>
  planStep({ form: form(sections), profile, answers, ...(company ? { company } : {}) });

describe("planStep", () => {
  it("fills hinted profile fields as stored, and keeps what's already right", () => {
    const p = plan({
      "My Information": [
        field("mi.firstName", { label: "First Name", hint: { profileKey: "identity.firstName" } }),
        field("mi.lastName", { label: "Last Name", currentValue: "Doe", hint: { profileKey: "identity.lastName" } }),
        field("mi.email", { label: "Email", currentValue: "old@example.com", hint: { profileKey: "contact.email" } }),
      ],
    });
    expect(p.fills).toEqual([
      {
        fieldId: "mi.firstName",
        label: "First Name",
        kind: "text",
        value: "Jane",
        source: "profile",
        rule: "hint:identity.firstName",
      },
      {
        fieldId: "mi.email",
        label: "Email",
        kind: "text",
        value: "jane@example.com",
        source: "profile",
        rule: "hint:contact.email",
        was: "old@example.com",
      },
    ]);
    expect(p.kept).toEqual([{ fieldId: "mi.lastName", rule: "hint:identity.lastName" }]);
  });

  it("picks the phone country option by the country (Canada and the US share +1) and capitalises the type", () => {
    const p = plan({
      Phone: [
        field("p.code", { kind: "dropdown", currentValue: null, hint: { profileKey: "contact.phone.countryCode" } }),
        field("p.type", { kind: "dropdown", currentValue: null, hint: { profileKey: "contact.phone.type" } }),
      ],
    });
    expect(p.fills.map((f) => f.value)).toEqual(["Canada", "Mobile"]);
  });

  it("leaves a row hint outside a row as a mismatch, and a row with no profile entry as extra", () => {
    const f: Record<string, Field[]> = {
      // The profile has no work entries: the row is one too many.
      "Work Experience 1": [field("work-experience-1.jobTitle", { hint: { profileKey: "work[].title" } })],
      "Application Questions": [
        field("application-questions.startDate", {
          kind: "date",
          currentValue: null,
          hint: { profileKey: "work[].start" },
        }),
      ],
    };
    expect([...plan(f).left]).toEqual([
      ["work-experience-1.jobTitle", "extra-row"],
      ["application-questions.startDate", "section-mismatch"],
    ]);
  });

  it("never fills contact hints in a section about someone else", () => {
    const p = plan({ "Professional References": [field("ref.email", { hint: { profileKey: "contact.email" } })] });
    expect(p.left.get("ref.email")).toBe("section-mismatch");
  });

  it("matches answers by exact wording, so a reversed question never takes the other's answer", () => {
    const radio = (id: string, label: string) =>
      field(id, { label, kind: "radio", options: ["Yes", "No"], currentValue: null });
    const p = plan({
      Questions: [
        radio("q.a", "Do you require sponsorship? *"),
        // A saved variant phrased the other way: its yes is the entry's no, which only the model flips.
        radio("q.b", "I do not require sponsorship"),
        radio("q.c", "Do you NOT require sponsorship?"),
      ],
    });
    expect(p.fills.map((f) => [f.fieldId, f.value, f.rule])).toEqual([["q.a", "No", "answer:sponsorship_now"]]);
    expect(p.left.get("q.b")).toBe("reversed-wording");
    expect(p.left.get("q.c")).toBe("no-rule");
  });

  it("uses the company's own answer before the default, and fills an empty typeahead", () => {
    const f = {
      Source: [field("s.source", { kind: "typeahead", currentValue: [], hint: { profileKey: "answers.how_heard" } })],
    };
    expect(plan(f, "acme corp").fills[0]).toMatchObject({ value: "Job Board > LinkedIn", answerId: "how_heard" });
    expect(plan(f, "Globex").fills[0]).toMatchObject({ value: "Company Website" });
  });

  it("leaves sensitive and unanswered answers to the model", () => {
    const q = (id: string, label: string) => field(id, { label, kind: "text" });
    const p = plan({
      Questions: [
        q("q.salary", "What are your salary expectations?"),
        q("q.relatives", "Do you have relatives employed here?"),
      ],
    });
    expect([...p.left]).toEqual([
      ["q.salary", "sensitive"],
      ["q.relatives", "ask-user"],
    ]);
  });

  it("uses a computed entry's stored answer when the profile doesn't settle it", () => {
    // jobPreferences.relocate isn't set in this profile; the entry's own answer stands.
    const p = plan({ Questions: [field("q.relocate", { label: "Are you willing to relocate?" })] });
    expect(p.fills).toEqual([expect.objectContaining({ value: "Yes", source: "answer-bank" })]);
  });

  it("sends a listed option's exact text, and leaves a near match alone", () => {
    const p = plan({
      Questions: [
        field("q.prev", {
          label: "Have you previously worked for us?",
          kind: "radio",
          options: ["Yes, as an employee", "No (never)"],
          currentValue: null,
        }),
        field("q.spons", {
          label: "Do you require sponsorship?",
          kind: "radio",
          options: ["Yes", "Nope, I don't"],
          currentValue: null,
        }),
      ],
    });
    expect(p.fills.map((f) => f.value)).toEqual(["No (never)"]);
    expect(p.left.get("q.spons")).toBe("no-strict-match");
  });

  it("fills EEO answers only from the profile, and leaves unset and decline to the model", () => {
    const eeo = (id: string, key: string) =>
      field(id, { kind: "dropdown", currentValue: null, hint: { profileKey: key } });
    const p = plan({
      "Voluntary Disclosures": [
        eeo("v.gender", "eeo.gender"),
        eeo("v.race", "eeo.race"),
        eeo("v.vet", "eeo.veteranStatus"),
      ],
    });
    expect(p.fills.map((f) => [f.fieldId, f.value])).toEqual([["v.gender", "Woman"]]);
    expect([...p.left]).toEqual([
      ["v.race", "eeo-unset"],
      ["v.vet", "eeo-decline"],
    ]);
  });

  it("leaves files, passwords, lists with entries, and unset profile values", () => {
    const p = plan({
      Misc: [
        field("m.resume", { kind: "file", currentValue: [] }),
        field("m.pw", { kind: "password" }),
        field("m.skills", { kind: "typeahead", currentValue: ["Java"] }),
        field("m.middle", { hint: { profileKey: "identity.middleName" } }),
      ],
    });
    expect([...p.left.values()]).toEqual(["file", "password", "multi-select", "not-in-profile"]);
  });

  it("doesn't plan fields already handled in this call", () => {
    const f = { A: [field("a.first", { hint: { profileKey: "identity.firstName" } })] };
    expect(planStep({ form: form(f), profile, answers, skip: new Set(["a.first"]) }).fills).toEqual([]);
  });
});

describe("planStep, from the first live run (Hooli, 2026-10-01)", () => {
  it("uses an answer whose source says where it came from (user), not a profile path", () => {
    const p = plan({
      Questions: [
        field("q.vm", {
          label:
            "Do you identify as a visible minority (including people who are Black, Asian, Middle Eastern, mixed race, etc.)?",
          kind: "dropdown",
          currentValue: null,
        }),
      ],
    });
    // The parenthetical examples don't stop the match either.
    expect(p.fills).toEqual([expect.objectContaining({ value: "No", answerId: "visible_minority" })]);
  });

  it("fills a stored date into a date field", () => {
    const p = plan({
      Questions: [
        field("q.grad", {
          label: "Expected graduation date (complete your studies)",
          kind: "date",
          currentValue: null,
        }),
      ],
    });
    expect(p.fills).toEqual([expect.objectContaining({ value: "2030-04-30", kind: "date" })]);
  });
});

const full = Profile.parse({
  schemaVersion: 1,
  identity: { firstName: "Jane", lastName: "Doe" },
  contact: { email: "jane@example.com", address: { city: "Toronto", country: "Canada" } },
  links: { linkedin: "https://linkedin.com/in/jane", github: "https://github.com/jane" },
  workAuthorization: {
    authorizedIn: ["Canada"],
    requiresSponsorshipNow: false,
    requiresSponsorshipFuture: true,
  },
  jobPreferences: { relocate: true, workMode: "remote", earliestStart: "2027-01", willingToTravelPercent: 25 },
  work: [
    { company: "Acme", title: "Developer", start: "2024-12", end: null, highlights: ["Built a thing", "Shipped it"] },
    { company: "Globex", title: "Intern", start: "2022-05", end: "2022-08" },
  ],
  education: [
    { school: "Example University", degree: "Bachelor of Science", field: "Physics (Co-op)", gpa: "3.9" },
  ],
  languages: [
    { language: "English", proficiency: "native" },
    { language: "French", proficiency: "fluent" },
    { language: "German", proficiency: "conversational" },
  ],
});

/** The live Hooli "My Experience" step (2026-10-02, from its debug record): ids, labels, kinds and hints, emptied. */
function myExperience(rows: { work: number; education: number; languages: number; websites: number }): FormSchema {
  const sections: FormSchema["sections"] = [];
  const f = (section: string, key: string, label: string, kind: Field["kind"], extra: Partial<Field> = {}): Field => ({
    id: `${section}.${key}`,
    automationId: `formField-${key}`,
    label,
    required: false,
    kind,
    currentValue: kind === "checkbox" ? false : kind === "typeahead" ? [] : kind === "text" ? "" : null,
    ...extra,
  });
  for (let i = 1; i <= rows.work; i++) {
    const s = `work-experience-${i}`;
    sections.push({
      id: s,
      title: `Work Experience ${i}`,
      fields: [
        f(s, "jobTitle", "Job Title", "text", { hint: { profileKey: "work[].title" } }),
        f(s, "companyName", "Company", "text", { hint: { profileKey: "work[].company" } }),
        f(s, "location", "Location", "text", { hint: { profileKey: "work[].location" } }),
        f(s, "currentlyWorkHere", "I currently work here", "checkbox", {
          hint: { profileKey: "work[].end (null = current)" },
        }),
        f(s, "startDate", "From", "date", { dateParts: ["MM", "YYYY"], hint: { profileKey: "work[].start" } }),
        f(s, "endDate", "To", "date", { dateParts: ["MM", "YYYY"], hint: { profileKey: "work[].end" } }),
        f(s, "roleDescription", "Role Description", "textarea", { hint: { profileKey: "work[].highlights" } }),
      ],
    });
  }
  for (let i = 1; i <= rows.education; i++) {
    const s = `education-${i}`;
    sections.push({
      id: s,
      title: `Education ${i}`,
      fields: [
        f(s, "schoolName", "School or University", "text", { hint: { profileKey: "education[].school" } }),
        f(s, "degree", "Degree", "dropdown", { hint: { profileKey: "education[].degree" } }),
        f(s, "fieldOfStudy", "Field of Study", "typeahead", { hint: { profileKey: "education[].field" } }),
        f(s, "gradeAverage", "Overall Result (GPA)", "text", { hint: { profileKey: "education[].gpa" } }),
        f(s, "firstYearAttended", "From", "date", { dateParts: ["YYYY"] }),
        f(s, "lastYearAttended", "To (Actual or Expected)", "date", { dateParts: ["YYYY"] }),
      ],
    });
  }
  const levels = { a1: "Comprehension", a2: "Overall", a3: "Reading", a4: "Speaking", a5: "Writing" };
  for (let i = 1; i <= rows.languages; i++) {
    const s = `languages-${i}`;
    sections.push({
      id: s,
      title: `Languages ${i}`,
      fields: [
        f(s, "language", "Language", "dropdown"),
        f(s, "native", "I am fluent in this language.", "checkbox"),
        ...Object.entries(levels).map(([k, label]) => f(s, `cdfe8233fb99${k}`, label, "dropdown")),
      ],
    });
  }
  sections.push({
    id: "skills",
    title: "Skills",
    fields: [f("skills", "skills", "Type to Add Skills", "typeahead", { multiple: true })],
  });
  for (let i = 1; i <= rows.websites; i++) {
    const s = `websites-${i}`;
    sections.push({
      id: s,
      title: `Websites ${i}`,
      fields: [f(s, "url", "URL", "text", { hint: { profileKey: "links.portfolio" } })],
    });
  }
  sections.push({
    id: "social-network-urls",
    title: "Social Network URLs",
    fields: [
      f("social-network-urls", "linkedInAccount", "Please provide your LinkedIn profile:", "text", {
        hint: { profileKey: "links.linkedin" },
      }),
    ],
  });
  return {
    adapter: "workday",
    tabId: 1,
    url: "https://hooli.wd3.myworkdayjobs.com/x/apply",
    pageKind: "step",
    step: { index: 2, total: 6, title: "My Experience" },
    sections,
    addButtons: [
      { id: "add.work-experience", label: rows.work ? "Add Another" : "Add", section: "Work Experience" },
      { id: "add.education", label: "Add", section: "Education", kind: "row" },
      { id: "add.languages", label: "Add", section: "Languages" },
      { id: "add.websites", label: "Add", section: "Websites" },
    ],
    actions: [],
    errors: [],
  };
}

/** The live level list (Workday, Hooli): ranked, so "Fluent" names "5 - Fluent". */
const LIVE_LEVELS = ["1 - Beginner", "2 - Classroom Study", "3 - Intermediate", "4 - Advanced", "5 - Fluent"];
const LIVE_DEGREES = ["None", "High School Diploma/GED", "Associate's Degree/College Diploma", "Bachelor's Degree"];

describe("rows (the live Hooli My Experience step)", () => {
  it("adds the rows the profile needs, the website rows without LinkedIn (the page has its own field)", () => {
    expect(rowsToAdd(myExperience({ work: 0, education: 0, languages: 0, websites: 0 }), full)).toEqual([
      { addButtonId: "add.work-experience", list: "work", count: 2 },
      { addButtonId: "add.education", list: "education", count: 1 },
      { addButtonId: "add.languages", list: "languages", count: 3 },
      { addButtonId: "add.websites", list: "links", count: 1 },
    ]);
    expect(rowsToAdd(myExperience({ work: 2, education: 1, languages: 3, websites: 1 }), full)).toEqual([]);
  });

  it("fills each row from its entry, formatted for the widget, and lists options where wordings differ", () => {
    const form = myExperience({ work: 2, education: 1, languages: 3, websites: 1 });
    const first = planStep({ form, profile: full, answers: [] });
    // The degree and the levels need their options; the language names don't.
    expect([...first.needOptions.keys()]).toEqual([
      "formField-degree",
      "formField-cdfe8233fb99a1",
      "formField-cdfe8233fb99a2",
      "formField-cdfe8233fb99a3",
      "formField-cdfe8233fb99a4",
      "formField-cdfe8233fb99a5",
    ]);
    const options = new Map<string, string[] | null>([
      ["formField-degree", LIVE_DEGREES],
      ...Object.keys({ a1: 0, a2: 0, a3: 0, a4: 0, a5: 0 }).map(
        (k) => [`formField-cdfe8233fb99${k}`, LIVE_LEVELS] as [string, string[]],
      ),
    ]);
    const p = planStep({ form, profile: full, answers: [], options });
    const fills = Object.fromEntries(p.fills.map((f) => [f.fieldId, [f.value, f.rule]]));
    expect(fills).toMatchObject({
      "work-experience-1.jobTitle": ["Developer", "row:work[0].title"],
      "work-experience-1.currentlyWorkHere": [true, "row:work[0].current"],
      "work-experience-1.startDate": ["2024-12", "row:work[0].start"],
      "work-experience-1.roleDescription": ["Built a thing\nShipped it", "row:work[0].highlights"],
      "work-experience-2.companyName": ["Globex", "row:work[1].company"],
      "work-experience-2.endDate": ["2022-08", "row:work[1].end"],
      "education-1.degree": ["Bachelor's Degree", "row:education[0].degree"],
      "education-1.fieldOfStudy": ["Physics", "row:education[0].field"],
      "languages-1.language": ["English", "row:languages[0].language"],
      "languages-1.native": [true, "row:languages[0].native"],
      // Native: no "Native" on this list, so the next wording it holds.
      "languages-1.cdfe8233fb99a1": ["5 - Fluent", "row:languages[0].level"],
      "languages-2.native": [true, "row:languages[1].native"],
      "languages-3.cdfe8233fb99a3": ["3 - Intermediate", "row:languages[2].level"],
      "websites-1.url": ["https://github.com/jane", "row:links[0].url"],
    });
    // Unset: the current job's end date, a location, education years; already right: German isn't native.
    expect(p.left.get("work-experience-1.endDate")).toBe("not-in-profile");
    expect(p.left.get("work-experience-1.location")).toBe("not-in-profile");
    expect(p.left.get("education-1.firstYearAttended")).toBe("not-in-profile");
    expect(p.kept).toContainEqual({ fieldId: "languages-3.native", rule: "row:languages[2].native" });
    expect(p.left.get("skills.skills")).toBe("multi-select");
    expect(p.needOptions.size).toBe(0);
  });

  it("takes education years by their labels, as a year", () => {
    const withYears = Profile.parse({
      ...full,
      education: [{ school: "Example U", degree: "BSc", start: "2026-09", end: "2030-04" }],
    });
    const p = planStep({
      form: myExperience({ work: 0, education: 1, languages: 0, websites: 0 }),
      profile: withYears,
      answers: [],
    });
    const fills = Object.fromEntries(p.fills.map((f) => [f.fieldId, f.value]));
    expect(fills).toMatchObject({ "education-1.firstYearAttended": "2026", "education-1.lastYearAttended": "2030" });
  });

  it("matches rows to entries by company first, and leaves rows beyond the profile", () => {
    const form = myExperience({ work: 3, education: 0, languages: 0, websites: 0 });
    // Row 1 holds the second job (pre-filled from the last application).
    const row1 = form.sections[0]?.fields.find((x) => x.id === "work-experience-1.companyName") as Field;
    row1.currentValue = "Globex";
    const p = planStep({ form, profile: full, answers: [] });
    const titles = p.fills.filter((f) => f.fieldId.endsWith("jobTitle")).map((f) => [f.fieldId, f.value]);
    expect(titles).toEqual([
      ["work-experience-1.jobTitle", "Intern"],
      ["work-experience-2.jobTitle", "Developer"],
    ]);
    expect(p.kept).toContainEqual({ fieldId: "work-experience-1.companyName", rule: "row:work[1].company" });
    expect(p.left.get("work-experience-3.jobTitle")).toBe("extra-row");
  });

  it("keeps a level already set to one of its wordings without listing options, and misses no level silently", () => {
    const form = myExperience({ work: 0, education: 0, languages: 1, websites: 0 });
    const level = form.sections[0]?.fields[2] as Field;
    level.currentValue = "5 - Fluent";
    const p = planStep({
      form,
      profile: full,
      answers: [],
      // A list with none of the wordings: left with no-strict-match, nothing sent.
      options: new Map([["formField-cdfe8233fb99a2", ["Good", "Bad"]]]),
    });
    expect(p.kept).toContainEqual({ fieldId: level.id, rule: "row:languages[0].level" });
    expect(p.left.get("languages-1.cdfe8233fb99a2")).toBe("no-strict-match");
    expect(p.needOptions.has("formField-cdfe8233fb99a1")).toBe(false);
  });
});

describe("links and Oracle items", () => {
  const oracle = (sections: FormSchema["sections"], addButtons: FormSchema["addButtons"] = []): FormSchema => ({
    adapter: "oracle",
    tabId: 1,
    url: "https://jobs.acme.com/en/sites/CX_1/job/1/apply/section/1",
    pageKind: "step",
    sections,
    addButtons,
    actions: [],
    errors: [],
  });

  it("puts links into Oracle's Link fields, LinkedIn first (the page has no field of its own), and adds one", () => {
    const form = oracle(
      [
        {
          id: "resume-and-urls",
          title: "Resume and URLs",
          fields: [field("resume-and-urls.siteLink-1", { label: "Link 1", currentValue: "https://github.com/jane/" })],
        },
      ],
      [{ id: "add.link", label: "Add Another Link", section: "Resume and URLs", kind: "row" }],
    );
    expect(rowsToAdd(form, full)).toEqual([{ addButtonId: "add.link", list: "links", count: 1 }]);
    form.sections[0]?.fields.push(field("resume-and-urls.siteLink-2", { label: "Link 2" }));
    const p = planStep({ form, profile: full, answers: [] });
    // Link 1 already holds GitHub (a trailing slash aside), so LinkedIn goes into Link 2.
    expect(p.kept).toEqual([{ fieldId: "resume-and-urls.siteLink-1", rule: "link:links[1].url" }]);
    expect(p.fills).toEqual([
      expect.objectContaining({ fieldId: "resume-and-urls.siteLink-2", value: "https://linkedin.com/in/jane" }),
    ]);
  });

  it("finds the entries no saved item names, and plans an opened item form for one", () => {
    const form = oracle(
      [
        { id: "languages.item-1", title: "Languages: French, Fluent", fields: [], removable: true, saved: true },
        {
          id: "work-and-education-history.experience-1",
          title: "Work and Education History: Acme, Developer",
          fields: [],
          removable: true,
          saved: true,
        },
      ],
      [
        { id: "add.experience", label: "Add Experience", section: "Work and Education History", kind: "form" },
        { id: "add.education", label: "Add Education", section: "Work and Education History", kind: "form" },
        { id: "add.language", label: "Add Language", section: "Languages", kind: "form" },
      ],
    );
    expect(missingItems(form, full).map((m) => [m.list, m.addButtonId, m.index, m.name])).toEqual([
      ["work", "add.experience", 1, "Globex"],
      ["education", "add.education", 0, "Example University"],
      ["languages", "add.language", 0, "English"],
      ["languages", "add.language", 2, "German"],
    ]);

    form.sections.push({
      id: "languages",
      title: "Languages",
      fields: [
        field("languages.language", { label: "Language", kind: "dropdown", currentValue: null }),
        field("languages.readingLevel", {
          label: "Reading Level",
          kind: "radio",
          options: ["Basic", "Fluent"],
          currentValue: null,
        }),
      ],
    });
    const item = {
      list: "languages" as const,
      index: 0,
      fieldIds: new Set(["languages.language", "languages.readingLevel"]),
    };
    const p = planStep({ form, profile: full, answers: [], item });
    expect(p.fills.map((f) => [f.fieldId, f.value, f.rule])).toEqual([
      ["languages.language", "English", "item:languages[0].language"],
      // Native: the pills hold no "Native", so the first wording they do.
      ["languages.readingLevel", "Fluent", "item:languages[0].level"],
    ]);
  });
});

describe("rows and items, edge cases", () => {
  it("names a saved item only by whole words, and never puts a date into a text field", () => {
    const short = Profile.parse({ ...full, work: [{ company: "A", title: "Dev", start: "2024-01", end: null }] });
    const oracleForm: FormSchema = {
      adapter: "oracle",
      tabId: 1,
      url: "https://jobs.acme.com/en/sites/CX_1/job/1/apply/section/1",
      pageKind: "step",
      sections: [
        {
          id: "work-and-education-history.experience-1",
          title: "Work and Education History: Alpha Corp, Analyst",
          fields: [],
          removable: true,
          saved: true,
        },
      ],
      addButtons: [
        { id: "add.experience", label: "Add Experience", section: "Work and Education History", kind: "form" },
      ],
      actions: [],
      errors: [],
    };
    expect(missingItems(oracleForm, short).map((m) => m.name)).toEqual(["A"]);

    const p = planStep({
      form: form({ "Work Experience 1": [field("work-experience-1.start", { label: "Start Date", kind: "text" })] }),
      profile: short,
      answers: [],
    });
    expect(p.left.get("work-experience-1.start")).toBe("no-rule");
  });
});

describe("answers computed from the profile", () => {
  const entry = (id: string, source: string, canonical: string) => answer({ id, source, canonical, answer: null });
  const computed = [
    entry("sponsorship_now", "profile.workAuthorization.requiresSponsorshipNow", "Do you now require sponsorship?"),
    entry("sponsorship_future", "profile.workAuthorization.requiresSponsorshipFuture", "Will you require sponsorship?"),
    entry("authorized", "profile.workAuthorization.authorizedIn", "Are you legally authorized to work in Canada?"),
    entry("authorized_here", "profile.workAuthorization.authorizedIn", "Are you authorized to work in this country?"),
    entry("relocate", "profile.jobPreferences.relocate", "Are you willing to relocate?"),
    entry("onsite", "profile.jobPreferences.workMode", "Can you work on site?"),
    entry("travel", "profile.jobPreferences.willingToTravelPercent", "Are you willing to travel?"),
    entry("start", "profile.jobPreferences.earliestStart", "When can you start?"),
    entry("english", "profile.languages", "Are you fluent in English?"),
    entry("german", "profile.languages", "Are you fluent in German?"),
    entry("degree", "profile.education", "Have you completed your degree?"),
  ];
  const yn = (id: string, label: string) =>
    field(id, { label, kind: "radio", options: ["Yes", "No"], currentValue: null });
  const run = (location?: string) =>
    planStep({
      form: form({
        Q: [
          yn("q.now", "Do you now require sponsorship?"),
          yn("q.future", "Will you require sponsorship?"),
          yn("q.auth", "Are you legally authorized to work in Canada?"),
          yn("q.here", "Are you authorized to work in this country?"),
          yn("q.relocate", "Are you willing to relocate?"),
          yn("q.onsite", "Can you work on site?"),
          yn("q.travel", "Are you willing to travel?"),
          field("q.start", { label: "When can you start?", kind: "date", currentValue: null }),
          yn("q.english", "Are you fluent in English?"),
          yn("q.german", "Are you fluent in German?"),
          yn("q.degree", "Have you completed your degree?"),
        ],
      }),
      profile: full,
      answers: computed,
      ...(location ? { location } : {}),
    });

  it("computes what the profile settles, and leaves the rest", () => {
    const p = run();
    expect(Object.fromEntries(p.fills.map((f) => [f.fieldId, [f.value, f.source, f.rule]]))).toEqual({
      "q.now": ["No", "computed", "computed:sponsorship_now"],
      "q.future": ["Yes", "computed", "computed:sponsorship_future"],
      "q.auth": ["Yes", "computed", "computed:authorized"],
      "q.relocate": ["Yes", "computed", "computed:relocate"],
      "q.start": ["2027-01", "computed", "computed:start"],
      "q.english": ["Yes", "computed", "computed:english"],
      "q.german": ["No", "computed", "computed:german"],
    });
    // No country named and no location; a remote preference; 25 % travel; whether a degree counts.
    expect(p.left.get("q.here")).toBe("from-profile");
    expect(p.left.get("q.onsite")).toBe("from-profile");
    expect(p.left.get("q.travel")).toBe("from-profile");
    expect(p.left.get("q.degree")).toBe("from-profile");
  });

  it("takes the job's country from the posting's location, and never answers for another country", () => {
    expect(run("Toronto, ON, Canada").fills.find((f) => f.fieldId === "q.here")?.value).toBe("Yes");
    expect(run("Seattle, WA, USA").left.get("q.here")).toBe("from-profile");
    expect(run("Toronto, Canada / New York, United States").left.get("q.here")).toBe("from-profile");
    // "us" in a sentence isn't the United States.
    expect(run("Join us in Canada").fills.find((f) => f.fieldId === "q.here")?.value).toBe("Yes");
  });
});

describe("checkReadBack", () => {
  const fill = (value: PlannedFill["value"], kind: PlannedFill["kind"] = "dropdown"): PlannedFill => ({
    fieldId: "f",
    label: "F",
    kind,
    value,
    source: "answer-bank",
    rule: "answer:x",
  });
  it("accepts the option itself or its bare name, and refuses a loose match", () => {
    expect(checkReadBack(fill("Canada"), { fieldId: "f", ok: true, readBack: "Canada (+1)" })).toEqual({ ok: true });
    expect(checkReadBack(fill("Yes"), { fieldId: "f", ok: true, readBack: "Yes, I will require sponsorship" })).toEqual(
      {
        ok: false,
        selected: "Yes, I will require sponsorship",
      },
    );
    expect(checkReadBack(fill("Job Board > LinkedIn"), { fieldId: "f", ok: true, readBack: ["LinkedIn"] })).toEqual({
      ok: true,
    });
    expect(checkReadBack(fill("x"), { fieldId: "f", ok: false, error: "No option matches" })).toEqual({ ok: false });
    // A date reads back in the page's own format.
    expect(checkReadBack(fill("2030-04-30", "date"), { fieldId: "f", ok: true, readBack: "04/30/2030" })).toEqual({
      ok: true,
    });
  });
});

describe("matching helpers", () => {
  it("strictMatch takes exact, bare, parenthetical and unranked, nothing looser", () => {
    expect(strictMatch("python", "Python (Programming Language)")).toBe(true);
    expect(strictMatch("SQL", "Structured Query Language (SQL)")).toBe(true);
    expect(strictMatch("Fluent", "5 - Fluent")).toBe(true);
    expect(strictMatch("Bachelor's Degree", "Bachelor’s degree")).toBe(true);
    expect(strictMatch("Yes", "Yes, I do")).toBe(false);
    expect(strictMatch("Fluent", "Not fluent")).toBe(false);
  });
  it("chunkBySection keeps sections whole", () => {
    const fills = ["a.1", "a.2", "b.1", "b.2", "b.3", "c.1"].map((fieldId) => ({ fieldId }));
    expect(chunkBySection(fills, 3).map((c) => c.map((f) => f.fieldId))).toEqual([
      ["a.1", "a.2"],
      ["b.1", "b.2", "b.3"],
      ["c.1"],
    ]);
  });
  it("normLabel ignores case, punctuation and a required mark", () => {
    expect(normLabel("  Do you require   sponsorship? *")).toBe(normLabel("do you require sponsorship"));
    expect(normLabel("Email (required)")).toBe("email");
  });
});
