import type { ConformancePage } from "../../../test/adapters.js";
import { buildOracleApplication } from "./fixture.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => buildOracleApplication(doc),
  url: "https://jobs.acme.com/en/sites/CX_1/job/42/apply/section/1",
};
