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
import { successfactors } from "../src/adapters/sites/successfactors/site.js";
import { extractPage } from "./adapters.js";
import { installDomShims } from "./workday-fixture.js";

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

  it("reads a multi-select whose id ends in [], with its error", () => {
    document.documentElement.innerHTML = `<body><form id="application-form">
      <div class="select__container">
        <label for="question_1000000001[]">Which offices could you work from?</label>
        <input role="combobox" id="question_1000000001[]">
        <p id="question_1000000001[]-error">This field is required.</p>
      </div></form></body>`;
    const field = Object.values(
      fieldsOf(extractPage(greenhouse, document, "https://job-boards.greenhouse.io/vandelay/jobs/1000000001").schema),
    )[0];
    expect(field).toMatchObject({ label: "Which offices could you work from?", error: "This field is required." });
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
      { fieldId: "application.degree-type", value: ["Master's"] },
      { fieldId: "application.how-many-prior-internships-have-you-had", value: "2" },
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
    // A tenant whose download link reads only "Download": the name comes from the link, not its text.
    const link = document.querySelector<HTMLAnchorElement>(".has-resume a.downloadFile");
    if (!link) throw new Error("no resume link in the fixture");
    link.textContent = "Download";
    const read = () => fieldsOf(extractPage(phenom, document, URL).schema)["my-information.resume"]?.currentValue;
    expect(read()).toEqual(["test-resume.pdf"]);
    link.removeAttribute("download");
    expect(read()).toEqual(["test-resume.pdf"]);
    link.setAttribute("href", "#");
    expect(read()).toEqual(["test-resume.pdf"]);
    link.removeAttribute("aria-label");
    expect(read()).toEqual(["Download"]);
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
    // Rows aren't hinted: the agent fills them from the profile's lists by their labels.
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

  it("reads a question's options as one field under its question, and ticks only the option asked for", async () => {
    page("phenom-step3");
    const q = "jsqData.Primary_External_Applicant_Questionnaire_Global";
    const option = (type: string, id: string, name: string, label: string) =>
      `<div class="${type}"><label><span><input type="${type}" id="${id}" name="${name}"><span>${label}</span></span></label></div>`;
    // react-jsonschema-form's checkboxes and radios (markup assumed from the library; no Phenom page with them saved),
    // and radios straight in the field's group, ids ending in their option, as a live step 1 showed.
    const fieldset = document.getElementById(q);
    if (!fieldset) throw new Error("no questionnaire in the fixture");
    fieldset.insertAdjacentHTML(
      "beforeend",
      `<div class="row form-group field field-array">
        <label class="control-label" for="${q}.x">Which have you completed?<span class="required">*</span></label>
        <div class="checkboxes" id="${q}.x">${["Doctorate", "High School Diploma/GED", "Bachelor's Degree (BA/BS /etc)"]
          .map((l, i) => option("checkbox", `${q}.x-${i}`, `${q}.x`, l))
          .join("")}</div>
      </div>
      <div class="row form-group field field-string">
        <label class="control-label" for="${q}.y">Are you over 18?<span class="required">*</span></label>
        <div class="field-radio-group" id="${q}.y">${option("radio", `${q}.y-0`, `${q}.y`, "Yes")}${option("radio", `${q}.y-1`, `${q}.y`, "No")}</div>
      </div>
      <div class="row form-group field field-string">
        <label class="control-label">Can we text you?</label>
        ${option("radio", "cntryFields.sms.Yes", "sms", "Yes")}${option("radio", "cntryFields.sms.no", "sms", "No")}
      </div>`,
    );
    const f = fieldsOf(extractPage(phenom, document, URL).schema);
    expect(f["application-questions.which-have-you-completed"]).toMatchObject({
      kind: "checkbox-group",
      label: "Which have you completed?",
      required: true,
      options: ["Doctorate", "High School Diploma/GED", "Bachelor's Degree (BA/BS /etc)"],
      currentValue: [],
    });
    expect(f["application-questions.are-you-over-18"]).toMatchObject({
      kind: "radio",
      label: "Are you over 18?",
      options: ["Yes", "No"],
    });
    expect(f["application-questions.can-we-text-you"]).toMatchObject({ kind: "radio", options: ["Yes", "No"] });
    expect(Object.keys(f).filter((k) => /doctorate|yes$|no$/i.test(k))).toEqual([]);

    const adapter = createAdapter(phenom, document, () => URL);
    const results = await adapter.fill([
      { fieldId: "application-questions.which-have-you-completed", value: "High School Diploma/GED" },
      { fieldId: "application-questions.are-you-over-18", value: "Yes" },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const ticked = [...document.querySelectorAll<HTMLInputElement>(`[name="${q}.x"]`)].map((b) => b.checked);
    expect(ticked).toEqual([false, true, false]);
    expect(
      fieldsOf(extractPage(phenom, document, URL).schema)["application-questions.which-have-you-completed"]
        ?.currentValue,
    ).toEqual(["High School Diploma/GED"]);
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

describe("live SuccessFactors application (career17.sapsf.com, signed in)", () => {
  // Signed in, the page's URL names neither the employer nor the job: the page says which job.
  const URL = "https://career17.sapsf.com/portalcareer?_s.crb=0000";
  const s = load(successfactors, "successfactors-application", URL);
  const f = fieldsOf(s);

  it("reads one page whose way on is Apply, the job from its heading and hidden requisition", () => {
    expect(s).toMatchObject({
      adapter: "successfactors",
      pageKind: "step",
      step: { title: "Operations Analyst" },
      nextLabel: "Apply",
      lastPage: true,
      errors: [],
      job: { title: "Operations Analyst", reqId: "1000" },
    });
    expect(s.tenant).toBeUndefined();
    expect(s.backLabel).toBeUndefined();
    const named = "https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000";
    expect(load(successfactors, "successfactors-application", named).tenant).toBe("soylent");
  });

  it("reads the profile's fields by their names, hinted, and the account's username not at all", () => {
    expect(f["profile-information.firstName"]).toMatchObject({
      label: "First Name",
      kind: "text",
      required: true,
      currentValue: "Jane",
      hint: { profileKey: "identity.firstName" },
    });
    expect(f["profile-information.middleName"]).toMatchObject({ required: false });
    expect(f["profile-information.address"]?.hint).toEqual({ profileKey: "contact.address.line1" });
    expect(f["profile-information.zip"]?.hint).toEqual({ profileKey: "contact.address.postalCode" });
    expect(f["profile-information.cellPhone"]?.hint).toEqual({ profileKey: "contact.phone.number" });
    expect(f["profile-information.contactEmail"]?.hint).toEqual({ profileKey: "contact.email" });
    expect(Object.keys(f).some((id) => id.includes("username"))).toBe(false);
  });

  it("reads the lists as dropdowns whose options load on demand, keyed by their prompts", () => {
    expect(f["profile-information.country"]).toMatchObject({
      label: "Country",
      kind: "dropdown",
      optionsLazy: true,
      required: true,
      currentValue: "United States",
    });
    // The field name that would hint it is the component's, which a saved page doesn't have.
    expect(f["profile-information.country"]?.hint).toBeUndefined();
    expect(f["profile-information.province-state"]).toMatchObject({ kind: "dropdown", currentValue: "Ohio" });
    // An unanswered question shows its placeholder, not a value.
    expect(f["job-specific-information.how-did-you-hear-about-this-position"]).toMatchObject({
      kind: "dropdown",
      required: true,
      currentValue: null,
    });
  });

  it("reads each row of a list as a section of its own, numbered, with its Remove; dates with their parts", () => {
    const work = s.sections.filter((x) => x.id.startsWith("outside-work-experience-"));
    expect(work.map((x) => [x.id, x.title, x.removable])).toEqual([
      ["outside-work-experience-1", "Outside Work Experience 1", true],
      ["outside-work-experience-2", "Outside Work Experience 2", true],
    ]);
    expect(work[0]?.fields.map((x) => [x.id, x.kind, x.currentValue])).toEqual([
      ["outside-work-experience-1.company-name", "text", "Example Corp"],
      ["outside-work-experience-1.title", "text", "Analyst"],
      ["outside-work-experience-1.start-date", "date", "01/01/2024"],
      ["outside-work-experience-1.end-date", "date", "12/31/2024"],
      ["outside-work-experience-1.type-of-business", "dropdown", "Retail"],
    ]);
    expect(f["outside-work-experience-1.start-date"]).toMatchObject({
      required: true,
      dateParts: ["MM", "DD", "YYYY"],
    });
    // A list's numbered fields (`VFLD1`) mean only what their labels say: no hints.
    expect(work[0]?.fields.every((x) => !x.hint)).toBe(true);
    expect(s.sections.find((x) => x.id === "formal-education-1")?.fields.map((x) => x.label)).toEqual([
      "School",
      "Degree",
      "Major",
      "Start Date",
      "End Date",
    ]);
    expect(s.sections.find((x) => x.id === "geographic-mobility-1")).toMatchObject({ removable: true });
    expect(s.sections.find((x) => x.id === "my-documents")?.removable).toBeUndefined();
  });

  it("reads a collapsed section's fields and Add too: they're still the application's", () => {
    load(successfactors, "successfactors-application", URL);
    document.getElementById("175:sectionContent")?.setAttribute("style", "display: none");
    const collapsed = extractPage(successfactors, document, URL).schema;
    expect(collapsed.sections.find((x) => x.id === "formal-education-1")?.fields.length).toBe(5);
    expect(collapsed.addButtons.map((b) => b.id)).toContain("add.formal-education");
  });

  it("offers each list's Add as a row", () => {
    expect(s.addButtons).toEqual([
      { id: "add.outside-work-experience", label: "Add", section: "Outside Work Experience", kind: "row" },
      { id: "add.formal-education", label: "Add", section: "Formal Education", kind: "row" },
      { id: "add.certifications-licenses", label: "Add", section: "Certifications/Licenses", kind: "row" },
      { id: "add.geographic-mobility", label: "Add", section: "Geographic Mobility", kind: "row" },
    ]);
  });

  it("reads the documents: the resume, the cover letter, and Additional Documents taking several", () => {
    expect(f["my-documents.resume-cv"]).toMatchObject({
      kind: "file",
      label: "Resume/CV",
      required: true,
      currentValue: ["jane-doe-resume.pdf"],
      multiple: false,
    });
    expect(f["my-documents.cover-letter"]).toMatchObject({ currentValue: ["jane-doe-cover-letter.pdf"] });
    expect(f["my-documents.additional-documents"]).toMatchObject({ currentValue: ["transcript.pdf"], multiple: true });
  });

  it("reads Job-Specific Information by its fields' names; a typed signature unhinted", () => {
    expect(f["job-specific-information.prefName"]).toMatchObject({ hint: { profileKey: "identity.preferredName" } });
    expect(f["job-specific-information.candidateName"]?.hint).toEqual({ profileKey: "identity.fullName" });
    expect(f["job-specific-information.disclaimerAcknowledge"]).toMatchObject({
      label: "Typed Signature",
      required: true,
    });
    expect(f["job-specific-information.disclaimerAcknowledge"]?.hint).toBeUndefined();
    // `type=currency`, read as text.
    expect(f["job-specific-information.customExptSal"]).toMatchObject({
      kind: "text",
      label: "Base Salary Expectation",
    });
  });

  it("tells Apply by its hook and its words, never Save; the welcome's thanks is no confirmation", () => {
    const control = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };
    expect(successfactors.page.isSubmit(control('<span role="button" id="290:_saveBtn">Save</span>'))).toBe(false);
    expect(successfactors.page.isSubmit(control('<span role="button" id="290:_submitBtn">Postuler</span>'))).toBe(true);
    expect(successfactors.page.isSubmit(control('<span role="button">Apply</span>'))).toBe(true);
    document.body.innerHTML =
      '<div role="main"><div role="note">Thank you for your interest in Soylent.</div><p>Search jobs</p></div>';
    expect(successfactors.page.kind(document, URL, 0)).toBe("unknown");
    document.body.innerHTML =
      '<div role="main"><p>Thank you for applying. Your application has been submitted.</p></div>';
    expect(successfactors.page.kind(document, URL, 0)).toBe("confirmation");
  });
});

describe("SuccessFactors' lists, rows and documents (its components modelled from its scripts, in the saved page)", () => {
  const URL = "https://career17.sapsf.com/portalcareer?_s.crb=0000";
  installDomShims(window);

  /**
   * juic's component registry with two paginated picklists modelled: each answers
   * `getPicklistByPageWithExcludeOption` as SuccessFactors does (a page of options after "No Selection", filtered by
   * "contains"), and its `setValue` shows the label in its input.
   */
  function page() {
    load(successfactors, "successfactors-application", URL);
    const registry: Record<string, unknown> = {};
    const requests: { picklist: unknown; filter: unknown }[] = [];
    const picklist = (inputId: string, name: string, all: string[]) => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      let value = { value: "", label: input.value };
      const list = {
        getFieldName: () => name,
        getValue: () => value,
        setValue: (v: { value: string; label: string }) => {
          value = v;
          input.value = v.label;
        },
        _model: {
          _picklistId: name,
          _parentOptionId: null,
          _controller: {
            getPicklistByPageWithExcludeOption: (
              _parent: unknown,
              id: unknown,
              p: { filterValue: string | null },
              ...rest: unknown[]
            ) => {
              requests.push({ picklist: id, filter: p.filterValue });
              const q = p.filterValue?.toLowerCase();
              const options = all
                .filter((o) => !q || o.toLowerCase().includes(q))
                .map((label) => ({ label, value: String(all.indexOf(label) + 1) }));
              const answer = rest.at(-1) as (r: unknown) => void;
              setTimeout(
                () =>
                  answer({
                    picklistOptions: [{ label: "No Selection", value: "" }, ...options],
                    totalCount: options.length,
                  }),
                5,
              );
            },
          },
        },
      };
      registry[inputId.replace(/_input$/, "")] = list;
      return list;
    };
    const country = picklist("88:_input", "country", ["Canada", "United Kingdom", "United States"]);
    picklist("244:_input", "customHear", ["Job board", "Referral", "Company website"]);
    (window as unknown as { juic: unknown }).juic = { Component: { _registry: registry } };
    return { country, requests };
  }

  it("lists a picklist's options from SuccessFactors and chooses one through the component", async () => {
    const { country, requests } = page();
    const api = createAdapter(successfactors, document, () => URL);
    // Hinted by the field name only the component holds.
    const fields = api.getForm().sections.flatMap((x) => x.fields);
    expect(fields.find((x) => x.id === "profile-information.country")?.hint).toEqual({
      profileKey: "contact.address.country",
    });
    expect(await api.listOptions("profile-information.country")).toEqual([
      { label: "Canada" },
      { label: "United Kingdom" },
      { label: "United States" },
    ]);
    expect(await api.searchOptions("job-specific-information.how-did-you-hear-about-this-position", "ref")).toEqual([
      { label: "Referral" },
    ]);
    const [result] = await api.fill([{ fieldId: "profile-information.country", value: "Canada" }]);
    expect(result).toMatchObject({ ok: true, readBack: "Canada" });
    expect(country.getValue()).toEqual({ value: "1", label: "Canada" });
    // The value was searched for first.
    expect(requests).toContainEqual({ picklist: "country", filter: "Canada" });
  });

  it("refuses a disabled list and names the options when nothing matches", async () => {
    page();
    const api = createAdapter(successfactors, document, () => URL);
    const [miss] = await api.fill([{ fieldId: "profile-information.country", value: "Atlantis" }]);
    expect(miss).toMatchObject({ ok: false, availableOptions: ["Canada", "United Kingdom", "United States"] });
    (document.getElementById("95:_input") as HTMLInputElement).disabled = true;
    const [disabled] = await api.fill([{ fieldId: "profile-information.province-state", value: "Ohio" }]);
    expect(disabled).toMatchObject({ ok: false, error: /disabled/ });
  });

  it("removes a row with its Remove, which asks nothing", async () => {
    page();
    // As the section's script does: the row goes at once.
    const row = document.getElementById("147:_sectionComponent")?.parentElement;
    row?.querySelector("[title='Delete Row']")?.addEventListener("click", () => row.remove());
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.removeRepeatable("outside-work-experience-2")).toMatchObject({ ok: true });
    expect(api.getForm().sections.filter((x) => x.id.startsWith("outside-work-experience-")).length).toBe(1);
  });

  /** The upload popup as the attachment view renders it (`RCMV12AttachmentPopUpContent`), opened by a field's icon. */
  function popupOn(iconId: string, uploaded: (name: string) => void) {
    document.getElementById(iconId)?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog"><div id="900:_attachUploadOptions" class="attachmentUploadOptions"><span id="900:_uploadComputer">Upload from my computer</span><input type="file" id="900:_file" class="fileUpload" name="fileData1"></div></div>',
      );
      const input = document.getElementById("900:_file") as HTMLInputElement;
      input.addEventListener("change", () => {
        const name = input.files?.[0]?.name ?? "";
        input.closest("[role='dialog']")?.remove();
        setTimeout(() => uploaded(name), 10);
      });
    });
  }

  it("uploads through the field's popup: a document beside Additional Documents', the resume replaced", async () => {
    page();
    // As SuccessFactors shows it once its server has the file: the empty slot names it.
    popupOn("58:_attachIcon", (name) => {
      document.getElementById("58:_attach")?.classList.replace("attachmentBtn", "successBtn");
      document.getElementById("58:_attachDownloadLabel")?.classList.remove("displayNone");
      const link = document.getElementById("58:_attachDownloadLabelLink");
      if (link) link.textContent = name;
    });
    popupOn("52:_attachIcon", (name) => {
      const link = document.getElementById("52:_attachDownloadLabelLink");
      if (link) link.textContent = name;
    });
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    const file = (name: string) => ({ name, mimeType: "application/pdf", base64: btoa("%PDF-1.4") });
    expect(await api.upload("my-documents.additional-documents", file("portfolio.pdf"))).toMatchObject({
      ok: true,
      readBack: ["transcript.pdf", "portfolio.pdf"],
    });
    expect(await api.upload("my-documents.resume-cv", file("new-resume.pdf"))).toMatchObject({
      ok: true,
      readBack: ["new-resume.pdf"],
    });
    // The cover letter's icon deletes it: it has to come off first.
    expect(await api.upload("my-documents.cover-letter", file("letter.pdf"))).toMatchObject({
      ok: false,
      error: /remove it first/,
    });
  });

  it("removes an optional document after its confirmation; a required one can only be replaced", async () => {
    page();
    document.getElementById("54:_attachIcon")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog" class="sfDialogBox"><p>Are you sure you want to delete this file?</p><button>Cancel</button><button id="ok">OK</button></div>',
      );
      document.getElementById("ok")?.addEventListener("click", () => {
        document.querySelector(".sfDialogBox")?.remove();
        setTimeout(() => document.getElementById("54:_attach")?.setAttribute("style", "display: none"), 10);
      });
    });
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.remove("my-documents.cover-letter")).toMatchObject({
      ok: true,
      removed: ["jane-doe-cover-letter.pdf"],
    });
    expect(await api.remove("my-documents.resume-cv")).toMatchObject({ ok: false, error: /only be replaced/ });
  });

  it("knows a required document replaced under the same name by the tick the field shows", async () => {
    page();
    // The name doesn't change: only the slot's tick says the new file went in.
    popupOn("52:_attachIcon", () => document.getElementById("52:_attachSuccess")?.classList.remove("displayNone"));
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    const file = { name: "jane-doe-resume.pdf", mimeType: "application/pdf", base64: btoa("%PDF-1.4") };
    expect(await api.upload("my-documents.resume-cv", file)).toMatchObject({
      ok: true,
      readBack: ["jane-doe-resume.pdf"],
    });
  });

  it("says when the page re-renders during an upload, and finds the field again", async () => {
    page();
    // As seen live: the whole application rendered again, every element new, what wasn't saved gone.
    const rerender = (keep: boolean) => () => {
      const root = document.querySelector("#rcmJobApplicationCtr") as HTMLElement;
      const copy = root.cloneNode(true) as HTMLElement;
      const link = copy.querySelector("[id='58:_attachDownloadLabelLink']");
      if (keep && link) {
        copy.querySelector("[id='58:_attach']")?.classList.replace("attachmentBtn", "successBtn");
        copy.querySelector("[id='58:_attachDownloadLabel']")?.classList.remove("displayNone");
        link.textContent = "portfolio.pdf";
      }
      root.replaceWith(copy);
    };
    const file = { name: "portfolio.pdf", mimeType: "application/pdf", base64: btoa("%PDF-1.4") };

    popupOn("58:_attachIcon", rerender(true));
    let api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.upload("my-documents.additional-documents", file)).toMatchObject({
      ok: true,
      readBack: ["transcript.pdf", "portfolio.pdf"],
      error: /re-rendered.*get_form/,
    });

    page();
    popupOn("58:_attachIcon", rerender(false));
    api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.upload("my-documents.additional-documents", file)).toMatchObject({
      ok: false,
      readBack: ["transcript.pdf"],
      error: /re-rendered.*doesn't show in the field now/,
    });
  });

  it("reads a question's radio group by its label and chooses through the component's click", async () => {
    page();
    // A question as SuccessFactors renders it (`rcmFormQuestionLabel`, juic's radios, no inputs).
    const radio = (id: string, label: string) =>
      `<div class="globalRadio sfRadioInputField fd-form-item" id="${id}:_anchorButton"><span id="${id}:_radio" class="radioCheck radioOff"><span class="radioContainer radioAnchorTag" id="${id}:_anchor" role="radio" aria-checked="false" aria-labelledby="${id}:_radiolabel" tabindex="0"><span class="radioIcon"><span class="dot"></span></span></span><label id="${id}:_radiolabel" class="radioLabel">${label}</label></span></div>`;
    document
      .getElementById("289:sectionContent")
      ?.insertAdjacentHTML(
        "beforeend",
        `<div class="RCMFormField rcmFormQuestionElement "><label id="912:" for="908:" class="rcmFormQuestionLabel"><span class="requiredField" aria-hidden="true" role="presentation">*</span>&nbsp;Are you enrolled in a co-op program?</label><div class="fieldComponentInput" id="911:_fieldComponentInput"><div id="908:" class="radioGroup" role="radiogroup" aria-labelledby="912:">${radio("909", "Yes")}${radio("910", "No")}</div><div tabindex="-1" role="alert" id="913:" class="rcmValidationMsgArea displayNone"></div></div></div>`,
      );
    // The group checks the one clicked, and unchecks the other.
    for (const id of ["909", "910"]) {
      document.getElementById(`${id}:_radio`)?.addEventListener("click", () => {
        for (const a of document.querySelectorAll("[id$=':_anchor']")) a.setAttribute("aria-checked", "false");
        document.getElementById(`${id}:_anchor`)?.setAttribute("aria-checked", "true");
      });
    }
    const api = createAdapter(successfactors, document, () => URL);
    const field = api
      .getForm()
      .sections.flatMap((x) => x.fields)
      .find((x) => x.id === "job-specific-information.are-you-enrolled-in-a-co-op-program");
    expect(field).toMatchObject({
      label: "Are you enrolled in a co-op program?",
      kind: "radio",
      required: true,
      options: ["Yes", "No"],
      currentValue: null,
    });
    const [yes] = await api.fill([
      { fieldId: "job-specific-information.are-you-enrolled-in-a-co-op-program", value: "Yes" },
    ]);
    expect(yes).toMatchObject({ ok: true, readBack: "Yes" });
    const [miss] = await api.fill([
      { fieldId: "job-specific-information.are-you-enrolled-in-a-co-op-program", value: "Maybe" },
    ]);
    expect(miss).toMatchObject({ ok: false, availableOptions: ["Yes", "No"] });
  });
});
