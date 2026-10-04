// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workday } from "../src/adapters/sites/workday/site.js";
import { extractPage } from "./adapters.js";

const extract = (doc: Document, url: string) => extractPage(workday, doc, url);

const load = (name: string) => {
  const html = readFileSync(join(import.meta.dirname, "fixtures", "live", `${name}.html`), "utf8");
  document.documentElement.innerHTML = html.replace(/^<!--[\s\S]*?-->\s*/, "");
  return extract(document, "https://initech.wd5.myworkdayjobs.com/en-US/InitechCareers/job/x").schema;
};

describe("live Workday snapshots", () => {
  it("recognises a job posting and its Apply action", () => {
    expect(load("posting")).toMatchObject({ pageKind: "posting", actions: ["apply"], tenant: "initech" });
  });

  it("recognises the start-choice dialog and its options", () => {
    const s = load("start-choice");
    expect(s.pageKind).toBe("start-choice");
    expect(s.actions).toEqual(
      expect.arrayContaining(["apply_manually", "autofill_with_resume", "use_last_application"]),
    );
  });

  it("recognises the sign-in step (which has a progress bar)", () => {
    expect(load("auth")).toMatchObject({
      pageKind: "auth",
      step: { title: "Create Account/Sign In", index: 1, total: 6 },
      sections: [],
    });
  });
});

describe("a live My Experience step (employer details and the user's values replaced)", () => {
  const load = () => {
    const html = readFileSync(join(import.meta.dirname, "fixtures", "live", "my-experience.html"), "utf8");
    document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*/i, "");
    return extract(document, "https://cyberdyne.wd5.myworkdayjobs.com/en-US/CyberdyneCareers/job/x/apply/applyManually")
      .schema;
  };

  it("marks every row removable by its Delete button, and nothing else", () => {
    const s = load();
    expect(s.step).toMatchObject({ index: 2, title: "My Experience" });
    expect(s.job).toEqual({ title: "Software Developer Intern" });
    expect(s.sections.filter((x) => x.removable).map((x) => x.id)).toEqual([
      "work-experience-1",
      "work-experience-2",
      "education-1",
      "languages-1",
      "languages-2",
      "languages-3",
      "websites-1",
      "websites-2",
    ]);
  });

  it("reads split dates from their display parts", () => {
    const dates = Object.fromEntries(
      load()
        .sections.flatMap((x) => x.fields)
        .filter((f) => f.kind === "date")
        .map((f) => [f.id, f.currentValue]),
    );
    expect(dates).toMatchObject({
      "work-experience-1.startDate": "2020-12",
      "work-experience-1.endDate": "2021-06",
      "education-1.lastYearAttended": "2024",
    });
  });
});
