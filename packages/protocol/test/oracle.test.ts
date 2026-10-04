import { describe, expect, it } from "vitest";
import { detectSite, isOracleUrl, oracleJobPath, oracleTenant, siteTenant } from "../src/index.js";

describe("Oracle career sites", () => {
  it("knows an Oracle page by its path, on Oracle's own hosts and on employers' domains", () => {
    expect(detectSite("https://jobs.umbrella.example/en/sites/CX_1/job/10001")).toBe("oracle");
    expect(detectSite("https://jobs.umbrella.example/en/sites/CX_1/job/10001/apply/section/1")).toBe("oracle");
    expect(
      detectSite("https://fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1"),
    ).toBe("oracle");
    expect(detectSite("https://careers.acme.com/fr-CA/sites/jobsearch/requisitions/preview/12")).toBe("oracle");
    // Other pages that merely have "sites" in the path, and plain http, aren't.
    expect(detectSite("https://example.com/en/sites/about")).toBe("generic");
    expect(detectSite("https://intranet.acme.com/sites/hr/job/1")).toBe("generic");
    expect(isOracleUrl("http://jobs.umbrella.example/en/sites/CX_1/job/1")).toBe(false);
    expect(isOracleUrl("not a url")).toBe(false);
  });

  it("reads the tenant as host and site number, the same for a job and its application", () => {
    expect(oracleTenant("https://Jobs.Umbrella.example/en/sites/CX_1/job/10001")).toBe("jobs.umbrella.example/cx_1");
    expect(oracleTenant("https://jobs.umbrella.example/en/sites/CX_1/job/10001/apply/email")).toBe(
      "jobs.umbrella.example/cx_1",
    );
    expect(oracleTenant("https://example.com/jobs/1")).toBeUndefined();
    expect(siteTenant("https://acme.wd5.myworkdayjobs.com/en-US/External/job/x")).toBe("acme");
    expect(siteTenant("https://jobs.umbrella.example/en/sites/CX_1/my-profile")).toBe("jobs.umbrella.example/cx_1");
  });

  it("identifies a job by its path without the language or the application pages", () => {
    expect(oracleJobPath("/en/sites/CX_1/job/10001/apply/section/1")).toBe("/sites/CX_1/job/10001");
    expect(oracleJobPath("/hcmUI/CandidateExperience/fr-CA/sites/CX/job/7")).toBe(
      "/hcmUI/CandidateExperience/sites/CX/job/7",
    );
  });
});

describe("siteJob", () => {
  it("reads the Workday requisition and the Oracle job id, on postings and applications alike", async () => {
    const { siteJob, sameJob } = await import("../src/index.js");
    expect(
      siteJob(
        "https://initech.wd5.myworkdayjobs.com/en-US/InitechCareers/job/Springfield/Senior-Architect_JR1000001-1/apply/applyManually",
      ),
    ).toBe("jr1000001-1");
    expect(siteJob("https://initech.wd5.myworkdayjobs.com/en-US/Site/details/Senior-Architect_JR1000001-1/apply")).toBe(
      "jr1000001-1",
    );
    expect(siteJob("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto/Engineer_R123")).toBe("r123");
    expect(siteJob("https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply")).toBeUndefined();
    expect(siteJob("https://jobs.acme.com/en/sites/CX_1/job/42/apply/section/1")).toBe("42");
    expect(siteJob("https://jobs.acme.com/en/sites/CX_1/jobs?keyword=x")).toBeUndefined();
    expect(siteJob("https://example.com/careers/123")).toBeUndefined();
    expect(sameJob("JR1000001", "jr1000001-1")).toBe(true);
    expect(sameJob("r123", "r1234")).toBe(false);
  });
});
