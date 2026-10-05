// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAdapter } from "../src/adapters/engine/api.js";
import type { SiteDefinition } from "../src/adapters/engine/types.js";
import { ashby } from "../src/adapters/sites/ashby/site.js";
import { dayforce } from "../src/adapters/sites/dayforce/site.js";
import { greenhouse } from "../src/adapters/sites/greenhouse/site.js";
import { lever } from "../src/adapters/sites/lever/site.js";
import { phenom } from "../src/adapters/sites/phenom/site.js";
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
    // Its own page: the describe blocks after this one load theirs when the file is collected.
    load(ashby, "ashby-groups", url);
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

describe("live Phenom apply flow (an employer's careers domain, …/apply?jobSeqNo=…)", () => {
  const URL = "https://jobs.globex.example/ca/en/apply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA&step=1";
  const page = (name: string) => load(phenom, name, URL);

  it("reads step 1: the resume above the form, the contact fields hinted, the step and the job from the header", () => {
    const s = page("phenom-step1");
    expect(s).toMatchObject({
      adapter: "phenom",
      tenant: "jobs.globex.example",
      pageKind: "step",
      step: { index: 1, total: 6, title: "My information" },
      nextLabel: "Next",
      job: { title: "Software Developer Intern", reqId: "R-0000000001" },
      addButtons: [],
    });
    // Next is a type=submit button, but it isn't Submit: the last step's would be.
    expect(s.lastPage).toBeUndefined();
    expect(s.backLabel).toBeUndefined();
    const f = fieldsOf(s);
    expect(f["my-information.resume"]).toMatchObject({ kind: "file", currentValue: ["test-resume.pdf"] });
    expect(f["my-information.firstName"]).toMatchObject({
      kind: "text",
      label: "First Name",
      required: true,
      currentValue: "Test",
      hint: { profileKey: "identity.firstName" },
    });
    expect(f["my-information.region"]).toMatchObject({
      kind: "dropdown",
      required: true,
      hint: { profileKey: "contact.address.region" },
    });
    expect(f["my-information.countryPhoneCode"]?.hint).toEqual({ profileKey: "contact.phone.countryCode" });
    expect(f["my-information.source"]).toMatchObject({
      kind: "dropdown",
      label: "How did you hear about us?",
      required: true,
    });
    expect(f["my-information.source"]?.hint).toBeUndefined();
  });

  it("reads step 2's rows as sections of their own, with their add buttons, dates, school and languages", () => {
    const s = page("phenom-step2");
    expect(s).toMatchObject({ step: { index: 2, title: "My experience" }, backLabel: "Previous" });
    expect(s.addButtons.map((b) => [b.id, b.label, b.section])).toEqual([
      ["add.work-experience", "Add experience", "Work experience"],
      ["add.education", "Add education", "Education"],
      ["add.languages", "Add language", "Languages"],
      ["add.websites", "Add website", "Websites"],
    ]);
    const work = s.sections.find((x) => x.id === "work-experience-1");
    expect(work).toMatchObject({ title: "Work experience 1", removable: true });
    const f = fieldsOf(s);
    expect(f["work-experience-1.startDate"]).toMatchObject({
      kind: "date",
      dateParts: ["MM", "YYYY"],
      currentValue: "01/2025",
    });
    expect(f["work-experience-1.currentlyWorkHere"]).toMatchObject({
      kind: "checkbox",
      label: "I currently work here",
    });
    // Rows aren't hinted: autofill fills them from the profile's lists by their labels.
    expect(f["work-experience-1.title"]?.hint).toBeUndefined();
    expect(f["education-1.schoolName"]).toMatchObject({ kind: "typeahead", currentValue: ["Springfield University"] });
    expect(f["languages-1.listening"]).toMatchObject({ kind: "dropdown", required: true });
    expect(f["languages-1.native"]).toMatchObject({ kind: "checkbox", label: "This is my native language." });
    expect(f["skills.skills"]).toMatchObject({ kind: "text", label: "Skills: Separate each skill with a comma." });
    expect(f["my-experience.attachments"]).toMatchObject({ kind: "file", label: "Additional attachments" });
  });

  it("reads the errors a refused Next leaves, on the page and on each field", () => {
    const s = page("phenom-step2-errors");
    expect(s.errors).toEqual(expect.arrayContaining(["Enter end date", "Select degree"]));
    const f = fieldsOf(s);
    expect(f["work-experience-1.endDate"]).toMatchObject({ currentValue: null, error: "Enter end date" });
    expect(f["education-1.degree"]?.error).toBe("Select degree");
  });

  it("keys a questionnaire's questions by their prompt, under the step's title", () => {
    const s = page("phenom-step3");
    expect(s.step).toMatchObject({ index: 3, title: "Application questions" });
    const f = fieldsOf(s);
    expect(f["application-questions.are-you-currently-a-student"]).toMatchObject({ kind: "dropdown", required: true });
    expect(f["application-questions.when-would-you-be-available-to-start"]).toMatchObject({
      kind: "date",
      required: true,
    });
  });

  it("refuses Next on step 1 without a resume, rather than raise the page's blocking alert", async () => {
    page("phenom-step1");
    document.querySelector(".has-resume")?.remove();
    let pressed = false;
    document.querySelector("button#next")?.addEventListener("click", () => {
      pressed = true;
    });
    const result = await createAdapter(phenom, document, () => URL).next();
    expect(result).toMatchObject({ advanced: false, refusedReason: expect.stringMatching(/without a resume/) });
    expect(pressed).toBe(false);
  });

  it("tells Submit by its words, never Next by its type", () => {
    const button = (html: string) => {
      document.body.innerHTML = html;
      return document.querySelector("button");
    };
    expect(phenom.page.isSubmit(button('<button type="submit" id="next">Next</button>'))).toBe(false);
    expect(phenom.page.isSubmit(button('<button type="submit">Submit</button>'))).toBe(true);
    expect(phenom.page.isSubmit(button('<button type="button" aria-label="Submit application">Send</button>'))).toBe(
      true,
    );
  });
});

