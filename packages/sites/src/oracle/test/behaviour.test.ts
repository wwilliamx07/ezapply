// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomShims } from "../../../../engine/test/shims.js";
import { createOracleApi } from "../../../test/adapters.js";
import { buildOracleApplication } from "./fixture.js";

installDomShims(document.defaultView as Window);

const URL = "https://jobs.acme.com/en/sites/CX_1/job/42/apply/section/1";
let fixture: ReturnType<typeof buildOracleApplication>;
let api: ReturnType<typeof createOracleApi>;

const setup = (opts: Parameters<typeof buildOracleApplication>[1] = {}) => {
  fixture = buildOracleApplication(document, opts);
  api = createOracleApi(document, () => URL);
};

beforeEach(() => setup());

const fields = () =>
  Object.fromEntries(
    api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .map((f) => [f.id, f]),
  );
const pdf = (name: string) => ({ name, mimeType: "application/pdf", base64: btoa("%PDF-1.4") });

describe("extraction", () => {
  it("describes the application: fields by block, kinds, the phone's two parts, add buttons, Submit", () => {
    const form = api.getForm();
    expect(form).toMatchObject({
      adapter: "oracle",
      tenant: "jobs.acme.com/cx_1",
      pageKind: "step",
      nextLabel: "Submit",
      step: { title: "Personal Info · Job Application Questions · More About You" },
    });
    const f = fields();
    expect(f["contact-information.lastName"]).toMatchObject({ kind: "text", required: true });
    expect(f["contact-information.email"]).toMatchObject({ currentValue: "jo@example.com" });
    expect(f["contact-information.phoneCountryCode"]?.kind).toBe("dropdown");
    expect(f["contact-information.phoneNumber"]?.kind).toBe("text");
    expect(f["application-questions.do-you-require-any-accommodations"]).toMatchObject({
      kind: "radio",
      options: ["Yes", "No"],
    });
    expect(f["application-questions.which-areas-interest-you"]).toMatchObject({
      kind: "checkbox-group",
      multiple: true,
    });
    expect(f["application-questions.expected-graduation-date"]?.dateParts).toEqual(["MM", "DD", "YYYY"]);
    expect(form.addButtons.map((b) => b.id)).toEqual(["add.link", "add.experience", "add.language"]);
    expect(form.sections.find((s) => s.removable)).toMatchObject({
      id: "work-and-education-history.experience-1",
      title: "Work and Education History: Acme Corp, Intern",
      fields: [],
    });
  });

  it("offers Use My Profile to a returning candidate", () => {
    setup({ profileChoice: true });
    expect(api.getForm()).toMatchObject({ pageKind: "start-choice", actions: ["use_last_application"] });
  });
});

