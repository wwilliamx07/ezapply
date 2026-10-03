import { createAdapter } from "../src/adapters/engine/api.js";
import { extract } from "../src/adapters/engine/extract.js";
import type { SiteDefinition } from "../src/adapters/engine/types.js";
import { oracle } from "../src/adapters/sites/oracle/site.js";
import { workday } from "../src/adapters/sites/workday/site.js";

/** Each site's adapter on a test document: the engine with the site's definition, as its bundle installs it. */
export const createWorkdayApi = (doc: Document, getUrl: () => string) => createAdapter(workday, doc, getUrl);
export const createOracleApi = (doc: Document, getUrl: () => string) => createAdapter(oracle, doc, getUrl);

/** A site's extraction of a page, without an adapter around it. */
export const extractPage = (site: SiteDefinition, doc: Document, url: string) => extract(site, doc, url);
