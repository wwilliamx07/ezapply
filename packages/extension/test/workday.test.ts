// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkdayApi, installSubmitGuard } from "../src/adapters/workday/api.js";
import { matchOption, press } from "../src/adapters/workday/dom.js";
import { buildWorkdayStep, installDomShims } from "./workday-fixture.js";

installDomShims(document.defaultView as Window);

let fixture: ReturnType<typeof buildWorkdayStep>;
let api: ReturnType<typeof createWorkdayApi>;

beforeEach(() => {
  fixture = buildWorkdayStep(document);
  api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
});

describe("extraction", () => {
  it("describes the step, fields, kinds, labels, hints and actions", () => {
    const form = api.getForm();
    expect(form).toMatchObject({
      adapter: "workday",
      tenant: "acme",
      pageKind: "step",
      step: { title: "My Information", index: 1, total: 3 },
      nextLabel: "Save and Continue",
      addButtons: [
        { id: "add.work-experience", label: "Add Work Experience", section: "Work Experience" },
        { id: "add.websites", label: "Add", section: "Websites" },
      ],
    });
    const fields = Object.fromEntries(form.sections.flatMap((s) => s.fields).map((f) => [f.automationId, f]));
    expect(fields["formField-legalName--firstName"]).toMatchObject({
      label: "First Name",
      kind: "text",
      required: true,
      hint: { profileKey: "identity.firstName" },
      id: "my-information.legalName--firstName",
    });
    expect(fields["formField-countryDropdown"]).toMatchObject({
      kind: "dropdown",
      currentValue: null,
      optionsLazy: true,
    });
    expect(fields["formField-source"]).toMatchObject({ kind: "typeahead", label: "How Did You Hear About Us?" });
    expect(fields["formField-previousWorker"]).toMatchObject({
      kind: "radio",
      label: "Have you previously worked for Acme?",
      options: ["Yes", "No"],
      required: true,
    });
    expect(fields["formField-agreement"]).toMatchObject({ kind: "checkbox", currentValue: false });
    expect(fields["formField-startDate"]).toMatchObject({ kind: "date", dateParts: ["MM", "YYYY"] });
    expect(fields["formField-resume"]).toMatchObject({ kind: "file", currentValue: [] });
    expect(fields["formField-jobTitle"]?.id).toBe("work-experience-1.jobTitle");
  });
});