describe("filling", () => {
  it("fills text, pills, radios, a textarea and a checkbox, and reads them back", async () => {
    const results = await api.fill([
      { fieldId: "contact-information.lastName", value: "Doe" },
      { fieldId: "contact-information.title", value: "Ms." },
      { fieldId: "application-questions.do-you-require-any-accommodations", value: "No" },
      { fieldId: "application-questions.are-you-legally-authorized-to-work-in-ca", value: "yes" },
      { fieldId: "application-questions.number-of-co-op-terms-completed", value: "2" },
      { fieldId: "application-questions.which-areas-interest-you", value: ["DSP", "Firmware"] },
      { fieldId: "agreements.job-alerts-checkbox", value: true },
    ]);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    const f = fields();
    expect(f["contact-information.lastName"]?.currentValue).toBe("Doe");
    expect(f["contact-information.title"]?.currentValue).toBe("Ms.");
    expect(f["application-questions.are-you-legally-authorized-to-work-in-ca"]?.currentValue).toBe("Yes");
    expect(f["application-questions.which-areas-interest-you"]?.currentValue).toEqual(["Firmware", "DSP"]);
    expect(f["agreements.job-alerts-checkbox"]?.currentValue).toBe(true);
  });

  it("leaves a pressed pill pressed when filled again (pressing it would unselect it)", async () => {
    await api.fill([{ fieldId: "contact-information.title", value: "Mr." }]);
    const [again] = await api.fill([{ fieldId: "contact-information.title", value: "Mr." }]);
    expect(again?.ok).toBe(true);
    expect(fields()["contact-information.title"]?.currentValue).toBe("Mr.");
  });

  it("shows a widget it can't drive, and says to ask the user rather than typing into it", async () => {
    document.querySelector("#block-contact .apply-flow-block__form-list")?.insertAdjacentHTML(
      "beforeend",
      `<div class="input-row input-row--has-picker"><label class="input-row__label" for="locations-70"><span class="input-row__label-text">Preferred Locations</span></label>
        <div class="input-row__control-container"><div class="cx-multi-select-container"><input class="cx-multi-select-input" id="locations-70" type="text" role="combobox"></div></div></div>`,
    );
    expect(fields()["contact-information.locations"]).toMatchObject({
      kind: "typeahead",
      label: "Preferred Locations",
    });
    const [r] = await api.fill([{ fieldId: "contact-information.locations", value: "Ottawa" }]);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Ask the user/) });
  });

  it("refuses the read-only email", async () => {
    const [r] = await api.fill([{ fieldId: "contact-information.email", value: "x@example.com" }]);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/read-only/) });
  });

  it("chooses list options, in page order, so a city list loads for the country chosen before it", async () => {
    // Given city first: the adapter still fills the country first. The city list then re-renders its input when
    // it opens (the adapter follows the new one), labels "Kanata, Ontario" but shows "Kanata" once chosen, and
    // leaves a "required" error for a moment after the choice; none of that is a failure (all seen live).
    const results = await api.fill([
      { fieldId: "address.city", value: "Kanata" },
      { fieldId: "address.country", value: "canada" },
      { fieldId: "contact-information.phoneCountryCode", value: "+1 Canada" },
    ]);
    expect(results.map((r) => r.fieldId)).toEqual([
      "address.city",
      "address.country",
      "contact-information.phoneCountryCode",
    ]);
    expect(results).toEqual([
      { fieldId: "address.city", ok: true, readBack: "Kanata" },
      { fieldId: "address.country", ok: true, readBack: "Canada" },
      { fieldId: "contact-information.phoneCountryCode", ok: true, readBack: "+1 Canada" },
    ]);
    expect(fixture.comboValue("country-30")).toBe("Canada");
    expect(fixture.comboValue("city-33")).toBe("Kanata, Ontario");
    expect(fields()["address.city"]).toMatchObject({ currentValue: "Kanata" });
    expect(fields()["address.city"]?.error).toBeUndefined();
    // No list is left open.
    expect(document.querySelector("[role=grid]")).toBeNull();
  });

  it("finds an option the list doesn't show at first by searching its first part", async () => {
    // The server searches by the code: the full label finds nothing, "K2K 3E9" does (seen live).
    const [r] = await api.fill([{ fieldId: "address.postalCode", value: "K2K 3E9, Kanata, Ontario" }]);
    expect(r).toEqual({ fieldId: "address.postalCode", ok: true, readBack: "K2K 3E9" });
    expect(fixture.comboValue("postalCode-36")).toBe("K2K 3E9, Kanata, Ontario");
    // Already chosen: filling it again, by the label or what the field shows, changes nothing.
    const again = await api.fill([{ fieldId: "address.postalCode", value: "K2K 3E9" }]);
    expect(again[0]).toMatchObject({ ok: true, readBack: "K2K 3E9" });
  });

  describe("a list that searches late and only when its text changes, as live", () => {
    beforeEach(() => setup({ liveSearch: true }));
    afterEach(() => api.setTiming(null));

    it("waits for the search, not the unfiltered list typing shows first", async () => {
      const [r] = await api.fill([{ fieldId: "address.postalCode", value: "K2K 3E9" }]);
      expect(r).toMatchObject({ ok: true, readBack: "K2K 3E9" });
      expect(fixture.comboValue("postalCode-36")).toBe("K2K 3E9, Kanata, Ontario");
    });

    it("searches again for text the widget kept from a search the closed list dropped", async () => {
      const input = document.getElementById("postalCode-36") as HTMLInputElement;
      input.focus();
      input.click();
      input.value = "K2K 3E9";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      input.blur();
      await new Promise((res) => setTimeout(res, 20));
      api.setTiming({ typeaheadResultsMs: 800 });
      const [r] = await api.fill([{ fieldId: "address.postalCode", value: "K2K 3E9" }]);
      expect(r).toMatchObject({ ok: true, readBack: "K2K 3E9" });
    }, 10_000);

    it("searches a list that didn't show within the open waits", async () => {
      api.setTiming({ dropdownOpenMs: 10, dropdownOpenRetryMs: 10 });
      const [r] = await api.fill([{ fieldId: "address.postalCode", value: "K2K 3E9" }]);
      expect(r).toMatchObject({ ok: true, readBack: "K2K 3E9" });
    });
  });

  it("takes a phone number the page formats as it likes", async () => {
    const [r] = await api.fill([{ fieldId: "contact-information.phoneNumber", value: "613-555-0199" }]);
    expect(r).toMatchObject({ ok: true, readBack: "(613) 555-0199" });
  });

  it("reports the options when nothing matches, and leaves the old choice in place", async () => {
    await api.fill([{ fieldId: "address.country", value: "Finland" }]);
    const [r] = await api.fill([{ fieldId: "address.country", value: "Narnia" }]);
    expect(r).toMatchObject({ ok: false, error: 'No option matches "Narnia".' });
    await new Promise((res) => setTimeout(res, 20));
    // The typed text went back to the choice on blur, and Escape never hit the closed list (it would clear it).
    expect(fixture.comboValue("country-30")).toBe("Finland");
    expect(fields()["address.country"]?.currentValue).toBe("Finland");
  });

  it("lists and searches a dropdown's options", async () => {
    expect((await api.listOptions("address.country")).map((o) => o.label)).toContain("Finland");
    await api.fill([{ fieldId: "address.country", value: "United States" }]);
    expect(await api.searchOptions("address.city", "bos")).toEqual([{ label: "Boston, Massachusetts" }]);
    expect(fixture.comboValue("country-30")).toBe("United States");
  });

  it("enters a date through its month, day and year lists", async () => {
    const [r] = await api.fill([{ fieldId: "application-questions.expected-graduation-date", value: "2027-04-30" }]);
    expect(r).toMatchObject({ ok: true, readBack: "2027-04-30" });
    expect(fixture.comboValue("month-300000392474837-24")).toBe("April");
    const [short] = await api.fill([{ fieldId: "application-questions.expected-graduation-date", value: "2027" }]);
    expect(short).toMatchObject({ ok: false, error: "This date needs a month." });
  });
});

