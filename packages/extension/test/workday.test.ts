// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkdayApi, installSubmitGuard } from "../src/adapters/workday/api.js";
import { press } from "../src/adapters/workday/dom.js";
import { buildWorkdayStep } from "./workday-fixture.js";

// jsdom lacks DataTransfer; the adapter only needs items.add + files.
class FakeDataTransfer {
  private list: File[] = [];
  items = { add: (f: File) => this.list.push(f) };
  get files() {
    const l = this.list;
    return Object.assign([...l], { item: (i: number) => l[i] ?? null }) as unknown as FileList;
  }
}
(globalThis as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer;

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
      addButtons: [{ id: "add.add-work-experience", label: "Add Work Experience" }],
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

  it("adds a repeatable row with its own field ids", async () => {
    expect(await api.addRepeatable("add.add-work-experience")).toEqual({ ok: true });
    const ids = api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .filter((f) => f.automationId === "formField-jobTitle")
      .map((f) => f.id);
    expect(ids).toEqual(["work-experience-1.jobTitle", "work-experience-2.jobTitle"]);
  });
});

describe("navigation and the submit guard", () => {
  it("reports validation errors instead of advancing", async () => {
    const r = await api.next();
    expect(r.advanced).toBe(false);
    expect(r.errors).toContain("Error: First Name is required");
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
