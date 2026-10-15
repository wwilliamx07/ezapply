import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdapter } from "@ezapply/engine/api";
import { extract } from "@ezapply/engine/extract";
import type { SiteDefinition } from "@ezapply/engine/types";
import { greenhouse } from "../src/greenhouse/definition/site.js";
import { oracle } from "../src/oracle/definition/site.js";
import { workday } from "../src/workday/definition/site.js";

/**
 * Each site's adapter on a test document: the engine with the site's definition, as its bundle installs it. Shared
 * with the companion's end-to-end tests, which drive the Workday, Oracle and Greenhouse adapters through the bridge.
 */
export const createWorkdayApi = (doc: Document, getUrl: () => string) => createAdapter(workday, doc, getUrl);
export const createOracleApi = (doc: Document, getUrl: () => string) => createAdapter(oracle, doc, getUrl);
export const createGreenhouseApi = (doc: Document, getUrl: () => string) => createAdapter(greenhouse, doc, getUrl);

/** A site's extraction of a page, without an adapter around it. */
export const extractPage = (site: SiteDefinition, doc: Document, url: string) => extract(site, doc, url);

/** A site's saved page (`src/<site>/fixtures/<name>.html`), without the provenance comment at its top. */
export const savedPage = (site: string, name: string) =>
  readFileSync(join(import.meta.dirname, "..", "src", site, "fixtures", `${name}.html`), "utf8").replace(
    /^<!--[\s\S]*?-->\s*/,
    "",
  );

/** A saved page of the site's, loaded into the test document and read by its definition. */
export const loadSaved = (site: SiteDefinition, name: string, url: string) => {
  document.documentElement.innerHTML = savedPage(site.info.id, name);
  return extractPage(site, document, url).schema;
};

/** A schema's fields by id. */
export const fieldsOf = (s: ReturnType<typeof loadSaved>) =>
  Object.fromEntries(s.sections.flatMap((x) => x.fields).map((f) => [f.id, f]));

/** A page of a site's application to run the conformance test on: how to build it in a document, and its URL. */
export interface ConformancePage {
  build: (doc: Document) => void;
  url: string;
}
