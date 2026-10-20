import { describe, expect, it } from "vitest";
import { companyFromUrl, extractPosting, splitTitle } from "../src/postings/extract.js";
import { canonicalizeUrl, slugify } from "../src/postings/service.js";

const LONG = "We build reliable distributed systems for payments. ".repeat(20);

describe("extractPosting", () => {
  it("uses Workday automation ids for description and metadata", () => {
    const html = `
      <header>Acme careers nav</header>
      <h2 data-automation-id="jobPostingHeader">Backend Engineer</h2>
      <div data-automation-id="locations"><dt>locations</dt><dd>Austin, TX</dd></div>
      <div data-automation-id="requisitionId"><dt>job requisition id</dt><dd>R-1234</dd></div>
      <div data-automation-id="jobPostingDescription"><h3>About the role</h3><p>${LONG}</p><ul><li>Go</li><li>Postgres</li></ul></div>
      <footer>cookie banner</footer>`;
    const out = extractPosting({
      visibleHtml: html,
      url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Backend-Engineer_R-1234",
      pageTitle: "Backend Engineer",
      jsonLd: [],
    });
    expect(out.site).toBe("workday");
    expect(out.tenant).toBe("acme");
    expect(out.role).toBe("Backend Engineer");
    expect(out.location).toBe("Austin, TX");
    expect(out.reqId).toBe("R-1234");
    expect(out.markdown).toContain("### About the role");
    expect(out.markdown).toContain("- Go");
    expect(out.markdown).not.toContain("cookie banner");
  });

  it("prefers JSON-LD JobPosting metadata", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Platform Engineer",
      hiringOrganization: { "@type": "Organization", name: "Globex" },
      identifier: { "@type": "PropertyValue", value: 987 },
      jobLocation: { "@type": "Place", address: { addressLocality: "Denver", addressRegion: "CO" } },
    });
    const out = extractPosting({
      visibleHtml: `<main><article><h1>Platform Engineer</h1><p>${LONG}</p></article></main>`,
      url: "https://boards.greenhouse.io/globex/jobs/987",
      pageTitle: "Job Application for Platform Engineer at Globex",
      jsonLd: [ld],
    });
    expect(out).toMatchObject({ role: "Platform Engineer", company: "Globex", reqId: "987", location: "Denver, CO" });
    expect(out.markdown).toContain("reliable distributed systems");
  });

  it("takes the site the extension found on the page, and reads the tenant as that site does", () => {
    const url = "https://careers.example.com/global/en/job/R-0000000001/Software-Developer-Intern";
    const input = { visibleHtml: `<p>${LONG}</p>`, url, pageTitle: "Software Developer Intern", jsonLd: [] };
    expect(extractPosting(input)).toMatchObject({ site: "generic" });
    expect(extractPosting({ ...input, site: "phenom" })).toMatchObject({
      site: "phenom",
      tenant: "careers.example.com",
    });
    // Generic from the page says nothing: the URL decides.
    const workday = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Backend-Engineer_R-1234";
    expect(extractPosting({ ...input, url: workday, site: "generic" })).toMatchObject({ site: "workday" });
  });

  it("strips scripts and styles", () => {
    const out = extractPosting({
      visibleHtml: `<p>${LONG}</p><script>alert(1)</script><style>.x{}</style>`,
      url: "https://example.com/jobs/1",
      pageTitle: "Engineer - Example",
      jsonLd: [],
    });
    expect(out.markdown).not.toContain("alert");
  });
});

