import type { SiteDefinition } from "@ezapply/engine/types";
import { ashby } from "./ashby/definition/site.js";
import { dayforce } from "./dayforce/definition/site.js";
import { greenhouse } from "./greenhouse/definition/site.js";
import { lever } from "./lever/definition/site.js";
import { oracle } from "./oracle/definition/site.js";
import { phenom } from "./phenom/definition/site.js";
import type { FormSiteId } from "./registry.js";
import { successfactors } from "./successfactors/definition/site.js";
import { workday } from "./workday/definition/site.js";

/**
 * Every site's definition, by registry id. Each site's bundle imports only its own (`<site>/main.ts`); this list is
 * for tests, which check that every registry entry has a definition and that each passes the same conformance test.
 */
export const SITE_DEFINITIONS: Record<FormSiteId, SiteDefinition> = {
  workday,
  oracle,
  greenhouse,
  lever,
  ashby,
  phenom,
  dayforce,
  successfactors,
};
