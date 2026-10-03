import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORM_SITE_IDS, SITES } from "@ezapply/protocol/sites";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createAdapter } from "../src/adapters/engine/api.js";
import type { SiteDefinition } from "../src/adapters/engine/types.js";
import { SITE_DEFINITIONS } from "../src/adapters/sites/index.js";
import { buildOracleApplication } from "./oracle-fixture.js";
import { buildWorkdayStep, installDomShims } from "./workday-fixture.js";

/**
 * What every site must do, checked on a page of each: its fixture or a saved live page. A new site gets its page
 * here and passes the same checks before it's used.
 */

const live = (name: string) => (doc: Document) => {
  const html = readFileSync(join(import.meta.dirname, "fixtures", "live", `${name}.html`), "utf8");
  doc.documentElement.innerHTML = html.replace(/^<!--[\s\S]*?-->\s*/, "");
};

/** For each site: how to build a page of its application, and its URL. */
const PAGES: Record<string, { build: (doc: Document) => void; url: string }> = {
  workday: {
    build: (doc) => buildWorkdayStep(doc),
    url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply",
  },
  oracle: {
    build: (doc) => buildOracleApplication(doc),
    url: "https://jobs.acme.com/en/sites/CX_1/job/42/apply/section/1",
  },
  greenhouse: { build: live("greenhouse-apply"), url: "https://job-boards.greenhouse.io/vandelay/jobs/1000000001" },
  lever: {
    build: live("lever-apply"),
    url: "https://jobs.lever.co/wonka/5c1e7a2b-0000-4000-8000-000000000001/apply",
  },
  ashby: {
    build: live("ashby-apply"),
    url: "https://jobs.ashbyhq.com/stark/7d2e9b14-0000-4000-8000-000000000002/application",
  },
};

describe("the registry and the definitions", () => {
  it("has a definition, a bundle entry and a test page for every registered site", () => {
    expect(Object.keys(SITE_DEFINITIONS).sort()).toEqual([...FORM_SITE_IDS].sort());
    for (const id of FORM_SITE_IDS) {
      expect(SITE_DEFINITIONS[id].info.id).toBe(id);
      expect(existsSync(join(import.meta.dirname, "..", "src", "adapters", "sites", id, "main.ts"))).toBe(true);
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
