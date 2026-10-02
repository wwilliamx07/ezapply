import type { Field, FormSchema } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import { checkReadBack, normLabel, type PlannedFill, planStep, strictMatch } from "../src/forms/autofill.js";
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
    sections: Object.entries(sections).map(([title, fields]) => ({ id: title.toLowerCase(), title, fields })),
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

  it("leaves work and education rows for now, and a row hint outside a row as a mismatch", () => {
    const f: Record<string, Field[]> = {
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
      ["work-experience-1.jobTitle", "row"],
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

  it("leaves sensitive, unanswered and computed answers to the model", () => {
    const q = (id: string, label: string) => field(id, { label, kind: "text" });
    const p = plan({
      Questions: [
        q("q.salary", "What are your salary expectations?"),
        q("q.relatives", "Do you have relatives employed here?"),
        q("q.relocate", "Are you willing to relocate?"),
      ],
    });
    expect([...p.left]).toEqual([
      ["q.salary", "sensitive"],
      ["q.relatives", "ask-user"],
      ["q.relocate", "from-profile"],
    ]);
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
  it("strictMatch takes exact, bare and parenthetical, nothing looser", () => {
    expect(strictMatch("python", "Python (Programming Language)")).toBe(true);
    expect(strictMatch("SQL", "Structured Query Language (SQL)")).toBe(true);
    expect(strictMatch("Yes", "Yes, I do")).toBe(false);
  });
  it("normLabel ignores case, punctuation and a required mark", () => {
    expect(normLabel("  Do you require   sponsorship? *")).toBe(normLabel("do you require sponsorship"));
    expect(normLabel("Email (required)")).toBe("email");
  });
});