describe("filling", () => {
  const id = (automationId: string) =>
    api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .find((f) => f.automationId === automationId)?.id as string;

  it("fills text, dropdown, radio, checkbox and date fields and reads them back", async () => {
    const res = await api.fill([
      { fieldId: id("formField-legalName--firstName"), value: "Jane" },
      { fieldId: id("formField-countryDropdown"), value: "united states" },
      { fieldId: id("formField-previousWorker"), value: "No" },
      { fieldId: id("formField-agreement"), value: true },
      { fieldId: id("formField-startDate"), value: "2026-11" },
    ]);
    expect(res.map((r) => [r.ok, r.readBack])).toEqual([
      [true, "Jane"],
      [true, "United States of America"],
      [true, "No"],
      [true, true],
      [true, "2026-11"],
    ]);
    expect(document.getElementById("lb-country")).toBeNull(); // listbox closed afterwards
  });

  it("selects typeahead options, including through a nested menu", async () => {
    const [flat] = await api.fill([{ fieldId: id("formField-source"), value: "Company Website" }]);
    expect(flat).toMatchObject({ ok: true, readBack: ["Company Website"] });
    const [nested] = await api.fill([{ fieldId: id("formField-source"), value: "Job Board > LinkedIn" }]);
    expect(nested).toMatchObject({ ok: true, readBack: ["Company Website", "LinkedIn"] });
  });

  it("lists and searches options", async () => {
    expect((await api.listOptions(id("formField-countryDropdown"))).map((o) => o.label)).toContain("Canada");
    const found = await api.searchOptions(id("formField-source"), "job");
    expect(found).toEqual([{ label: "Job Board", hasChildren: true }]);
  });

  it("reads each dropdown's own options when one follows another", async () => {
    // Live Workday: the listbox just closed is still on screen, and buttons have no aria-controls.
    const res = await api.fill([
      { fieldId: id("formField-countryDropdown"), value: "Canada" },
      { fieldId: id("formField-degreeLevel"), value: "Masters" },
    ]);
    expect(res.map((r) => [r.ok, r.readBack])).toEqual([
      [true, "Canada"],
      [true, "Masters"],
    ]);
    expect((await api.listOptions(id("formField-countryDropdown"))).map((o) => o.label)).toContain("Canada");
    expect((await api.listOptions(id("formField-degreeLevel"))).map((o) => o.label)).toEqual([
      "Undergraduate",
      "Masters",
      "Ph.D",
    ]);
    const [miss] = await api.fill([{ fieldId: id("formField-degreeLevel"), value: "Diploma" }]);
    expect(miss?.availableOptions).toEqual(["Undergraduate", "Masters", "Ph.D"]);
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(0);
  });

  /** Count entries of the month: input events that leave it with two digits. */
  const countMonthEntries = () => {
    const month = document.querySelector(
      '[data-automation-id="formField-startDate"] input[aria-label="Month"]',
    ) as HTMLInputElement;
    const entries = vi.fn();
    month.addEventListener("input", () => {
      if (month.value.length === 2) entries();
    });
    return entries;
  };

  it("enters a date a second time when the field still shows an error", async () => {
    fixture = buildWorkdayStep(document, { dateNeedsSecondPass: true });
    api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
    const entries = countMonthEntries();
    const [r] = await api.fill([{ fieldId: id("formField-startDate"), value: "2024-12" }]);
    expect(r).toEqual({ fieldId: id("formField-startDate"), ok: true, readBack: "2024-12" });
    expect(entries).toHaveBeenCalledTimes(2);
  });

  it("enters a date once when the page accepts it", async () => {
    const entries = countMonthEntries();
    const [r] = await api.fill([{ fieldId: id("formField-startDate"), value: "2024-12" }]);
    expect(r).toMatchObject({ ok: true, readBack: "2024-12" });
    expect(entries).toHaveBeenCalledTimes(1);
  });

  describe("dates in Workday's split widget", () => {
    const build = (dateWidget: "keys" | "stuck") => {
      fixture = buildWorkdayStep(document, { dateWidget });
      api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
    };
    const displays = () => [...document.querySelectorAll('[data-automation-id$="-display"]')].map((d) => d.textContent);

    it("types the digits so the widget takes them", async () => {
      build("keys");
      const [r] = await api.fill([{ fieldId: id("formField-startDate"), value: "2024-12" }]);
      expect(r).toMatchObject({ ok: true, readBack: "2024-12" });
      expect(displays()).toEqual(["12", "2024"]);
      const [again] = await api.fill([{ fieldId: id("formField-startDate"), value: "06/2023" }]);
      expect(again).toMatchObject({ ok: true, readBack: "2023-06" });
      expect(displays()).toEqual(["06", "2023"]);
    });

    it("reports a date the widget didn't take, and get_form shows it empty", async () => {
      build("stuck");
      const [r] = await api.fill([{ fieldId: id("formField-startDate"), value: "2024-12" }]);
      expect(r).toMatchObject({ ok: false, readBack: "" });
      expect(r?.error).toMatch(/didn't take the date.*12\/2024/);
      const field = api
        .getForm()
        .sections.flatMap((s) => s.fields)
        .find((f) => f.automationId === "formField-startDate");
      expect(field?.currentValue).toBeNull();
    });
  });

  it("says a field that still shows an error wasn't filled", async () => {
    fixture = buildWorkdayStep(document, { dateErrorSticks: true });
    api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
    const [r] = await api.fill([{ fieldId: id("formField-startDate"), value: "2024-12" }]);
    expect(r).toMatchObject({ ok: false, readBack: "2024-12" });
    expect(r?.error).toMatch(/^The page still reports: .*required/);
  });

  it("opens the next dropdown after one that matched nothing, with live listbox behaviour", async () => {
    fixture = buildWorkdayStep(document, { liveDropdowns: true });
    api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
    const res = await api.fill([
      { fieldId: id("formField-degreeLevel"), value: "Diploma" },
      { fieldId: id("formField-countryDropdown"), value: "Canada" },
    ]);
    expect(res.map((r) => [r.ok, r.readBack ?? r.availableOptions])).toEqual([
      [false, ["Undergraduate", "Masters", "Ph.D"]],
      [true, "Canada"],
    ]);
    const [next] = await api.fill([{ fieldId: id("formField-degreeLevel"), value: "Masters" }]);
    expect(next).toMatchObject({ ok: true, readBack: "Masters" });
  });

  it("fills a skills list entry by entry, waiting for each search's results", async () => {
    await api.remove(id("formField-skills"));
    const [r] = await api.fill([
      { fieldId: id("formField-skills"), value: ["Python", "SQL", "Nginx", "C++", "Lua", "React.js"] },
    ]);
    expect(r).toMatchObject({
      ok: false,
      readBack: [
        "Python (Programming Language)",
        "Structured Query Language (SQL)",
        "C++ Programming Language",
        "React.js",
      ],
      unmatched: [
        { value: "Nginx", suggestions: ["Nginx Web Server", "NGINX Plus"] },
        { value: "Lua", suggestions: [] },
      ],
    });
    expect(r?.error).toBe('No option matches: "Nginx", "Lua".');
  }, 30_000);

  it("searches once the results are in, listing each option once", async () => {
    expect((await api.searchOptions(id("formField-skills"), "python")).map((o) => o.label)).toEqual([
      "Python (Programming Language)",
      "Python Development",
    ]);
    expect((await api.searchOptions(id("formField-skills"), "sql")).map((o) => o.label)).toEqual([
      "Structured Query Language (SQL)",
      "U-SQL",
    ]);
  });

  it("reports unmatched options with the choices available", async () => {
    const [r] = await api.fill([{ fieldId: id("formField-countryDropdown"), value: "Narnia" }]);
    expect(r).toMatchObject({ ok: false, availableOptions: ["Canada", "United States of America", "United Kingdom"] });
  });

  it("refuses passwords, bad dates and unknown fields", async () => {
    const pw = document.createElement("div");
    pw.setAttribute("data-automation-id", "formField-password");
    pw.innerHTML = '<label for="pw">Password</label><input id="pw" type="password">';
    document.querySelector('[data-automation-id="formField-legalName--firstName"]')?.after(pw);
    expect(api.getForm().pageKind).toBe("auth");
    const res = await api.fill([
      { fieldId: id("formField-password"), value: "hunter2" },
      { fieldId: id("formField-startDate"), value: "next spring" },
      { fieldId: "nope.nope", value: "x" },
    ]);
    expect(res.map((r) => r.ok)).toEqual([false, false, false]);
    expect(res[0]?.error).toMatch(/Password/);
    expect(res[2]?.error).toMatch(/Unknown field/);
  });

  it("uploads a file", async () => {
    const r = await api.upload(id("formField-resume"), {
      name: "Doe_Resume.pdf",
      mimeType: "application/pdf",
      base64: btoa("%PDF-1.4"),
    });
    expect(r).toMatchObject({ ok: true, readBack: ["Doe_Resume.pdf"] });
  });

  it("shows what a previous application left in multi-select and file fields", () => {
    const fields = api.getForm().sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f.automationId === "formField-skills")).toMatchObject({
      kind: "typeahead",
      currentValue: ["Java", "COBOL", "Customer Service", "Fortran"],
    });
    expect(fields.find((f) => f.automationId === "formField-coverLetter")).toMatchObject({
      kind: "file",
      currentValue: ["cover.pdf"],
    });
  });

  it("removes chosen skills, by their charm or the keyboard, and reports what's left", async () => {
    const r = await api.remove(id("formField-skills"), ["cobol", "Fortran", "Rust"]);
    expect(r).toMatchObject({
      ok: false,
      removed: ["COBOL", "Fortran"],
      remaining: ["Java", "Customer Service"],
      notFound: ["Rust"],
    });
    expect(r.error).toMatch(/Not in the field: Rust/);

    const all = await api.remove(id("formField-skills"));
    expect(all).toMatchObject({ ok: true, removed: ["Java", "Customer Service"], remaining: [] });
  });

  it("unattaches an old file, confirming the dialog, then uploads the new one", async () => {
    const removed = await api.remove(id("formField-coverLetter"));
    expect(removed).toMatchObject({ ok: true, removed: ["cover.pdf"], remaining: [] });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const up = await api.upload(id("formField-coverLetter"), {
      name: "cover.pdf",
      mimeType: "application/pdf",
      base64: btoa("%PDF-1.4"),
    });
    expect(up).toMatchObject({ ok: true, readBack: ["cover.pdf"] });
  });

  it("refuses fields it can't remove from", async () => {
    const r = await api.remove(id("formField-legalName--firstName"));
    expect(r).toMatchObject({ ok: false, removed: [] });
    expect(r.error).toMatch(/text field. Use fill_fields/);
  });

  it("adds a repeatable row with its own field ids", async () => {
    expect(await api.addRepeatable("add.work-experience")).toEqual({ ok: true });
    const ids = api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .filter((f) => f.automationId === "formField-jobTitle")
      .map((f) => f.id);
    expect(ids).toEqual(["work-experience-1.jobTitle", "work-experience-2.jobTitle"]);
  });

  it("marks rows with their own Delete button removable, and nothing else", () => {
    const removable = api
      .getForm()
      .sections.filter((s) => s.removable)
      .map((s) => s.id);
    expect(removable).toEqual(["work-experience-1"]);
  });

  it("removes a repeatable row, confirming the dialog, and later rows move up", async () => {
    await api.addRepeatable("add.work-experience");
    const title = () =>
      api
        .getForm()
        .sections.flatMap((s) => s.fields)
        .filter((f) => f.automationId === "formField-jobTitle");
    await api.fill([{ fieldId: "work-experience-2.jobTitle", value: "Engineer" }]);

    const r = await api.removeRepeatable("work-experience-1");
    expect(r).toEqual({ sectionId: "work-experience-1", ok: true, removed: "Work Experience 1" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(title().map((f) => [f.id, f.currentValue])).toEqual([["work-experience-1.jobTitle", "Engineer"]]);

    expect(await api.removeRepeatable("my-information")).toMatchObject({ ok: false, error: /No removable row/ });
  });
});

describe("matching option text", () => {
  const pick = (wanted: string, options: string[]) => options[matchOption(wanted, options)];

  it("matches a bare name or an acronym in parentheses, counting repeated labels once", () => {
    const skills = ["Python (Programming Language)", "Python (Programming Language)", "Python Development"];
    expect(pick("python", skills)).toBe("Python (Programming Language)");
    expect(pick("SQL", ["Structured Query Language (SQL)", "U-SQL", "SQLCLR"])).toBe("Structured Query Language (SQL)");
    expect(pick("JavaScript", ["JavaScript", "JavaScript", "JScript"])).toBe("JavaScript");
    expect(matchOption("Nginx", ["Nginx Web Server", "NGINX Plus"])).toBe(-1);
  });

  it("doesn't guess between two options that both fit", () => {
    const eligible = ["Yes, I am a citizen or permanent resident of Canada", "Yes, I possess a temporary work permit"];
    expect(matchOption("Yes", eligible)).toBe(-1);
  });

  it("resolves decline to the form's own decline wording", () => {
    expect(pick("decline", ["Female", "Male", "I do not wish to self-identify"])).toBe(
      "I do not wish to self-identify",
    );
    expect(pick("I prefer not to respond", ["Yes", "No", "I prefer not to identify"])).toBe("I prefer not to identify");
    expect(matchOption("decline", ["Yes", "No"])).toBe(-1);
  });
});

describe("uploading over a leftover file", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("doesn't mistake a same-named file from a previous application for the new upload", async () => {
    vi.useFakeTimers();
    fixture = buildWorkdayStep(document, { coverUploadsWork: false });
    api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
    const fieldId = api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .find((f) => f.automationId === "formField-coverLetter")?.id as string;
    const pending = api.upload(fieldId, { name: "cover.pdf", mimeType: "application/pdf", base64: btoa("%PDF") });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await pending).toMatchObject({ ok: false, error: "The upload did not appear in the field." });
  });
});

