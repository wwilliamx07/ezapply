import type { PostingMeta } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import { compareTitles, matchPosting, type PostingFacts, postingFacts, tabSite } from "../src/forms/match.js";
import { applicationFromUrl, checkReqId, findApplication } from "../src/postings/application.js";

const AT = "2026-10-04T00:00:00.000Z";
const APPLY =
  "https://cyberdyne.wd5.myworkdayjobs.com/CyberdyneCareers/job/Springfield/Software-Developer-Intern_Req100012/apply?source=Other_Other";
/** The links of an employer's own posting page (a live one, employer details replaced): the application, sign-in, a test host. */
const CAREERS_PAGE = `
  <a href="${APPLY.replace(/&/g, "&amp;")}">Apply</a>
  <a href="https://cyberdyne.wd5.myworkdayjobs.com/en-US/CyberdyneCareers/login">Sign in</a>
  <a href="https://cyberdyne.wd5.myworkdayjobs-impl.com/en-US/CyberdyneCareers/introduceYourself">Join</a>
  <a href="${APPLY}">Apply now</a>`;

describe("finding a posting's application from its capture", () => {
  it("takes the one application its links lead to, ignoring links without a job", () => {
    const app = findApplication({
      html: CAREERS_PAGE,
      url: "https://careers.cyberdyne.example/job-view/x-100067",
      at: AT,
    });
    expect(app).toEqual({
      url: APPLY,
      site: "workday",
      tenant: "cyberdyne",
      job: "req100012",
      from: "apply-link",
      at: AT,
    });
  });

  it("among several jobs takes the requisition's, else none", () => {
    const other = APPLY.replace("Software-Developer-Intern_Req100012", "AI-Developer_Req100010");
    const html = `${CAREERS_PAGE}<a href='${other}'>Other job</a>`;
    const url = "https://careers.cyberdyne.example/job-view/x";
    expect(findApplication({ html, url, at: AT })).toBeUndefined();
    expect(findApplication({ html, url, reqId: "Req100010", at: AT })?.job).toBe("req100010");
  });

  it("reads an embedded board's job from the careers page's URL when no link names one", () => {
    const url = "https://careers.globex.example/jobs/1000039/software-engineering-intern/?gh_src=dv1&gh_jid=1000039";
    expect(findApplication({ html: "<a href='/jobs'>Jobs</a>", url, at: AT })).toEqual({
      url,
      site: "greenhouse",
      job: "1000039",
      from: "host-page-job",
      at: AT,
    });
  });

  it("ties a Phenom posting page to its apply flow by the Apply link, and the flow's steps to it by jobSeqNo", () => {
    const posting = "https://jobs.globex.example/ca/en/job/R-0000000001/Software-Developer-Intern";
    const link = "https://jobs.globex.example/ca/en/hvhapply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA";
    const app = findApplication({
      html: `<a data-ph-at-id="apply-link" href="${link}">Apply Now</a>`,
      url: posting,
      at: AT,
    });
    expect(app).toMatchObject({
      site: "phenom",
      tenant: "jobs.globex.example",
      job: "globa0001r0000000001externalenca",
    });
    const facts = postingFacts({ id: "p", url: posting, capturedAt: AT } as PostingMeta, app);
    const step =
      "https://jobs.globex.example/ca/en/apply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA&step=2&stepname=workAndEducation";
    expect(matchPosting(facts, { url: step })).toEqual({ verdict: "same", by: ["job"] });
  });

  it("picks a Phenom posting's own Apply among similar jobs' by the requisition its jobSeqNo embeds", () => {
    const posting = "https://careers.example.com/global/en/job/1000001/Software-Developer-Co-op";
    const apply = (req: string) =>
      `https://careers.example.com/global/en/hvhapply?jobSeqNo=EXAMGLOBAL${req}EXTERNALENGLOBAL`;
    const html = [apply("1000001"), apply("1000036"), apply("1000208")].map((h) => `<a href="${h}">Apply</a>`).join("");
    const app = findApplication({ html, url: posting, reqId: "1000001", at: AT });
    expect(app?.job).toBe("examglobal1000001externalenglobal");
    expect(findApplication({ html, url: posting, reqId: "1000002", at: AT })).toBeUndefined();
  });

  it("finds nothing on a page that leads to no form site (a school's job board)", () => {
    const html = `<a href="https://example-csm.symplicity.com/students/app/jobs">Back</a><a href="mailto:x@y.z">Mail</a>`;
    expect(
      findApplication({ html, url: "https://example-csm.symplicity.com/students/app/jobs/detail/1", at: AT }),
    ).toBeUndefined();
  });

  it("takes a posting captured on a form site as its own application", () => {
    const url = "https://hooli.wd3.myworkdayjobs.com/en-US/campus/job/Toronto-ON/Software-Developer-Co-op_1000454";
    expect(applicationFromUrl({ url, capturedAt: AT })).toMatchObject({
      site: "workday",
      tenant: "hooli",
      job: "1000454",
      from: "posting-url",
    });
    expect(applicationFromUrl({ url: "https://careers.cyberdyne.example/job-view/x", capturedAt: AT })).toBeUndefined();
  });

  it("refuses a title given as a requisition", () => {
    expect(checkReqId(" Req100010 ")).toEqual({ ok: true, value: "Req100010" });
    expect(checkReqId("R-0000100575")).toEqual({ ok: true, value: "R-0000100575" });
    expect(checkReqId("General - Software Engineer, Intern, 2027").ok).toBe(false);
  });
});

