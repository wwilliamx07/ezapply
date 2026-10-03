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
