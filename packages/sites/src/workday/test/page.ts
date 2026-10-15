import type { ConformancePage } from "../../../test/adapters.js";
import { buildWorkdayStep } from "./fixture.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => buildWorkdayStep(doc),
  url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply",
};
