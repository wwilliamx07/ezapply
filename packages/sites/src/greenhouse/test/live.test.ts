// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPage, fieldsOf, loadSaved as load } from "../../../test/adapters.js";
import { greenhouse } from "../definition/site.js";

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
