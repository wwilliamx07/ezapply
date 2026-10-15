import { describe, expect, it } from "vitest";
import { detectSite, siteJob, siteOfUrl, siteTenant } from "../../registry.js";

describe("Lever", () => {
  it("reads the company and the posting, and makes the application the posting's", () => {
    const apply = "https://jobs.lever.co/wonka/5c1e7a2b-0000-4000-8000-000000000001/apply";
    expect(detectSite(apply)).toBe("lever");
    expect(detectSite("https://jobs.eu.lever.co/acme/1")).toBe("lever");
    expect([siteTenant(apply), siteJob(apply)]).toEqual(["wonka", "5c1e7a2b-0000-4000-8000-000000000001"]);
    expect(siteOfUrl(apply)?.canonicalPath?.("/wonka/5c1e7a2b/apply")).toBe("/wonka/5c1e7a2b");
    expect(detectSite("https://www.lever.co/")).toBe("generic");
  });
});
