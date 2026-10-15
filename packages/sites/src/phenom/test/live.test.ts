// @vitest-environment jsdom

import { createAdapter } from "@ezapply/engine/api";
import { describe, expect, it } from "vitest";
import { extractPage, fieldsOf, loadSaved as load } from "../../../test/adapters.js";
import { phenom } from "../definition/site.js";

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
