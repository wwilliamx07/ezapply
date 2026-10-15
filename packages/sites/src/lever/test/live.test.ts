// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fieldsOf, loadSaved as load } from "../../../test/adapters.js";
import { lever } from "../definition/site.js";

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