describe("attachments", () => {
  it("uploads a resume and confirms it by the file shown", async () => {
    const r = await api.upload("resume-and-urls.resume", pdf("resume.pdf"));
    expect(r).toMatchObject({ ok: true, readBack: ["resume.pdf"] });
    expect(fields()["resume-and-urls.resume"]?.currentValue).toEqual(["resume.pdf"]);
  });

  it("asks for a profile's old resume to be removed first, then replaces it", async () => {
    setup({ resumeOnFile: "old-resume.pdf" });
    const blocked = await api.upload("resume-and-urls.resume", pdf("resume.pdf"));
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/remove_items/) });
    expect(await api.remove("resume-and-urls.resume")).toMatchObject({
      ok: true,
      removed: ["old-resume.pdf"],
      remaining: [],
    });
    expect(await api.upload("resume-and-urls.resume", pdf("resume.pdf"))).toMatchObject({ ok: true });
  });

  it("adds several additional documents and removes one", async () => {
    await api.upload("additional-documents.attachment", pdf("transcript.pdf"));
    await api.upload("additional-documents.attachment", pdf("letter.pdf"));
    expect(fields()["additional-documents.attachment"]?.currentValue).toEqual(["transcript.pdf", "letter.pdf"]);
    expect(await api.remove("additional-documents.attachment", ["letter"])).toMatchObject({
      ok: true,
      removed: ["letter.pdf"],
      remaining: ["transcript.pdf"],
    });
  });

  it("unselects options of a multi-choice question", async () => {
    await api.fill([{ fieldId: "application-questions.which-areas-interest-you", value: ["DSP", "Test"] }]);
    expect(await api.remove("application-questions.which-areas-interest-you", ["Test"])).toMatchObject({
      ok: true,
      removed: ["Test"],
      remaining: ["DSP"],
    });
  });
});

