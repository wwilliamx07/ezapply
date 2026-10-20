import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { JSDOM, VirtualConsole } from "jsdom";
import { parse as parseYaml } from "yaml";
import type { CallRecord } from "./debug.js";

/**
 * `ezapply debug export`: a test fixture candidate from a markup file debug mode saved (`NNNN-before.html`,
 * `NNNN-after.html` or `NNNN-fail-<fieldId>.html`), for an extraction test against the real page
 * (the site's `test/live.test.ts`) or to correct a behavioural fixture to it.
 *
 * Scrubbed in two passes. First the values: every input's value, textareas, chosen options, ticked boxes and pressed
 * pills, the option a dropdown button shows, selected-value pills and attached file names. Then every string in
 * `profile/profile.yaml`, and the tenant and job title the page was read with, wherever they still appear in text or
 * attributes; each is counted. It's written next to the file it came from, never into the repo: it's third-party
 * markup and the scrub can miss something (a name in a label, a value the page formats differently), so the user
 * looks at it before it goes into the site's `fixtures/`.
 */
interface ExportResult {
  file: string;
  /** Values blanked in the first pass. */
  values: number;
  /** Strings from the profile, tenant and job title replaced in the second, by kind. */
  replaced: { profile: number; tenant: number; job: number };
}

/** What the export of `which` (before, after, fail-<fieldId> or a file name) of call `nnnn` in `session` writes. */
export async function debugExport(
  session: string,
  nnnn: string,
  which: string,
  profileYaml: string | null,
): Promise<ExportResult> {
  const seq = nnnn.padStart(4, "0");
  const source = which.endsWith(".html") ? which : `${seq}-${which}.html`;
  const html = await readFile(join(session, source), "utf8").catch(() => {
    throw new EzError(
      ErrorCode.NotFound,
      `No ${source} in ${basename(session)}.`,
      "`ezapply debug report` lists what each call saved; debug.markup must not be none.",
    );
  });
  const context = await recordContext(session, seq);
  const {
    html: scrubbed,
    values,
    replaced,
  } = scrub(html, {
    profile: profileStrings(profileYaml),
    tenant: context.tenant,
    job: context.job,
  });
  const header =
    `<!-- Debug export of ${describePage(context)} (${source}). Scripts, styles, SVG contents and inline handlers ` +
    `removed; ${values} values blanked; strings replaced: ${replaced.profile} from the profile, ${replaced.tenant} ` +
    `of the tenant, ${replaced.job} of the job title. Check it for anything else that identifies the user or the ` +
    "employer before committing it. -->\n";
  const file = join(session, source.replace(/\.html$/, ".fixture.html"));
  await writeFile(file, header + scrubbed, "utf8");
  return { file, values, replaced };
}

interface PageContext {
  site?: string;
  pageKind?: string;
  step?: { title?: string; index?: number; total?: number };
  tenant?: string;
  job?: string;
}

/** The site, page kind, step, tenant and job of the call, from its record (`NNNN-<tool>.json`). */
async function recordContext(session: string, seq: string): Promise<PageContext> {
  const name = (await readdir(session).catch(() => [] as string[])).find(
    (n) => n.startsWith(`${seq}-`) && n.endsWith(".json"),
  );
  if (!name) return {};
  const record = JSON.parse(await readFile(join(session, name), "utf8")) as CallRecord;
  const form = record.bridge.find((b) => b.method === "form.get" && b.result)?.result as
    | { adapter?: string; pageKind?: string; tenant?: string; step?: PageContext["step"]; job?: { title?: string } }
    | undefined;
  const page = (record.bridge.find((b) => b.trace)?.trace?.page as { before?: { step?: PageContext["step"] } })?.before;
  const tab = record.tab as { site?: string } | undefined;
  return {
    site: form?.adapter ?? tab?.site,
    pageKind: form?.pageKind,
    step: form?.step ?? page?.step,
    tenant: form?.tenant,
    job: form?.job?.title,
  };
}

