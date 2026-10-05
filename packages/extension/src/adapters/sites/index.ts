import type { FormSiteId } from "@ezapply/protocol/sites";
import type { SiteDefinition } from "../engine/types.js";
import { ashby } from "./ashby/site.js";
import { dayforce } from "./dayforce/site.js";
import { greenhouse } from "./greenhouse/site.js";
import { lever } from "./lever/site.js";
import { oracle } from "./oracle/site.js";
import { phenom } from "./phenom/site.js";
import { workday } from "./workday/site.js";

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
};
