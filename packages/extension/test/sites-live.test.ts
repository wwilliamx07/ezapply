// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAdapter } from "../src/adapters/engine/api.js";
import type { SiteDefinition } from "../src/adapters/engine/types.js";
import { ashby } from "../src/adapters/sites/ashby/site.js";
import { greenhouse } from "../src/adapters/sites/greenhouse/site.js";
import { lever } from "../src/adapters/sites/lever/site.js";
import { extractPage } from "./adapters.js";

/** A live page saved as a fixture (test/fixtures/live), read by a site's definition. */
const load = (site: SiteDefinition, name: string, url: string) => {
  const html = readFileSync(join(import.meta.dirname, "fixtures", "live", `${name}.html`), "utf8");
  document.documentElement.innerHTML = html.replace(/^<!--[\s\S]*?-->\s*/, "");
  return extractPage(site, document, url).schema;
};
const fieldsOf = (s: ReturnType<typeof load>) =>
  Object.fromEntries(s.sections.flatMap((x) => x.fields).map((f) => [f.id, f]));

describe("live Greenhouse application (job-boards.greenhouse.io)", () => {
  const s = load(greenhouse, "greenhouse-apply", "https://job-boards.greenhouse.io/vandelay/jobs/1000000001");
  const f = fieldsOf(s);

  it("reads the one-page application: Submit the only way on, the board and job from the URL", () => {
    expect(s).toMatchObject({
      adapter: "greenhouse",
      tenant: "vandelay",
      pageKind: "step",
      lastPage: true,
      nextLabel: "Submit application",
      errors: [],
      job: { title: "Account Executive" },
    });
    expect(s.backLabel).toBeUndefined();
  });

  it("reads each kind of field with its prompt, and hints Greenhouse's own fields", () => {
    expect(f["application.first_name"]).toMatchObject({
      kind: "text",
      label: "First Name",
      required: true,
      hint: { profileKey: "identity.firstName" },
    });
    // react-select lists, the phone's country among them; options come from list_options.
    expect(f["application.country"]).toMatchObject({ kind: "dropdown", optionsLazy: true, label: "Country" });
    expect(f["application.phone"]).toMatchObject({ kind: "text", hint: { profileKey: "contact.phone.number" } });
    expect(f["application.resume-cv"]).toMatchObject({ kind: "file", label: "Resume/CV", required: true });
    expect(f["application.linkedin-profile"]?.hint).toEqual({ profileKey: "links.linkedin" });
    // Custom questions are keyed by their prompt, not Greenhouse's numbers.
    expect(f["application.will-you-now-or-in-the-future-require-sp"]).toMatchObject({
      kind: "dropdown",
      required: true,
    });
    // The EEO block has its own heading.
    expect(f["voluntary-self-identification.gender"]?.hint).toEqual({ profileKey: "eeo.gender" });
  });

  it("never reads the phone flag picker's search box as a field", () => {
    expect(Object.keys(f).some((id) => /search/.test(id))).toBe(false);
  });
});

describe("live Lever application (jobs.lever.co/…/apply)", () => {
  const s = load(lever, "lever-apply", "https://jobs.lever.co/wonka/5c1e7a2b-0000-4000-8000-000000000001/apply");
  const f = fieldsOf(s);

  it("reads the one-page application, sectioned by its cards", () => {
    expect(s).toMatchObject({
      adapter: "lever",
      tenant: "wonka",
      pageKind: "step",
      lastPage: true,
      step: { title: "Mobile Engineer" },
      job: { title: "Mobile Engineer" },
    });
    expect(s.sections.map((x) => x.title)).toEqual(
      expect.arrayContaining(["Submit your application", "Links", "Demographic Survey"]),
    );
  });

  it("reads native lists, radio and checkbox groups, the location search, and prompts without the mark", () => {
    expect(f["submit-your-application.name"]).toMatchObject({
      kind: "text",
      label: "Full name",
      required: true,
      hint: { profileKey: "identity.fullName" },
    });
    expect(f["submit-your-application.location"]).toMatchObject({ kind: "typeahead", required: true });
    expect(f["submit-your-application.pronouns"]).toMatchObject({ kind: "checkbox-group", multiple: true });
    expect(f["links.urls-github"]?.hint).toEqual({ profileKey: "links.github" });
    const radio = Object.values(f).find((x) => x.kind === "radio");
    expect(radio?.options?.length).toBeGreaterThan(1);
    // A lone consent checkbox is asked by its own label.
    const consent = Object.values(f).find((x) => x.id.endsWith(".consent-marketing"));
    expect(consent).toMatchObject({ kind: "checkbox", label: expect.stringMatching(/consent to contact me/) });
    // Survey questions are keyed by their prompt, not Lever's ids.
    expect(Object.keys(f).some((id) => /surveysresponses/.test(id))).toBe(false);
  });
});

