import { detectSite, type FormSiteId, type SiteId, siteInfo, workdayTenant } from "@ezapply/protocol";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
import { POSTING_READERS } from "./readers/index.js";

export interface ExtractedPosting {
  markdown: string;
  site: SiteId;
  tenant?: string;
  company?: string;
  role?: string;
  reqId?: string;
  location?: string;
}

interface JobPostingLd {
  title?: string;
  company?: string;
  reqId?: string;
  location?: string;
}

const STRIP_SELECTORS = "script, style, noscript, template, svg, iframe, canvas, link, meta";
const ATS_HOSTS =
  /(greenhouse|lever|workday|myworkdayjobs|myworkdaysite|ashbyhq|smartrecruiters|icims|jobvite|bamboohr|workable|linkedin|indeed)\./i;

/**
 * Turn the captured (visible-only) body HTML into clean markdown plus best-effort metadata.
 * Metadata is a starting point only; Claude corrects it with posting_update_meta.
 */
export function extractPosting(input: {
  visibleHtml: string;
  url: string;
  pageTitle: string;
  jsonLd: string[];
  /** The embedded job board frame the HTML came from, if not the page itself. */
  frameUrl?: string;
  /** The content's site as the extension found it on the page (its body); absent or generic, its URL decides. */
  site?: SiteId;
}): ExtractedPosting {
  // The content's own site decides how to read it (a Workday board embedded in a career page is Workday);
  // the company still comes from the page the user was on.
  const contentUrl = input.frameUrl ?? input.url;
  const site = input.site && input.site !== "generic" ? input.site : detectSite(contentUrl);
  // A silent console: by default jsdom prints the page's CSS parse errors to ours, and the terminal is Claude's.
  const dom = new JSDOM(`<!doctype html><html><head><title></title></head><body>${input.visibleHtml}</body></html>`, {
    url: contentUrl,
    virtualConsole: new VirtualConsole(),
  });
  const doc = dom.window.document;
  doc.title = input.pageTitle;
  for (const el of doc.querySelectorAll(STRIP_SELECTORS)) el.remove();

  const ld = parseJobPostingLd(input.jsonLd);
  // The site's own reader, where the generic reading isn't enough (readers/index.ts).
  const own = POSTING_READERS[site as FormSiteId]?.(doc, contentUrl) ?? {};
  // A title that is only the role (Workday's) isn't split: the company comes from JSON-LD or the URL.
  const fromTitle = own.titleIsRole ? {} : splitTitle(input.pageTitle);

  const bodyHtml = own.descriptionHtml ?? readableHtml(doc) ?? doc.body.innerHTML;

  const role = ld.title ?? own.role ?? fromTitle.role;
  const company = ld.company ?? fromTitle.company ?? companyFromUrl(input.url);
  const location = ld.location ?? own.location;
  const reqId = ld.reqId ?? own.reqId;
  // The employer's space on its site (a Workday tenant, an Oracle career site's host and site number, a Greenhouse
  // board), so the application tab can be matched to this posting.
  const tenant = siteInfo(site)?.tenant(contentUrl);

  const header = [
    `# ${role ?? input.pageTitle}`,
    "",
    ...(company ? [`- Company: ${company}`] : []),
    ...(location ? [`- Location: ${location}`] : []),
    ...(reqId ? [`- Requisition: ${reqId}`] : []),
    `- URL: ${input.url}`,
    ...(input.frameUrl ? [`- Embedded from: ${input.frameUrl}`] : []),
    "",
    "---",
    "",
  ].join("\n");

  return {
    markdown: `${header}${toMarkdown(bodyHtml)}\n`,
    site,
    ...(tenant ? { tenant } : {}),
    ...(company ? { company } : {}),
    ...(role ? { role } : {}),
    ...(reqId ? { reqId } : {}),
    ...(location ? { location } : {}),
  };
}

function toMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  td.remove(["button", "form", "input", "select", "textarea"]);
  // Turndown pads bullets to "-   item"; use a single space so the markdown reads naturally.
  td.addRule("listItem", {
    filter: "li",
    replacement(content, node) {
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, "\n  ");
      const parent = node.parentNode as Element | null;
      let prefix = "- ";
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") ?? 1);
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      return prefix + body + (node.nextSibling && !body.endsWith("\n") ? "\n" : "");
    },
  });
  return td
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function readableHtml(doc: Document): string | undefined {
  const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 300 }).parse();
  if (!article?.content) return undefined;
  // Readability occasionally keeps only a fragment; fall back to the full body when it is tiny.
  const textLen = (article.textContent ?? "").trim().length;
  const bodyLen = (doc.body.textContent ?? "").trim().length;
  if (textLen < 400 && bodyLen > textLen * 3) return undefined;
  return article.content;
}

function parseJobPostingLd(blocks: string[]): JobPostingLd {
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const nodes = flattenLd(data);
    const job = nodes.find((n) => {
      const t = n["@type"];
      return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
    });
    if (!job) continue;
    const org = job.hiringOrganization as Record<string, unknown> | undefined;
    const identifier = job.identifier as Record<string, unknown> | string | undefined;
    const out: JobPostingLd = {};
    if (typeof job.title === "string") out.title = job.title.trim();
    if (org && typeof org.name === "string") out.company = org.name.trim();
    const idValue = typeof identifier === "string" ? identifier : identifier?.value;
    if (typeof idValue === "string" || typeof idValue === "number") out.reqId = String(idValue);
    const loc = ldLocation(job.jobLocation);
    if (loc) out.location = loc;
    return out;
  }
  return {};
}

function flattenLd(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(flattenLd);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    return [obj, ...(Array.isArray(obj["@graph"]) ? flattenLd(obj["@graph"]) : [])];
  }
  return [];
}

function ldLocation(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object") return undefined;
  const addr = (first as Record<string, unknown>).address as Record<string, unknown> | undefined;
  if (!addr) return undefined;
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
    .map((p) => (typeof p === "string" ? p : typeof p === "object" && p ? (p as { name?: string }).name : undefined))
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : undefined;
}

export function splitTitle(title: string): { role?: string; company?: string } {
  const t = title.replace(/^job application for\s+/i, "").trim();
  const at = t.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at?.[1] && at[2]) return { role: at[1].trim(), company: cleanCompany(at[2]) };
  const parts = t
    .split(/\s+[|\-–—]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return {};
  // The company is usually the last segment that isn't a generic word like "Careers" or "Jobs".
  const company = parts
    .slice(1)
    .reverse()
    .map(cleanCompany)
    .find((c) => c !== undefined);
  return company ? { role: parts[0], company } : { role: parts[0] };
}

function cleanCompany(s: string): string | undefined {
  const c = s
    .replace(/\b(careers?|jobs?|job board|careers page|hiring)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return c || undefined;
}

export function companyFromUrl(url: string): string | undefined {
  const u = new URL(url);
  // Oracle Cloud hosts (fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com) don't name the employer; the title does.
  if (/(^|\.)oraclecloud\.com$/i.test(u.hostname)) return undefined;
  if (ATS_HOSTS.test(u.hostname)) {
    // Workday: acme.wd5.myworkdayjobs.com, wd5.myworkdaysite.com/recruiting/acme/...
    if (/myworkday/i.test(u.hostname)) return workdayTenant(url);
    const segments = u.pathname.split("/").filter(Boolean);
    // Job boards: the company is only in the path of Indeed company pages (indeed.com/cmp/acme/jobs);
    // linkedin.com/jobs/view/<id> and indeed.com/viewjob?jk= don't name it (the page title and JSON-LD do).
    if (/(^|\.)(linkedin|indeed)\./i.test(u.hostname)) {
      return segments[0] === "cmp" && segments[1] ? segments[1] : undefined;
    }
    // e.g. boards.greenhouse.io/acme/jobs/1, jobs.lever.co/acme/...
    return segments[0];
  }
  const labels = u.hostname.replace(/^www\./, "").split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
}
