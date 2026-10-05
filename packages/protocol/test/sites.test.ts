import { describe, expect, it } from "vitest";
import {
  detectSite,
  FORM_SITE_IDS,
  HOST_PERMISSIONS,
  SITES,
  SiteId,
  siteInfo,
  siteJob,
  siteOfUrl,
  siteSignatures,
  siteTenant,
} from "../src/index.js";

describe("the site registry", () => {
  it("names every form site the schema's SiteId knows, and nothing else", () => {
    expect([...FORM_SITE_IDS, "generic"].sort()).toEqual([...SiteId.options].sort());
  });

  it("has the extension hold every site, so it can read any page for a site's signature", () => {
    expect(HOST_PERMISSIONS).toEqual(["<all_urls>"]);
  });

  it("gives every site a signature, checked in registry order", () => {
    expect(siteSignatures().map(([id]) => id)).toEqual([...FORM_SITE_IDS]);
    for (const s of SITES) expect([s.id, s.signature.trim().length > 0]).toEqual([s.id, true]);
  });
});

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
});

describe("Greenhouse", () => {
  it("knows its job boards, old and new, the EU's, and the embed; not other hosts", () => {
    for (const url of [
      "https://job-boards.greenhouse.io/vandelay/jobs/1000000001",
      "https://boards.greenhouse.io/vandelay/jobs/1000000001",
      "https://job-boards.eu.greenhouse.io/acme/jobs/1",
      "https://job-boards.greenhouse.io/embed/job_app?for=initech&token=1000000002",
    ]) {
      expect(detectSite(url)).toBe("greenhouse");
    }
    expect(detectSite("https://www.greenhouse.io/careers")).toBe("generic");
    expect(detectSite("https://www.example.com/company/careers/open-positions/job?gh_jid=1000000002")).toBe("generic");
  });

  it("reads the board and the job, from the path or the embed's parameters", () => {
    expect(siteTenant("https://job-boards.greenhouse.io/Vandelay/jobs/1000000001")).toBe("vandelay");
    expect(siteJob("https://job-boards.greenhouse.io/vandelay/jobs/1000000001")).toBe("1000000001");
    const embed = "https://job-boards.greenhouse.io/embed/job_app?for=initech&token=1000000002";
    expect([siteTenant(embed), siteJob(embed)]).toEqual(["initech", "1000000002"]);
  });

  it("reads the job a company's careers page names for its embedded board, and only there", () => {
    const greenhouse = siteInfo("greenhouse");
    const page = "https://careers.example.com/jobs/1000039/software-engineering-intern/?gh_src=dv1&gh_jid=1000039";
    expect(greenhouse?.hostPageJob?.(page)).toBe("1000039");
    expect(greenhouse?.hostPageJob?.("https://job-boards.greenhouse.io/vandelay/jobs/1?gh_jid=2")).toBeUndefined();
    expect(greenhouse?.hostPageJob?.("https://acme.com/careers?gh_jid=abc")).toBeUndefined();
    expect(SITES.filter((s) => s.hostPageJob).map((s) => s.id)).toEqual(["greenhouse"]);
  });
});

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

describe("Ashby", () => {
  it("reads the organization and the job, and makes the Application tab the posting's", () => {
    const tab = "https://jobs.ashbyhq.com/stark/7d2e9b14-0000-4000-8000-000000000002/application";
    expect(detectSite(tab)).toBe("ashby");
    expect([siteTenant(tab), siteJob(tab)]).toEqual(["stark", "7d2e9b14-0000-4000-8000-000000000002"]);
    expect(siteOfUrl(tab)?.canonicalPath?.("/stark/7d2e9b14/application")).toBe("/stark/7d2e9b14");
    expect(detectSite("https://www.ashbyhq.com/")).toBe("generic");
  });
});