describe("repeatable items", () => {
  it("adds a language through its inline form and Save, and deletes the saved tile", async () => {
    expect(await api.addRepeatable("add.language")).toEqual({ ok: true });
    const form = api.getForm();
    expect(form.addButtons.map((b) => b.id)).toContain("save.languages");
    // Saving an empty form: the page says what it wants and the form stays open.
    const early = await api.addRepeatable("save.languages");
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/required/) });
    const results = await api.fill([
      { fieldId: "languages.language", value: "French" },
      { fieldId: "languages.readingLevel", value: "Fluent" },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await api.addRepeatable("save.languages")).toEqual({ ok: true });
    // The page announces "Saved" in an alert region: a notice, not an error.
    expect(api.getForm()).toMatchObject({ errors: [], messages: ["Saved"] });
    const tile = api.getForm().sections.find((s) => s.id === "languages.item-1");
    expect(tile).toMatchObject({ title: "Languages: French, Fluent", removable: true });
    expect(await api.removeRepeatable("languages.item-1")).toMatchObject({ ok: true, removed: "French, Fluent" });
    expect(api.getForm().sections.find((s) => s.id === "languages.item-1")).toBeUndefined();
  });

  it("deletes a timeline entry through the button it shows on hover", async () => {
    const r = await api.removeRepeatable("work-and-education-history.experience-1");
    expect(r).toMatchObject({ ok: true, removed: "Acme Corp, Intern" });
  });

  it("adds another link row", async () => {
    expect(await api.addRepeatable("add.link")).toEqual({ ok: true });
    expect(fields()["resume-and-urls.siteLink-2"]).toMatchObject({ label: "Link 2", kind: "text" });
  });
});

describe("moving and never submitting", () => {
  it("refuses to go on from a single-page application: Submit is the user's", async () => {
    const r = await api.next();
    expect(r).toMatchObject({ advanced: false, refusedReason: expect.stringMatching(/Submit/) });
    expect(fixture.submitClicks()).toBe(0);
  });

  it("moves through the multi-page flow, reports validation errors, goes back, and stops at Submit", async () => {
    setup({ multiPage: true });
    expect(api.getForm()).toMatchObject({ step: { title: "Personal Info", index: 1, total: 3 }, nextLabel: "Next" });
    const blocked = await api.next();
    expect(blocked).toMatchObject({ advanced: false, errors: ["This field is required."] });
    await api.fill([{ fieldId: "contact-information.lastName", value: "Doe" }]);
    expect(await api.next()).toMatchObject({ advanced: true, step: { title: "Job Application Questions", index: 2 } });
    expect(api.getForm().backLabel).toBe("Previous");
    expect(await api.back()).toMatchObject({ moved: true, step: { title: "Personal Info" } });
    await api.next();
    await api.next();
    expect(api.getForm()).toMatchObject({ step: { index: 3 }, nextLabel: "Submit" });
    expect(await api.next()).toMatchObject({ advanced: false, refusedReason: expect.stringMatching(/Submit/) });
    expect(fixture.submitClicks()).toBe(0);
  });

  it("blocks synthetic clicks on Submit, while a real click goes through", () => {
    const submit = document.querySelector<HTMLElement>(".apply-flow-pagination__submit-button") as HTMLElement;
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fixture.submitClicks()).toBe(0);
    expect(api.blockedSubmitAttempts()).toHaveLength(1);
  });

  it("presses Use My Profile", async () => {
    setup({ profileChoice: true });
    expect(await api.pageAction("use_last_application")).toEqual({ ok: true, pageKind: "step" });
    expect(await api.pageAction("apply")).toMatchObject({ ok: false });
  });
});
