import { describe, expect, it } from "vitest";
import { detectSite, sameJob, siteInfo, siteJob, siteTenant } from "../../registry.js";

describe("Phenom", () => {
  const APPLY =
    "https://jobs.globex.example/ca/en/apply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA&step=2&stepname=workAndEducation";

  it("knows an apply page by its path and jobSeqNo, on any host; not the employer's other pages", () => {
    for (const url of [
      APPLY,
      "https://jobs.globex.example/ca/en/hvhapply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA",
      "https://careers.example.com/apply?jobSeqNo=EXAMA0001R1EXTERNALENUS",
      "https://careers.example.com/us/en-us/apply?jobSeqNo=X1",
      // A region rather than a country before the language.
      "https://careers.example.com/global/en/apply?jobSeqNo=EXAMA0001R1EXTERNALENGLOBAL&step=1&stepname=personalInformation",
    ]) {
      expect(detectSite(url)).toBe("phenom");
    }
    for (const url of [
      "https://jobs.globex.example/ca/en/job/R-0000000001/Software-Developer-Intern",
      "https://jobs.globex.example/ca/en/apply",
      "https://jobs.globex.example/ca/en/apply?step=1",
      "http://jobs.globex.example/ca/en/apply?jobSeqNo=X1",
      "https://www.example.com/jobs/apply-now?jobSeqNo=X1",
    ]) {
      expect(detectSite(url)).toBe("generic");
    }
  });

  it("reads the careers host as the tenant and jobSeqNo as the job, whatever the step", () => {
    expect([siteTenant(APPLY), siteJob(APPLY)]).toEqual(["jobs.globex.example", "globa0001r0000000001externalenca"]);
    expect(siteInfo("phenom")?.canonicalPath?.("/ca/en/hvhapply")).toBe("/ca/en/apply");
  });

  it("reads the tenant of any page of the site, and the job only where the URL names jobSeqNo", () => {
    // A posting page the extension knows is Phenom's by its body: its own id isn't jobSeqNo.
    const posting = "https://jobs.globex.example/ca/en/job/R-0000000001/Software-Developer-Intern";
    const phenom = siteInfo("phenom");
    expect([phenom?.tenant(posting), phenom?.job(posting)]).toEqual(["jobs.globex.example", undefined]);
    expect(phenom?.tenant("http://jobs.globex.example/")).toBeUndefined();
  });

  it("takes a jobSeqNo and the requisition it embeds for one job, and only with the site named", () => {
    const seq = "exampglobal1000001externalenglobal";
    expect(sameJob(seq, "1000001", "phenom")).toBe(true);
    expect(sameJob("globa0001r0000000001externalenca", "R-0000000001", "phenom")).toBe(true);
    expect(sameJob(seq, "exampglobal1000002externalenglobal", "phenom")).toBe(false);
    // Digits running on are another number; too short or no digit says nothing.
    expect(sameJob("exampglobal11000001externalenglobal", "1000001", "phenom")).toBe(false);
    expect(sameJob("exampglobal10000012externalenglobal", "1000001", "phenom")).toBe(false);
    expect(sameJob(seq, "001", "phenom")).toBe(false);
    expect(sameJob(seq, "global", "phenom")).toBe(false);
    // Other sites keep the strict rule.
    expect(sameJob(seq, "1000001")).toBe(false);
    expect(sameJob(seq, "1000001", "workday")).toBe(false);
  });
});