describe("live Ashby application (jobs.ashbyhq.com/…/application)", () => {
  const s = load(
    ashby,
    "ashby-apply",
    "https://jobs.ashbyhq.com/stark/7d2e9b14-0000-4000-8000-000000000002/application",
  );
  const f = fieldsOf(s);

  it("reads the application tab: Submit Application the only way on", () => {
    expect(s).toMatchObject({ adapter: "ashby", tenant: "stark", pageKind: "step", lastPage: true });
    expect(s.nextLabel).toBe("Submit Application");
    expect(s.job).toEqual({ title: "Security Engineer" });
  });

  it("reads Ashby's own fields by path, Yes/No buttons as a choice, and the phone's texting consent apart", () => {
    expect(f["application.name"]).toMatchObject({ label: "Legal Name", hint: { profileKey: "identity.fullName" } });
    expect(f["application.email"]?.hint).toEqual({ profileKey: "contact.email" });
    expect(f["application.phone"]).toMatchObject({ kind: "text", hint: { profileKey: "contact.phone.number" } });
    expect(f["application.location"]).toMatchObject({ kind: "typeahead" });
    expect(f["application.resume"]).toMatchObject({ kind: "file", required: true });
    const yesNo = Object.values(f).find((x) => x.label.startsWith("Do you have a minimum of 7 years"));
    expect(yesNo).toMatchObject({ kind: "radio", options: ["Yes", "No"] });
    expect(f["application.texting-consent"]).toMatchObject({ kind: "radio" });
    // The "Autofill from resume" box isn't a field: uploading there makes Ashby read the file.
    expect(
      Object.values(f)
        .filter((x) => x.kind === "file")
        .map((x) => x.label),
    ).toEqual(["Resume", "Cover Letter"]);
  });
});

describe("live Ashby application with radio and checkbox groups (jobs.ashbyhq.com/wayne/…)", () => {
  const url = "https://jobs.ashbyhq.com/wayne/9f3c6d21-0000-4000-8000-000000000003/application";
  const s = load(ashby, "ashby-groups", url);
  const f = fieldsOf(s);

  // A radio or checkbox group is a plain div[data-field-path] around its fieldset, without the field-entry class
  // the other questions have: going by that class missed all seven groups in a live run.
  it("reads every question, groups included, with their options and required marks", () => {
    expect(Object.keys(f)).toHaveLength(22);
    expect(f["application.degree-type"]).toMatchObject({
      kind: "checkbox-group",
      required: true,
      options: ["Undergraduate/Bachelor's", "Master's", "PhD"],
    });
    expect(f["application.how-many-prior-internships-have-you-had"]).toMatchObject({
      kind: "radio",
      required: true,
      options: ["0", "1", "2", "3+"],
    });
    expect(Object.values(f).filter((x) => x.kind === "radio" || x.kind === "checkbox-group")).toHaveLength(8);
  });

  it("fills a radio group and a checkbox group, and reads them back", async () => {
    const adapter = createAdapter(ashby, document, () => url);
    adapter.setTiming({ afterFieldQuietMs: 0, afterFieldMaxMs: 0 });
    const results = await adapter.fill([
      { fieldId: "application.degree-type", value: ["Master's"], strict: true },
      { fieldId: "application.how-many-prior-internships-have-you-had", value: "2", strict: true },
    ]);
    expect(results.map((r) => [r.ok, r.readBack])).toEqual([
      [true, ["Master's"]],
      [true, "2"],
    ]);
  });
});
