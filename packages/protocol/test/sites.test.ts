import { describe, expect, it } from "vitest";
import {
  detectSite,
  FORM_SITE_IDS,
  fixedHostPermissions,
  optionalHostPermissions,
  SITES,
  SiteId,
  siteInfo,
  siteJob,
  siteOfUrl,
  siteTenant,
} from "../src/index.js";

describe("the site registry", () => {
  it("names every form site the schema's SiteId knows, and nothing else", () => {
    expect([...FORM_SITE_IDS, "generic"].sort()).toEqual([...SiteId.options].sort());
  });

  it("grants Workday's hosts at install and every other site one origin at a time", () => {
    expect(fixedHostPermissions()).toEqual(["*://*.myworkdayjobs.com/*", "*://*.myworkdaysite.com/*"]);
    expect(optionalHostPermissions()).toEqual(["https://*/*"]);
    expect(SITES.filter((s) => s.access.kind === "per-origin").map((s) => s.id)).toEqual([
      "oracle",
      "greenhouse",
      "lever",
      "ashby",
    ]);
  });
});

describe("Greenhouse", () => {
  it("knows its job boards, old and new, the EU's, and the embed; not other hosts", () => {
    for (const url of [
      "https://job-boards.greenhouse.io/vandelay/jobs/1000000001",
      "https://boards.greenhouse.io/vandelay/jobs/1000000001",
      "https://job-boards.eu.greenhouse.io/acme/jobs/1",
      "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1000000002",
    ]) {
      expect(detectSite(url)).toBe("greenhouse");
    }
    expect(detectSite("https://www.greenhouse.io/careers")).toBe("generic");
    expect(detectSite("https://careers.example.com/company/careers/open-positions/job?gh_jid=1000000002")).toBe("generic");
  });

  it("reads the board and the job, from the path or the embed's parameters", () => {
    expect(siteTenant("https://job-boards.greenhouse.io/Vandelay/jobs/1000000001")).toBe("vandelay");
    expect(siteJob("https://job-boards.greenhouse.io/vandelay/jobs/1000000001")).toBe("1000000001");
    const embed = "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1000000002";
    expect([siteTenant(embed), siteJob(embed)]).toEqual(["acme", "1000000002"]);
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
