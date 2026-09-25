import { detectSite, type SiteId } from "@ezapply/protocol";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

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
}): ExtractedPosting {
  const site = detectSite(input.url);
  const dom = new JSDOM(`<!doctype html><html><head><title></title></head><body>${input.visibleHtml}</body></html>`, {
    url: input.url,
  });
  const doc = dom.window.document;
  doc.title = input.pageTitle;
  for (const el of doc.querySelectorAll(STRIP_SELECTORS)) el.remove();

  const ld = parseJobPostingLd(input.jsonLd);
  const workday = site === "workday" ? extractWorkday(doc, input.url) : {};
  // Workday titles are just the role; the company comes from JSON-LD or the tenant subdomain.
  const fromTitle = site === "workday" ? {} : splitTitle(input.pageTitle);

  const main = site === "workday" ? workday.descriptionHtml : undefined;
  const bodyHtml = main ?? readableHtml(doc) ?? doc.body.innerHTML;

  const role = ld.title ?? workday.role ?? fromTitle.role;
  const company = ld.company ?? fromTitle.company ?? companyFromUrl(input.url);
  const location = ld.location ?? workday.location;
  const reqId = ld.reqId ?? workday.reqId;

  const header = [
    `# ${role ?? input.pageTitle}`,
    "",
    ...(company ? [`- Company: ${company}`] : []),
    ...(location ? [`- Location: ${location}`] : []),
    ...(reqId ? [`- Requisition: ${reqId}`] : []),
    `- URL: ${input.url}`,
    "",
    "---",
    "",
  ].join("\n");

  return {
    markdown: `${header}${toMarkdown(bodyHtml)}\n`,
    site,
    ...(workday.tenant ? { tenant: workday.tenant } : {}),
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

/** Workday data-automation-id hooks. Verified against live tenants during recon (plan M7). */
function extractWorkday(
  doc: Document,
  url: string,
): { descriptionHtml?: string; role?: string; location?: string; reqId?: string; tenant?: string } {
  const text = (sel: string) => doc.querySelector(sel)?.textContent?.trim() || undefined;
  const description = doc.querySelector('[data-automation-id="jobPostingDescription"]');
  const tenant = new URL(url).hostname.split(".")[0];
  const result: { descriptionHtml?: string; role?: string; location?: string; reqId?: string; tenant?: string } = {};
  if (description) result.descriptionHtml = description.innerHTML;
  const role = text('[data-automation-id="jobPostingHeader"]');
  if (role) result.role = role;
  const location = text('[data-automation-id="locations"] dd') ?? text('[data-automation-id="locations"]');
  if (location) result.location = location.replace(/^locations\s*/i, "");
  const reqId = text('[data-automation-id="requisitionId"] dd') ?? text('[data-automation-id="requisitionId"]');
  if (reqId) result.reqId = reqId.replace(/^job requisition id\s*/i, "");
  if (tenant) result.tenant = tenant;
  return result;
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
  if (ATS_HOSTS.test(u.hostname)) {
    // e.g. boards.greenhouse.io/acme/jobs/1, jobs.lever.co/acme/..., acme.wd5.myworkdayjobs.com
    if (/myworkday/i.test(u.hostname)) return u.hostname.split(".")[0];
    return u.pathname.split("/").filter(Boolean)[0];
  }
  const labels = u.hostname.replace(/^www\./, "").split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
}
