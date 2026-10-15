import { describe, expect, it } from "vitest";
import { detectSite, siteInfo, siteJob, siteTenant } from "../../registry.js";

describe("Dayforce", () => {
  const APPLY =
    "https://jobs.dayforcehcm.com/en-US/examplecorp/CANDIDATEPORTAL/jobs/1000/apply/manualApplication?applicationSource=Manual";

  it("knows a posting and its application by their path, with or without a locale; not other pages or hosts", () => {
    for (const url of [
      APPLY,
      "https://jobs.dayforcehcm.com/en-US/examplecorp/CANDIDATEPORTAL/jobs/1000",
      "https://jobs.dayforcehcm.com/examplecorp/CANDIDATEPORTAL/jobs/1000/apply/manualApplication",
      "https://jobs.dayforcehcm.com/zh-Hans-SG/examplecorp/CANDIDATEPORTAL/jobs/1000",
      // A client namespace as short as a language code.
      "https://jobs.dayforcehcm.com/abc/CANDIDATEPORTAL/jobs/7",
    ]) {
      expect([url, detectSite(url)]).toEqual([url, "dayforce"]);
    }
    for (const url of [
      "https://jobs.dayforcehcm.com/en-US/examplecorp/CANDIDATEPORTAL",
      "https://jobs.dayforcehcm.com/en-US/examplecorp/CANDIDATEPORTAL/jobs/abc",
      "http://jobs.dayforcehcm.com/en-US/examplecorp/CANDIDATEPORTAL/jobs/1000",
      "https://us58.dayforcehcm.com/CandidatePortal/en-US/examplecorp/Posting/View/1000",
      "https://jobs.example.com/en-US/examplecorp/CANDIDATEPORTAL/jobs/1000",
    ]) {
      expect([url, detectSite(url)]).toEqual([url, "generic"]);
    }
  });

  it("reads the client namespace as the tenant and the posting id as the job, on the posting and every step", () => {
    expect([siteTenant(APPLY), siteJob(APPLY)]).toEqual(["examplecorp", "1000"]);
    const dayforce = siteInfo("dayforce");
    expect(dayforce?.canonicalPath?.("/en-US/examplecorp/CANDIDATEPORTAL/jobs/1000/apply/manualApplication")).toBe(
      "/examplecorp/CANDIDATEPORTAL/jobs/1000",
    );
    expect(dayforce?.canonicalPath?.("/abc/CANDIDATEPORTAL/jobs/7")).toBe("/abc/CANDIDATEPORTAL/jobs/7");
    // The search page, known by its body: the client after the locale, and no job.
    const search = "https://jobs.dayforcehcm.com/en-US/examplecorp/CANDIDATEPORTAL";
    expect([dayforce?.tenant(search), dayforce?.job(search)]).toEqual(["examplecorp", undefined]);
  });
});
