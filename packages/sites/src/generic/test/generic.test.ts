import { createAdapter } from "@ezapply/engine/api";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { installDomShims } from "../../../../engine/test/shims.js";
import { generic } from "../definition/site.js";
import { APPLICATION, APPLY_BUTTON, CONFIRMATION, NO_APPLICATION, SIGN_IN } from "./forms.js";

const URL = "https://careers.example.com/jobs/software-developer/apply";

/** The generic adapter on a page of its own (its own window, so its own submit guard). */
function open(body: string) {
  const dom = new JSDOM("<!doctype html><html><head><title>Careers at Example</title></head><body></body></html>", {
    url: URL,
  });
  installDomShims(dom.window as unknown as Window);
  const doc = dom.window.document;
  doc.body.innerHTML = body;
  return { doc, api: createAdapter(generic, doc, () => URL) };
}

const fieldsOf = (form: ReturnType<ReturnType<typeof open>["api"]["getForm"]>) =>
  Object.fromEntries(form.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));

describe("an employer's own application form (generic)", () => {
  it("reads the application form, not the newsletter beside it: one page, Submit at the end", () => {
    const form = open(APPLICATION).api.getForm();
    expect(form).toMatchObject({
      adapter: "generic",
      tenant: "careers.example.com",
      pageKind: "step",
      step: { title: "Software Developer" },
      lastPage: true,
      nextLabel: "Submit application",
      job: { title: "Software Developer" },
      errors: [],
    });
    expect(form.sections.map((s) => s.title)).toEqual(["Personal information", "Your application"]);
    expect(Object.keys(fieldsOf(form))).not.toContain("personal-information.nl");
  });

  it("reads each native control with its prompt, by label, aria-labelledby or placeholder, and hints it", () => {
    const f = fieldsOf(open(APPLICATION).api.getForm());
    expect(f["personal-information.first-name"]).toMatchObject({
      kind: "text",
      label: "First name",
      required: true,
      hint: { profileKey: "identity.firstName" },
    });
    expect(f["personal-information.last-name"]).toMatchObject({
      required: true,
      hint: { profileKey: "identity.lastName" },
    });
    expect(f["personal-information.email"]).toMatchObject({ label: "Email", hint: { profileKey: "contact.email" } });
    expect(f["personal-information.phone"]).toMatchObject({
      label: "Phone",
      hint: { profileKey: "contact.phone.number" },
    });
    expect(f["personal-information.urls-linkedin"]).toMatchObject({
      label: "LinkedIn profile",
      hint: { profileKey: "links.linkedin" },
    });
    expect(f["personal-information.country"]).toMatchObject({
      kind: "dropdown",
      options: ["Canada", "United States"],
      currentValue: null,
      hint: { profileKey: "contact.address.country" },
    });
    // A file input hidden behind its label still counts.
    expect(f["your-application.resume"]).toMatchObject({ kind: "file", label: "Resume", currentValue: [] });
    expect(f["your-application.start-date"]).toMatchObject({ kind: "date", dateParts: ["MM", "DD", "YYYY"] });
    expect(f["your-application.years"]).toMatchObject({ kind: "number" });
    expect(f["your-application.why"]).toMatchObject({ kind: "textarea", required: false });
    expect(f["personal-information.source"]).toBeUndefined();
  });

  it("groups radios and checkboxes by name, prompted by their legend or the text above them", () => {
    const f = fieldsOf(open(APPLICATION).api.getForm());
    expect(f["your-application.authorized"]).toMatchObject({
      kind: "radio",
      label: "Are you legally authorized to work in this country?",
      options: ["Yes", "No"],
      required: true,
    });
    expect(f["your-application.languages"]).toMatchObject({
      kind: "checkbox-group",
      label: "Which languages do you speak?",
      options: ["English", "French"],
    });
    expect(f["your-application.consent"]).toMatchObject({
      kind: "checkbox",
      label: "I agree to the privacy policy",
      currentValue: false,
    });
  });

  it("leaves out what it can't place, and says how many for the user to fill", () => {
    const form = open(APPLICATION).api.getForm();
    expect(Object.keys(fieldsOf(form))).toHaveLength(13);
    expect(form.messages).toEqual([expect.stringMatching(/^2 controls on this form aren't a plain HTML field/)]);
    // Choices straight in the form, with nothing around them but the form itself, aren't a group it can hold.
    const bare = open(APPLY_BUTTON).api.getForm();
    expect(Object.keys(fieldsOf(bare))).toEqual(["application.name", "application.email", "application.cover"]);
    expect(fieldsOf(bare)["application.name"]?.hint).toEqual({ profileKey: "identity.fullName" });
    expect(bare.messages).toEqual([expect.stringMatching(/^1 control on this form isn't/)]);
  });

  it("fills them through the shared drivers and uploads to the file input", async () => {
    const { doc, api } = open(APPLICATION);
    api.getForm();
    const results = await api.fill([
      { fieldId: "personal-information.first-name", value: "Jane" },
      { fieldId: "personal-information.country", value: "Canada" },
      { fieldId: "your-application.start-date", value: "2027-01-04" },
      { fieldId: "your-application.authorized", value: "Yes" },
      { fieldId: "your-application.languages", value: ["English", "French"] },
      { fieldId: "your-application.consent", value: true },
    ]);
    expect(results.map((r) => [r.fieldId, r.ok])).toEqual(results.map((r) => [r.fieldId, true]));
    expect(doc.querySelector<HTMLInputElement>("#fn")?.value).toBe("Jane");
    expect(doc.querySelector<HTMLInputElement>("input[name='consent']")?.checked).toBe(true);
    const upload = await api.upload("your-application.resume", {
      name: "resume.pdf",
      mimeType: "application/pdf",
      base64: "JVBERi0=",
    });
    expect(upload).toMatchObject({ ok: true, readBack: ["resume.pdf"] });
  });

  it("finds no application in a sign-in, search or newsletter form", () => {
    for (const page of [SIGN_IN, NO_APPLICATION]) {
      const form = open(page).api.getForm();
      expect([form.pageKind, form.sections]).toEqual(["unknown", []]);
    }
  });

  it("knows the confirmation page after the user's Submit", () => {
    expect(open(CONFIRMATION).api.getForm().pageKind).toBe("confirmation");
  });

  it("refuses to submit, and blocks synthetic presses of Submit, Apply and the form's own submit event", async () => {
    const { doc, api } = open(APPLICATION);
    api.getForm();
    expect((await api.next()).refusedReason).toMatch(/only way forward is Submit/);
    const w = doc.defaultView as Window & typeof globalThis;
    const form = doc.querySelector("#apply") as HTMLFormElement;
    let sent = 0;
    form.addEventListener("submit", () => sent++);
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    expect(sent).toBe(0);

    const other = open(APPLY_BUTTON);
    const apply = other.doc.querySelector("button") as HTMLButtonElement;
    let pressed = false;
    apply.addEventListener("click", () => {
      pressed = true;
    });
    expect(other.api.getForm()).toMatchObject({ lastPage: true, nextLabel: "Apply now" });
    apply.click();
    expect(pressed).toBe(false);
    expect(other.api.blockedSubmitAttempts()).toHaveLength(1);
  });
});
