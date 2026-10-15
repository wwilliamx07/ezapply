import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createAdapter } from "@ezapply/engine/api";
import type { SiteDefinition } from "@ezapply/engine/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { installDomShims } from "../../engine/test/shims.js";
import { SITE_DEFINITIONS } from "../src/definitions.js";
import { SITE_NOTES } from "../src/notes.js";
import { POSTING_READERS } from "../src/readers.js";
import { FORM_SITE_IDS, SITES } from "../src/registry.js";
import { type ConformancePage, savedPage } from "./adapters.js";

/**
 * What every site must do, checked on a page of each: its fixture or a saved live page (`<site>/test/page.ts`). A new
 * site gets its directory, its entry in each list and its page, and passes the same checks before it's used.
 */

const SRC = join(import.meta.dirname, "..", "src");
const dirs = readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const has = (id: string, path: string) => existsSync(join(SRC, id, path));

/** Each site's conformance page. */
const PAGES: Record<string, ConformancePage> = Object.fromEntries(
  await Promise.all(
    dirs
      .filter((id) => has(id, "test/page.ts"))
      .map(async (id) => [id, (await import(`../src/${id}/test/page.ts`)).conformancePage]),
  ),
);

/** Every saved page, by the site it's a page of (`<site>/fixtures/`): each site's signature is checked on all of them. */
const SAVED: Record<string, string[]> = Object.fromEntries(
  dirs.map((id) => [
    id,
    has(id, "fixtures")
      ? readdirSync(join(SRC, id, "fixtures"))
          .filter((f) => f.endsWith(".html"))
          .map((f) => f.slice(0, -".html".length))
      : [],
  ]),
);

describe("the registry, the lists and the directories", () => {
  const sorted = (ids: Iterable<string>) => [...ids].sort();

  it("has a directory for every registered site, and no directory that isn't one", () => {
    expect(sorted(dirs)).toEqual(sorted(FORM_SITE_IDS));
  });

  it("lists every site on each side: its definition, its notes, its reader where it has one", () => {
    expect(sorted(Object.keys(SITE_DEFINITIONS))).toEqual(sorted(FORM_SITE_IDS));
    expect(sorted(Object.keys(SITE_NOTES))).toEqual(sorted(FORM_SITE_IDS));
    expect(sorted(Object.keys(POSTING_READERS))).toEqual(sorted(dirs.filter((id) => has(id, "reader.ts"))));
  });

  it("gives each site its files: registry entry, definition and bundle entry, notes, a conformance page", () => {
    for (const id of FORM_SITE_IDS) {
      expect(SITE_DEFINITIONS[id].info.id).toBe(id);
      const files = ["registry.ts", "definition/site.ts", "definition/main.ts", "notes.ts", "test/page.ts"];
      expect([id, files.filter((f) => !has(id, f))]).toEqual([id, []]);
      expect(PAGES[id]).toBeDefined();
    }
  });

  it("gives every site waits of its own for every wait the engine and drivers use", () => {
    for (const s of SITES) {
      for (const [key, value] of Object.entries(s.waits))
        expect([s.id, key, Number.isFinite(value)]).toEqual([s.id, key, true]);
    }
  });
});

/** The sites whose signature the document matches, in registry order. */
const signedBy = (doc: Document) => SITES.filter((s) => doc.querySelector(s.signature)).map((s) => s.id);

describe("telling a site by its page (signatures)", () => {
  it("has saved pages of every site", () => {
    expect(FORM_SITE_IDS.filter((id) => !SAVED[id]?.length)).toEqual([]);
  });

  it("knows every saved page by its own site's signature, and by no other's", () => {
    for (const [id, names] of Object.entries(SAVED)) {
      for (const name of names) {
        const doc = new JSDOM("<!doctype html><html></html>").window.document;
        doc.documentElement.innerHTML = savedPage(id, name);
        expect([name, signedBy(doc)]).toEqual([name, [id]]);
      }
    }
  });

  it("knows no site on a careers page that only links to boards, loads their embed scripts or frames them", () => {
    const doc = new JSDOM(
      `<!doctype html><html><head>
        <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
        <script src="https://jobs.ashbyhq.com/acme/embed?version=2"></script>
      </head><body>
        <a href="https://job-boards.greenhouse.io/acme/jobs/1000001">Apply</a>
        <a href="https://jobs.lever.co/acme/1">Apply</a>
        <a href="https://acme.wd5.myworkdayjobs.com/External/job/x">Apply</a>
        <div id="ashby_embed"></div>
        <iframe src="https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1000001"></iframe>
        <form id="application-form"><label>Name <input name="name"></label></form>
      </body></html>`,
    ).window.document;
    expect(signedBy(doc)).toEqual([]);
  });
});

describe.each(FORM_SITE_IDS)("site %s", (id) => {
  const site: SiteDefinition = SITE_DEFINITIONS[id];
  const page = PAGES[id] as { build: (doc: Document) => void; url: string };
  let doc: Document;
  /** A window of its own per page: each site's adapter (and its submit guard) on a page of that site only. */
  const adapter = () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: page.url });
    installDomShims(dom.window as unknown as Window);
    doc = dom.window.document;
    page.build(doc);
    return createAdapter(site, doc, () => page.url);
  };

  it("reads a step whose every field has a prompt and a kind", () => {
    const form = adapter().getForm();
    expect(form).toMatchObject({ adapter: id, pageKind: "step" });
    const fields = form.sections.flatMap((s) => s.fields);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect([f.id, f.label.trim().length > 0]).toEqual([f.id, true]);
      expect(f.kind).toBeTruthy();
    }
  });

  it("gives the same field ids on every read", () => {
    const api = adapter();
    const ids = () => api.getForm().sections.flatMap((s) => s.fields.map((f) => f.id));
    expect(ids()).toEqual(ids());
    expect(new Set(ids()).size).toBe(ids().length);
  });

  it("blocks a synthetic click and Enter on its Submit, and never presses it itself", async () => {
    const api = adapter();
    const form = api.getForm();
    const submit = [...doc.querySelectorAll<HTMLElement>("button, [role='button'], input[type='submit'], a")].find(
      (b) => site.page.isSubmit(b),
    );
    if (form.lastPage) {
      expect(submit).toBeDefined();
      expect((await api.next()).refusedReason).toBeTruthy();
    }
    if (!submit) return;
    let reached = false;
    submit.addEventListener("click", () => {
      reached = true;
    });
    const w = doc.defaultView as Window & typeof globalThis;
    submit.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    submit.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(reached).toBe(false);
    expect(api.blockedSubmitAttempts().length).toBeGreaterThanOrEqual(2);
  });
});
