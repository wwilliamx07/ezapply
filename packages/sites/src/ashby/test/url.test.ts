import { describe, expect, it } from "vitest";
import { detectSite, siteJob, siteOfUrl, siteTenant } from "../../registry.js";

describe("Ashby", () => {
  it("reads the organization and the job, and makes the Application tab the posting's", () => {
    const tab = "https://jobs.ashbyhq.com/stark/7d2e9b14-0000-4000-8000-000000000002/application";
    expect(detectSite(tab)).toBe("ashby");
    expect([siteTenant(tab), siteJob(tab)]).toEqual(["stark", "7d2e9b14-0000-4000-8000-000000000002"]);
    expect(siteOfUrl(tab)?.canonicalPath?.("/stark/7d2e9b14/application")).toBe("/stark/7d2e9b14");
    expect(detectSite("https://www.ashbyhq.com/")).toBe("generic");
  });
});
