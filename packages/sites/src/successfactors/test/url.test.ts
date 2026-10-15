import { describe, expect, it } from "vitest";
import { detectSite, siteJob, siteTenant } from "../../registry.js";

describe("SAP SuccessFactors", () => {
  const APPLY = "https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000&career_ns=job_application";

  it("knows its career sites' pages on any data centre's host; not the employer's own careers site or other hosts", () => {
    for (const url of [
      APPLY,
      "https://career17.sapsf.com/careers?company=soylent&career_job_req_id=1000",
      "https://career2.successfactors.eu/sfcareer/jobreqcareer?jobId=1000&company=soylent",
      "https://career5.sapsf.eu/career?company=soylent",
      // Signed in: a session token only.
      "https://career17.sapsf.com/portalcareer?_s.crb=0000",
    ]) {
      expect([url, detectSite(url)]).toEqual([url, "successfactors"]);
    }
    for (const url of [
      "https://careers.soylent.example/job/Springfield-Software-Developer/1000/",
      "http://career17.sapsf.com/career?company=soylent&career_job_req_id=1000",
      "https://performancemanager4.successfactors.com/sf/home",
      "https://career17.sapsf.com/xi/ui/rcmcareer/pages/rcmFileUploadPopup.xhtml",
      "https://career17.sapsf.com.example/career?company=soylent",
    ]) {
      expect([url, detectSite(url)]).toEqual([url, "generic"]);
    }
  });

  it("reads the employer from `company` and the requisition as the job; a signed-in page's URL has neither", () => {
    expect([siteTenant(APPLY), siteJob(APPLY)]).toEqual(["soylent", "1000"]);
    const older = "https://career2.successfactors.eu/sfcareer/jobreqcareer?jobId=1000&company=Soylent";
    expect([siteTenant(older), siteJob(older)]).toEqual(["soylent", "1000"]);
    const portal = "https://career17.sapsf.com/portalcareer?_s.crb=0000";
    expect([siteTenant(portal), siteJob(portal)]).toEqual([undefined, undefined]);
  });
});