const meta = (over: Partial<PostingMeta>): PostingMeta => ({
  schemaVersion: 1,
  id: "p",
  url: "https://careers.cyberdyne.example/job-view/x",
  canonicalUrl: "https://careers.cyberdyne.example/job-view/x",
  pageTitle: "",
  site: "generic",
  status: "captured",
  capturedAt: AT,
  updatedAt: AT,
  ...over,
});

describe("which posting a tab belongs to", () => {
  const A = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto/Backend-Engineer_R100/apply";
  const B = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto/Data-Engineer_R200/apply";
  const noJob = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply";
  const facts = (over: Partial<PostingFacts> = {}): PostingFacts => ({ id: "p", ...over });

  it("decides by job first: the same requisition, or another", () => {
    const p = facts({ site: "workday", tenant: "acme", job: "r100" });
    expect(matchPosting(p, { url: A })).toEqual({ verdict: "same", by: ["job"] });
    expect(matchPosting(p, { url: B })).toEqual({ verdict: "other", by: ["job"] });
    // A job match wins over a binding to another posting.
    expect(matchPosting(p, { url: A }, { postingId: "q", tenant: "acme" }).verdict).toBe("same");
  });

  it("goes by the site the extension found on the page when the URL names none", () => {
    // A Phenom posting page on the employer's domain: no form site's URL, but its body is Phenom's.
    const page = "https://careers.example.com/global/en/job/R-0000000001/Software-Developer-Intern";
    expect(tabSite(page)).toEqual({});
    expect(tabSite(page, "phenom")).toEqual({ site: "phenom", tenant: "careers.example.com" });
    expect(tabSite(page, "generic")).toEqual({});
    const p = facts({ site: "phenom", tenant: "careers.example.com" });
    expect(matchPosting(p, { url: page, site: "phenom" })).toEqual({ verdict: "same", by: ["tenant"] });
    expect(matchPosting(p, { url: page })).toEqual({ verdict: "unconfirmed", by: [] });
    // The apply page names the job: jobSeqNo.
    const apply = "https://careers.example.com/global/en/apply?jobSeqNo=EXAMA0001R1EXTERNALENGLOBAL&step=1";
    const q = facts({ site: "phenom", tenant: "careers.example.com", job: "exama0001r1externalenglobal" });
    expect(matchPosting(q, { url: apply, site: "phenom" })).toEqual({ verdict: "same", by: ["job"] });
    // A posting that knows only its requisition (no Apply link captured) matches the jobSeqNo that embeds it.
    const seq = "https://careers.example.com/global/en/apply?jobSeqNo=EXAMGLOBAL1000001EXTERNALENGLOBAL&step=1";
    const byReq = postingFacts(meta({ url: page, reqId: "1000001" }), undefined);
    expect(byReq.job).toBe("1000001");
    expect(matchPosting(byReq, { url: seq, site: "phenom" })).toEqual({ verdict: "same", by: ["job"] });
    const otherReq = postingFacts(meta({ url: page, reqId: "1000002" }), undefined);
    expect(matchPosting(otherReq, { url: seq, site: "phenom" })).toEqual({ verdict: "other", by: ["job"] });
  });

  it("refuses a tab on another site than the posting's application", () => {
    const p = facts({ site: "greenhouse", job: "1000039" });
    expect(matchPosting(p, { url: A })).toEqual({ verdict: "other", by: ["site"] });
  });

  it("holds a binding while the tab stays on its employer", () => {
    const p = facts({ role: "Intern" });
    expect(matchPosting(p, { url: noJob }, { postingId: "p", tenant: "acme" })).toEqual({
      verdict: "same",
      by: ["binding"],
    });
    expect(matchPosting(p, { url: noJob }, { postingId: "q", tenant: "acme" })).toEqual({
      verdict: "other",
      by: ["binding"],
    });
    const elsewhere = "https://globex.wd1.myworkdayjobs.com/en-US/Careers/job/y/apply";
    expect(matchPosting(p, { url: elsewhere }, { postingId: "q", tenant: "acme" }).verdict).toBe("unconfirmed");
  });

  it("then the requisition the page shows, then the tenant", () => {
    expect(matchPosting(facts({ job: "r100" }), { url: noJob, reqId: "R100" }).by).toEqual(["page-reqid"]);
    expect(matchPosting(facts({ job: "r100" }), { url: noJob, reqId: "R200" }).verdict).toBe("other");
    expect(matchPosting(facts({ tenant: "acme" }), { url: noJob })).toEqual({ verdict: "same", by: ["tenant"] });
    expect(matchPosting(facts({ tenant: "globex" }), { url: noJob })).toEqual({ verdict: "other", by: ["tenant"] });
  });

  it("uses the page's title only where no job id is known, and leaves the rest unconfirmed", () => {
    const p = facts({ role: "Full Stack Software Developer Intern" });
    expect(matchPosting(p, { url: noJob, title: "Software Developer Intern" })).toEqual({
      verdict: "same",
      by: ["title"],
    });
    expect(matchPosting(p, { url: noJob, title: "Store Associate" }).verdict).toBe("other");
    expect(matchPosting(p, { url: noJob, title: "Software Developer, Data Platform" }).verdict).toBe("unconfirmed");
    expect(matchPosting(p, { url: noJob })).toEqual({ verdict: "unconfirmed", by: [] });
  });

  it("compares titles by their significant words", () => {
    expect(compareTitles("Intern, AI Machine Learning Developer", "AI/Machine Learning Developer (Intern)")).toBe(
      "same",
    );
    expect(compareTitles("Data Analyst", "Backend Engineer")).toBe("other");
    expect(compareTitles("Co-op Student I - IT Ops", "Co-op Student I, IT Operations")).toBe("unsure");
  });

  it("takes the posting's job from its application, else its URL, else a requisition that looks like one", () => {
    const app = {
      url: APPLY,
      site: "workday",
      tenant: "cyberdyne",
      job: "req100012",
      from: "apply-link" as const,
      at: AT,
    };
    expect(postingFacts(meta({ role: "Intern" }), app)).toEqual({
      id: "p",
      site: "workday",
      tenant: "cyberdyne",
      job: "req100012",
      role: "Intern",
    });
    expect(postingFacts(meta({ reqId: "R-0000100575" }), undefined).job).toBe("r-0000100575");
    expect(postingFacts(meta({ reqId: "General - Software Engineer" }), undefined).job).toBeUndefined();
  });
});