function describePage(c: PageContext): string {
  const step = c.step?.title
    ? `, step "${c.step.title}"${c.step.index ? ` (${c.step.index}${c.step.total ? ` of ${c.step.total}` : ""})` : ""}`
    : "";
  return `a ${c.site ?? "form"} ${c.pageKind ?? "page"}${step}`;
}

/**
 * Every string in the profile worth replacing: three characters or more, not a bare number shorter than four. Whole
 * values only: replacing their words as well would hit the page's own labels ("Street" in "Street Address").
 */
export function profileStrings(yaml: string | null): string[] {
  if (!yaml) return [];
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch {
    return [];
  }
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length >= 3 && !/^\d{1,3}$/.test(s)) out.add(s);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(data);
  // Longest first, so a full value is replaced before the words in it.
  return [...out].sort((a, b) => b.length - a.length);
}

/** Selectors of what shows a chosen value as text, by site, and what replaces it. */
const SHOWN_VALUES: [string, string][] = [
  ['button[aria-haspopup="listbox"]', "Select One"],
  ['[data-automation-id="promptSelectionLabel"], [data-automation-id="selectedItemLabel"]', "Selected value"],
  ['[data-automation-id="file-upload-item-name"]', "file.pdf"],
];

const TEXT_INPUTS = /^(text|email|tel|url|number|search|date|month|hidden|)$/;

/** The two passes on one markup file. */
function scrub(
  html: string,
  strings: { profile: string[]; tenant?: string; job?: string },
): { html: string; values: number; replaced: ExportResult["replaced"] } {
  const doctype = /^\s*<!doctype html>/i.test(html);
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  let values = 0;
  for (const input of doc.querySelectorAll("input")) {
    const type = (input.getAttribute("type") ?? "").toLowerCase();
    if (TEXT_INPUTS.test(type) && input.getAttribute("value")) {
      input.removeAttribute("value");
      values++;
    } else if ((type === "checkbox" || type === "radio") && input.hasAttribute("checked")) {
      input.removeAttribute("checked");
      values++;
    }
  }
  for (const ta of doc.querySelectorAll("textarea")) {
    if (ta.textContent) {
      ta.textContent = "";
      values++;
    }
  }
  for (const o of doc.querySelectorAll("option[selected]")) {
    o.removeAttribute("selected");
    values++;
  }
  for (const el of doc.querySelectorAll('[aria-checked="true"], [aria-pressed="true"]')) {
    for (const a of ["aria-checked", "aria-pressed"]) if (el.getAttribute(a) === "true") el.setAttribute(a, "false");
    values++;
  }
  for (const [selector, placeholder] of SHOWN_VALUES) {
    for (const el of doc.querySelectorAll(selector)) {
      if ((el.textContent ?? "").trim() && el.textContent?.trim() !== placeholder) {
        el.textContent = placeholder;
        values++;
      }
    }
  }

  const replaced = { profile: 0, tenant: 0, job: 0 };
  const passes: [keyof typeof replaced, string[], string][] = [
    ["job", strings.job ? [strings.job] : [], "Job Title"],
    ["profile", strings.profile, "REDACTED"],
    ["tenant", strings.tenant && strings.tenant.length >= 3 ? [strings.tenant] : [], "example-tenant"],
  ];
  const replaceIn = (s: string): string => {
    let out = s;
    for (const [kind, list, placeholder] of passes) {
      for (const needle of list) {
        const re = new RegExp(escapeRegExp(needle), "gi");
        out = out.replace(re, () => {
          replaced[kind]++;
          return placeholder;
        });
      }
    }
    return out;
  };
  const walker = doc.createTreeWalker(doc.documentElement, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue ?? "";
    const r = replaceIn(t);
    if (r !== t) n.nodeValue = r;
  }
  for (const el of doc.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      const r = replaceIn(a.value);
      if (r !== a.value) el.setAttribute(a.name, r);
    }
  }
  const out = doc.documentElement.outerHTML;
  return { html: `${doctype ? "<!doctype html>\n" : ""}${out}\n`, values, replaced };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
