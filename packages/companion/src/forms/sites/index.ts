import type { FormSiteId } from "@ezapply/protocol";
import { ashby } from "./ashby.js";
import { dayforce } from "./dayforce.js";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { oracle } from "./oracle.js";
import { phenom } from "./phenom.js";
import { successfactors } from "./successfactors.js";
import { workday } from "./workday.js";

/**
 * What each site does differently, for the agent: what no schema fact says (a step that needs the resume first, a
 * removal that reaches the candidate's profile on the site, a choice that's the user's). `get_form` and
 * `autofill_step` give a site's notes as `siteNotes` the first time a page of it is read in a Claude session, so the
 * tool descriptions and the apply skill stay the same whatever the site, and a session pays only for the sites it
 * fills. Keyed by every registry site: a new site doesn't compile without its notes. Keep them short, and never
 * repeat what the schema already says (`lastPage`, button kinds, `optionsLazy`, a field's help text).
 */
export const SITE_NOTES: Record<FormSiteId, string> = {
  workday,
  oracle,
  greenhouse,
  lever,
  ashby,
  phenom,
  dayforce,
  successfactors,
};
