import { describe, expect, it } from "vitest";
import { detectSite, SITES, siteInfo, siteJob, siteTenant } from "../../registry.js";

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
