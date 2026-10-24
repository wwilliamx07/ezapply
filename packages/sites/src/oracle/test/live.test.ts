// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPage, fieldsOf } from "../../../test/adapters.js";
import { oracle } from "../definition/site.js";

const extract = (doc: Document, url: string) => extractPage(oracle, doc, url);

const load = (name: string, url: string) => {
  const html = readFileSync(join(import.meta.dirname, "..", "fixtures", `${name}.html`), "utf8");
  document.body.outerHTML = html.replace(/^<!--[\s\S]*?-->\s*/, "");
  return extract(document, url).schema;
};

const JOB = "https://jobs.umbrella.example/en/sites/CX_1/job/10001";
describe("live Oracle snapshots", () => {
  it("recognises a job page and its Apply action", () => {
    expect(load("oracle-posting", JOB)).toMatchObject({
      adapter: "oracle",
      pageKind: "posting",
      actions: ["apply"],
      tenant: "jobs.umbrella.example/cx_1",
      sections: [],
    });
  });

  it("recognises the email step as sign-in, and never offers its bot trap", () => {
    const s = load("oracle-email", `${JOB}/apply/email`);
    expect(s).toMatchObject({ pageKind: "auth", nextLabel: "Next" });
    const ids = s.sections.flatMap((x) => x.fields.map((f) => f.id));
    expect(ids).toEqual(["main.primary-email", "main.legal-disclaimer-checkbox"]);
    expect(fieldsOf(s)["main.legal-disclaimer-checkbox"]).toMatchObject({
      kind: "checkbox",
      label: "I agree with the terms and conditions",
      required: true,
    });
  });

  it("reads the single-page application: every section, widget kinds, hints, and Submit as the only way on", () => {
    const s = load("oracle-apply", `${JOB}/apply/section/1`);
    expect(s).toMatchObject({
      pageKind: "step",
      nextLabel: "Submit",
      errors: [],
      actions: [],
      step: { title: "Personal Info · Job Application Questions · Experience and Skills · More About You" },
    });
    expect(s.backLabel).toBeUndefined();
    expect(s.addButtons.map((b) => b.id)).toEqual([
      "add.link",
      "add.experience",
      "add.education",
      "add.language",
      "add.license",
    ]);
    const f = fieldsOf(s);
    expect(f["resume-and-urls.resume"]).toMatchObject({ kind: "file", required: true, currentValue: [] });
    expect(f["resume-and-urls.cover-letter"]).toMatchObject({ kind: "file", required: false });
    expect(f["contact-information.lastName"]).toMatchObject({
      kind: "text",
      required: true,
      hint: { profileKey: "identity.lastName" },
    });
    expect(f["contact-information.title"]).toMatchObject({
      kind: "radio",
      options: ["Miss", "Mr.", "Mrs.", "Ms.", "Unknown"],
    });
    expect(f["contact-information.email"]?.helpText).toMatch(/read-only/i);
    expect(f["contact-information.phoneCountryCode"]).toMatchObject({
      kind: "dropdown",
      optionsLazy: true,
      required: true,
    });
    expect(f["contact-information.phoneNumber"]).toMatchObject({ kind: "text", required: true });
    expect(f["address.country"]).toMatchObject({ kind: "dropdown", hint: { profileKey: "contact.address.country" } });
    expect(f["address.region2"]).toMatchObject({ kind: "dropdown", label: "Province" });
    // Pill questions and native radios both read as radio; screening questions are keyed by their label.
    expect(f["application-questions.are-you-legally-authorized-to-work-in-ca"]).toMatchObject({
      kind: "radio",
      options: ["Yes", "No"],
      required: true,
    });
    expect(f["application-questions.where-did-you-first-hear-about-this-posi"]?.options).toHaveLength(8);
    expect(f["application-questions.what-is-your-expected-year-of-graduation"]).toMatchObject({
      kind: "date",
      dateParts: ["MM", "DD", "YYYY"],
      currentValue: null,
    });
    expect(f["application-questions.please-indicate-the-total-number-co-op-s"]?.kind).toBe("textarea");
    expect(f["diversity-information.CA-STANDARD-ORA_GENDER-STANDARD"]).toMatchObject({
      kind: "dropdown",
      hint: { profileKey: "eeo.gender" },
    });
    expect(f["additonal-documents.attachment"]).toMatchObject({ kind: "file", multiple: true });
    expect(f["more-about-you.job-alerts-checkbox"]).toMatchObject({ kind: "checkbox", currentValue: false });
    expect(Object.keys(f)).toHaveLength(46);
  });
});