describe("live Dayforce application (jobs.dayforcehcm.com/…/apply/manualApplication)", () => {
  const URL =
    "https://jobs.dayforcehcm.com/en-US/hooli/CANDIDATEPORTAL/jobs/1000/apply/manualApplication?applicationSource=Manual";
  const s = load(dayforce, "dayforce-candidate-info", URL);
  const f = fieldsOf(s);

  it("reads the Candidate Info step: its place in the step bar, the job from the header, the client from the URL", () => {
    expect(s).toMatchObject({
      adapter: "dayforce",
      tenant: "hooli",
      pageKind: "step",
      step: { index: 1, total: 3, title: "Candidate Info" },
      nextLabel: "Next",
      errors: [],
      job: { title: "Analyst Intern", reqId: "0000" },
    });
    expect(s.backLabel).toBeUndefined();
    expect(s.lastPage).toBeUndefined();
  });

  it("reads Personal Information's fields by their form paths, hinted; the account's email read-only", () => {
    expect(f["personal-information.firstName"]).toMatchObject({
      label: "First Name",
      kind: "text",
      required: true,
      currentValue: "Jane",
      hint: { profileKey: "identity.firstName" },
    });
    expect(f["personal-information.email"]).toMatchObject({ helpText: "Read-only on this page." });
    expect(f["personal-information.email"]?.hint).toBeUndefined();
    expect(f["personal-information.countryCode"]).toMatchObject({
      kind: "dropdown",
      optionsLazy: true,
      hint: { profileKey: "contact.address.country" },
    });
    // A list that can't be searched keeps a read-only search box: it isn't a read-only field.
    expect(f["personal-information.prefixId"]?.helpText).toBeUndefined();
    expect(f["personal-information.preferredContactMethod"]).toMatchObject({ required: true, currentValue: "Email" });
    expect(f["personal-information.stateCode"]).toMatchObject({ hint: { profileKey: "contact.address.region" } });
  });

  it("splits each phone number into its dialling code and the number", () => {
    expect(f["personal-information.mobilePhoneCountryCode"]).toMatchObject({
      kind: "dropdown",
      label: "Mobile Phone Number: Country dialing code",
      hint: { profileKey: "contact.phone.countryCode" },
    });
    expect(f["personal-information.mobilePhone"]).toMatchObject({
      kind: "text",
      required: true,
      hint: { profileKey: "contact.phone.number" },
    });
    expect(f["personal-information.homePhone"]?.hint).toBeUndefined();
  });

  it("reads the documents under their headings, not the Import Resume above the form", () => {
    expect(f["resume-upload.resume"]).toMatchObject({ kind: "file", label: "Resume Upload", required: true });
    expect(f["cover-letter.coverLetter"]).toMatchObject({ kind: "file", required: false });
    expect(f["additional-documents.additionalDocument"]).toMatchObject({ kind: "file" });
    expect(Object.keys(f).filter((id) => id.endsWith(".resume"))).toEqual(["resume-upload.resume"]);
  });

  it("offers each list's Add as a form, and Personal Information's Update as its save", () => {
    expect(s.addButtons).toEqual([
      { id: "add.employment-history", label: "Add Employment History", section: "Employment History", kind: "form" },
      { id: "add.education-history", label: "Add Education History", section: "Education History", kind: "form" },
      { id: "save.personal-information", label: "Update", section: "Personal Information", kind: "save" },
    ]);
  });

  it("tells Submit by its hook and its words, never an Update or Next", () => {
    const button = (html: string) => {
      document.body.innerHTML = html;
      return document.querySelector("button");
    };
    const update = '<button type="submit" test-id="workHistory-update-button">Update</button>';
    expect(dayforce.page.isSubmit(button(update))).toBe(false);
    expect(dayforce.page.isSubmit(button('<button test-id="application-next-step">Next</button>'))).toBe(false);
    const hooked = '<button test-id="application-submit"><span>Envoyer</span></button>';
    expect(dayforce.page.isSubmit(button(hooked))).toBe(true);
    expect(dayforce.page.isSubmit(button("<button>Submit Application</button>"))).toBe(true);
  });

  it("tells the posting and the confirmation by the page's text, not its scripts' messages", () => {
    const page = (main: string) => {
      document.body.innerHTML = `<main>${main}</main><script id="__NEXT_DATA__">{"submitted":"Congratulations, your application has been submitted!"}</script>`;
      return dayforce.page.kind(document, URL, 0);
    };
    expect(page('<h1>Analyst Intern</h1><a aria-label="Apply for Analyst Intern" href="#">Apply</a>')).toBe("posting");
    expect(page("<p>Congratulations, your application has been submitted!</p>")).toBe("confirmation");
  });
});