describe("helpers", () => {
  it.each([
    ["Job Application for Data Engineer at Initech", { role: "Data Engineer", company: "Initech" }],
    ["Senior SWE - Hooli Careers", { role: "Senior SWE", company: "Hooli" }],
    ["Staff Engineer | Pied Piper | Jobs", { role: "Staff Engineer", company: "Pied Piper" }],
    ["Careers", {}],
  ])("splitTitle(%s)", (title, expected) => {
    expect(splitTitle(title)).toEqual(expected);
  });

  it("companyFromUrl", () => {
    expect(companyFromUrl("https://jobs.lever.co/umbrella/abc")).toBe("umbrella");
    expect(companyFromUrl("https://acme.wd1.myworkdayjobs.com/x")).toBe("acme");
    expect(companyFromUrl("https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/1")).toBe("acme");
    expect(companyFromUrl("https://careers.stark.com/jobs/1")).toBe("stark");
    // Job boards whose paths don't name the company: leave it to the title and JSON-LD.
    expect(companyFromUrl("https://www.linkedin.com/jobs/view/4012345678")).toBeUndefined();
    expect(companyFromUrl("https://www.indeed.com/viewjob?jk=abc123")).toBeUndefined();
    expect(companyFromUrl("https://www.indeed.com/cmp/Initech/jobs")).toBe("Initech");
    // A provider's data centre names no employer.
    expect(companyFromUrl("https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000")).toBeUndefined();
  });

  it("companyFromUrl asks the sites: their boards' hosts name the employer only in the path", () => {
    expect(companyFromUrl("https://job-boards.greenhouse.io/vandelay/jobs/1000000001")).toBe("vandelay");
    expect(companyFromUrl("https://boards.greenhouse.io/vandelay/jobs/1")).toBe("vandelay");
    expect(companyFromUrl("https://jobs.eu.lever.co/wonka/5c1e7a2b")).toBe("wonka");
    expect(companyFromUrl("https://jobs.ashbyhq.com/stark/7d2e9b14/application")).toBe("stark");
    expect(
      companyFromUrl(
        "https://fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1",
      ),
    ).toBeUndefined();
    expect(companyFromUrl("https://career2.successfactors.eu/career?company=soylent")).toBeUndefined();
    // An employer's own domain (an Oracle or Phenom site on it) names the employer.
    expect(companyFromUrl("https://jobs.umbrella.example/en/sites/CX_1/job/10001")).toBe("umbrella");
    // Dayforce's one host for every employer names none.
    expect(companyFromUrl("https://jobs.dayforcehcm.com/en-US/hooli/CANDIDATEPORTAL/jobs/1000")).toBeUndefined();
  });

  it("canonicalizeUrl keeps every site's job parameters, and the common ones", () => {
    expect(
      canonicalizeUrl("https://jobs.globex.example/ca/en/apply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA&step=2"),
    ).toBe("https://jobs.globex.example/ca/en/apply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA");
    expect(canonicalizeUrl("https://www.indeed.com/viewjob?jk=abc123&from=serp")).toBe(
      "https://www.indeed.com/viewjob?jk=abc123",
    );
  });

  it("canonicalizeUrl keeps only job id params", () => {
    expect(canonicalizeUrl("https://Example.com/jobs/1/?utm_source=x&gh_jid=42")).toBe(
      "https://example.com/jobs/1?gh_jid=42",
    );
  });

  it("canonicalizeUrl keeps a SuccessFactors requisition with its employer, on a host every employer shares", () => {
    expect(
      canonicalizeUrl(
        "https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000&career_ns=job_application&navBarLevel=JOB_SEARCH",
      ),
    ).toBe("https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000");
  });

  it("canonicalizeUrl drops Workday's locale segment, so one job is one posting", () => {
    const bare = "https://acme.wd5.myworkdayjobs.com/External/job/Austin/Backend_R-1";
    expect(canonicalizeUrl("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Backend_R-1")).toBe(bare);
    expect(canonicalizeUrl(bare)).toBe(bare);
    // Elsewhere a path like /en-US/ may be meaningful and stays.
    expect(canonicalizeUrl("https://example.com/en-US/jobs/1")).toBe("https://example.com/en-US/jobs/1");
  });

  it("canonicalizeUrl makes an Oracle job one posting, whatever its language or application page", () => {
    const job = "https://jobs.umbrella.example/sites/CX_1/job/10001";
    expect(canonicalizeUrl("https://jobs.umbrella.example/en/sites/CX_1/job/10001")).toBe(job);
    expect(canonicalizeUrl("https://jobs.umbrella.example/fr/sites/CX_1/job/10001/apply/section/2")).toBe(job);
  });

  it("reads an Oracle career site's tenant, and takes no company from an Oracle Cloud host", () => {
    const r = extractPosting({
      visibleHtml: "<h1>Firmware Engineering Co-op</h1><p>Build firmware.</p>",
      url: "https://fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/10001",
      pageTitle: "Firmware Engineering Co-op - Umbrella Careers",
      jsonLd: [],
    });
    expect(r).toMatchObject({
      site: "oracle",
      tenant: "fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com/cx_1",
      company: "Umbrella",
      role: "Firmware Engineering Co-op",
    });
  });

  it("reads the tenant from the path on myworkdaysite.com and records an embedded frame", () => {
    const html = `<div data-automation-id="jobPostingHeader">Analyst</div>
      <div data-automation-id="jobPostingDescription"><p>${"Analyze things. ".repeat(40)}</p></div>`;
    const r = extractPosting({
      visibleHtml: html,
      url: "https://careers.acme.com/jobs?gh_jid=1",
      frameUrl: "https://wd5.myworkdaysite.com/recruiting/acme/External/job/Analyst_R-9",
      pageTitle: "Careers at Acme",
      jsonLd: [],
    });
    expect(r).toMatchObject({ site: "workday", tenant: "acme", role: "Analyst", company: "acme" });
    expect(r.markdown).toContain("- Embedded from: https://wd5.myworkdaysite.com/recruiting/acme/");
  });

  it("slugify", () => {
    expect(slugify("Señor Engineer (Backend) — Platform", 50)).toBe("senor-engineer-backend-platform");
  });
});

describe("live Workday posting", () => {
  it("extracts description and metadata from a real page", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const html = readFileSync(
      join(import.meta.dirname, "..", "..", "sites", "src", "workday", "fixtures", "posting.html"),
      "utf8",
    );
    const out = extractPosting({
      visibleHtml: html,
      url: "https://initech.wd5.myworkdayjobs.com/en-US/InitechCareers/details/Senior-Software-Architect_JR1000001-1",
      pageTitle: "Senior Software Architect",
      jsonLd: [],
    });
    expect(out).toMatchObject({
      site: "workday",
      tenant: "initech",
      company: "initech",
      role: "Senior Software Architect",
      reqId: "JR1000001",
    });
    expect(out.markdown).toContain("Design, build and maintain placeholder systems.");
    expect(out.markdown).not.toMatch(/Similar Jobs|Follow Us/i);
  });
});
