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
    expect(companyFromUrl("https://careers.stark.com/jobs/1")).toBe("stark");
  });

  it("canonicalizeUrl keeps only job id params", () => {
    expect(canonicalizeUrl("https://Example.com/jobs/1/?utm_source=x&gh_jid=42")).toBe(
      "https://example.com/jobs/1?gh_jid=42",
    );
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
      join(import.meta.dirname, "..", "..", "extension", "test", "fixtures", "live", "posting.html"),
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