describe("Dayforce records (markup from the portal's scripts, in the saved page)", () => {
  /**
   * An open Employment History record (new, index 1, shown first) above a saved one (index 0), as the portal renders
   * them: a `form` per record with its Update and Cancel while open, its summary with Edit and Delete once saved.
   */
  const label = (id: string, text: string, required = false) =>
    `<div class="ant-col ant-form-item-label"><label for="jobPostingApplication_workHistory_1_${id}"${required ? ' class="ant-form-item-required"' : ""}>${text}</label></div>`;
  const item = (inner: string) =>
    `<div class="ant-form-item"><div class="ant-row ant-form-item-row">${inner}</div></div>`;
  const OPEN = [
    '<form test-id="workhistory-record" id="workHistory-1">',
    item(
      `${label("title", "Position Title", true)}<div class="ant-col ant-form-item-control"><input id="jobPostingApplication_workHistory_1_title" class="ant-input" type="text" value=""></div>`,
    ),
    item(
      `${label("isCurrent", "Current Job")}<div class="ant-col ant-form-item-control"><label class="ant-checkbox-wrapper"><span class="ant-checkbox"><input id="jobPostingApplication_workHistory_1_isCurrent" type="checkbox" class="ant-checkbox-input"></span></label></div>`,
    ),
    item(
      `${label("effectiveStart", "Start Date", true)}<div class="ant-col ant-form-item-control"><input id="jobPostingApplication_workHistory_1_effectiveStart" class="ant-input" type="date" value=""><div class="ant-form-item-explain"><div class="ant-form-item-explain-error">'Start Date' is required.</div></div></div>`,
    ),
    '<div class="ant-form-item"><button test-id="workHistory-update-button" type="submit">Update</button></div>',
    '<div class="ant-form-item"><button test-id="workHistory-cancel-button" type="reset">Cancel</button></div>',
    "</form>",
  ].join("");
  const SAVED = [
    '<form test-id="workhistory-record" id="workHistory-0">',
    '<div test-id="workHistory-position-title-container"><h3>Analyst</h3>',
    '<button aria-label="Edit Record" test-id="workHistory-edit-button"></button>',
    '<button aria-label="Delete Record" test-id="workHistory-delete-button"></button></div>',
    "<div>Example Corp • Toronto</div></form>",
  ].join("");
  const URL = "https://jobs.dayforcehcm.com/en-US/hooli/CANDIDATEPORTAL/jobs/1000/apply/manualApplication";
  const page = () => {
    load(dayforce, "dayforce-candidate-info", URL);
    document.querySelector("[test-id='work-history']")?.insertAdjacentHTML("beforeend", OPEN + SAVED);
  };

  it("reads an open record as a section of its own, numbered by its index, hinted, with its Update", () => {
    page();
    const s = extractPage(dayforce, document, URL).schema;
    const open = s.sections.find((x) => x.id === "employment-history-2");
    expect(open).toMatchObject({ title: "Employment History 2", removable: true });
    expect(open?.fields.map((x) => [x.id, x.kind, x.hint?.profileKey])).toEqual([
      ["employment-history-2.title", "text", "work[].title"],
      ["employment-history-2.isCurrent", "checkbox", "work[].end (null = current)"],
      ["employment-history-2.effectiveStart", "date", "work[].start"],
    ]);
    expect(open?.fields[2]?.error).toBe("'Start Date' is required.");
    expect(s.errors).toContain("'Start Date' is required.");
    expect(s.addButtons.map((b) => [b.id, b.kind])).toEqual([
      ["add.employment-history", "form"],
      ["add.education-history", "form"],
      ["save.personal-information", "save"],
      ["save.employment-history-2", "save"],
      ["edit.employment-history-1", "edit"],
    ]);
  });

  it("reads a saved record as a saved item the companion counts as work, and deletes it through its dialog", async () => {
    page();
    const saved = () => document.getElementById("workHistory-0");
    saved()
      ?.querySelector("[test-id='workHistory-delete-button']")
      ?.addEventListener("click", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<div class="ant-modal"><button test-id="workHistory-delete-modal-ok-button">OK</button></div>',
        );
        document
          .querySelector("[test-id='workHistory-delete-modal-ok-button']")
          ?.addEventListener("click", () => saved()?.remove());
      });
    const api = createAdapter(dayforce, document, () => URL);
    const saved1 = api.getForm().sections.find((x) => x.id === "employment-history.experience-1");
    expect(saved1).toMatchObject({ removable: true, saved: true, fields: [] });
    expect(saved1?.title).toMatch(/^Employment History: Analyst.*Example Corp/);
    expect(await api.removeRepeatable("employment-history.experience-1")).toMatchObject({ ok: true });
    expect(saved()).toBeNull();
  });
});