describe("navigation and the submit guard", () => {
  it("reports validation errors instead of advancing", async () => {
    const r = await api.next();
    expect(r.advanced).toBe(false);
    expect(r.errors).toContain("Error: First Name is required");
  });

  it("keeps upload notices out of errors", async () => {
    const resume = api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .find((f) => f.automationId === "formField-resume")?.id as string;
    await api.upload(resume, { name: "resume.pdf", mimeType: "application/pdf", base64: btoa("%PDF") });
    const form = api.getForm();
    expect(form.messages).toEqual(["resume.pdf successfully uploaded"]);
    expect(form.errors).toEqual([]);
    expect(form.sections.flatMap((s) => s.fields).find((f) => f.id === resume)?.error).toBeUndefined();
    const r = await api.next();
    expect(r).toMatchObject({ advanced: false, messages: ["resume.pdf successfully uploaded"] });
    expect(r.errors).toEqual(["Error: First Name is required"]);
  });

  it("counts a move to the next step when every step has the same title", async () => {
    fixture = buildWorkdayStep(document, { sameStepTitles: true });
    api = createWorkdayApi(document, () => "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply");
    const fn = api.getForm().sections[0]?.fields[0]?.id as string;
    await api.fill([{ fieldId: fn, value: "Jane" }]);
    const started = Date.now();
    const r = await api.next();
    expect(r).toMatchObject({ advanced: true, pageKind: "review", step: { index: 3, title: "Application" } });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("advances to review, then refuses to go further", async () => {
    const fn = api.getForm().sections[0]?.fields[0]?.id as string;
    await api.fill([{ fieldId: fn, value: "Jane" }]);
    const r = await api.next();
    expect(r).toMatchObject({ advanced: true, pageKind: "review", step: { title: "Review" } });
    const again = await api.next();
    expect(again.advanced).toBe(false);
    expect(again.refusedReason).toMatch(/user must press Submit/);
    expect(fixture.submitClicks()).toBe(0);
  });

  it("goes back from the review page to the step, with its entries, and refuses on the first step", async () => {
    const first = await api.back();
    expect(first).toMatchObject({ moved: false, refusedReason: expect.stringMatching(/No Back button/) });

    const fn = api.getForm().sections[0]?.fields[0]?.id as string;
    await api.fill([{ fieldId: fn, value: "Jane" }]);
    await api.next();
    expect(api.getForm()).toMatchObject({ pageKind: "review", backLabel: "Back" });
    const r = await api.back();
    expect(r).toMatchObject({ moved: true, pageKind: "step", step: { title: "My Information" } });
    const form = api.getForm();
    expect(form.backLabel).toBeUndefined();
    expect(form.sections[0]?.fields[0]).toMatchObject({ id: fn, currentValue: "Jane" });
    expect(fixture.submitClicks()).toBe(0);
  });

  it("blocks synthetic clicks on Submit even from other scripts", async () => {
    const fn = api.getForm().sections[0]?.fields[0]?.id as string;
    await api.fill([{ fieldId: fn, value: "Jane" }]);
    await api.next();
    installSubmitGuard(document);
    const submit = document.querySelector('[data-automation-id="bottom-navigation-next-button"]') as HTMLElement;
    press(submit);
    submit.click();
    expect(fixture.submitClicks()).toBe(0);
    expect(api.blockedSubmitAttempts().length).toBeGreaterThan(0);
  });
});
