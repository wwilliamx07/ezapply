// @vitest-environment jsdom

import { createAdapter } from "@ezapply/engine/api";
import { describe, expect, it } from "vitest";
import { extractPage, fieldsOf, loadSaved as load } from "../../../test/adapters.js";
import { dayforce } from "../definition/site.js";

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
