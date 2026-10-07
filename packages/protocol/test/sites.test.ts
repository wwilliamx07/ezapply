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
