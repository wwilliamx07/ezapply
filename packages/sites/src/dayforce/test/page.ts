import type { ConformancePage } from "../../../test/adapters.js";
import { savedPage } from "../../../test/adapters.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => {
    doc.documentElement.innerHTML = savedPage("dayforce", "dayforce-candidate-info");
  },
  url: "https://jobs.dayforcehcm.com/en-US/hooli/CANDIDATEPORTAL/jobs/1000/apply/manualApplication",
};
