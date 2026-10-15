// @vitest-environment jsdom

import { createAdapter } from "@ezapply/engine/api";
import { describe, expect, it } from "vitest";
import { fieldsOf, loadSaved as load } from "../../../test/adapters.js";
import { ashby } from "../definition/site.js";

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
