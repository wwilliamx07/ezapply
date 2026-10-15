import type { ConformancePage } from "../../../test/adapters.js";
import { savedPage } from "../../../test/adapters.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => {
    doc.documentElement.innerHTML = savedPage("ashby", "ashby-apply");
  },
  url: "https://jobs.ashbyhq.com/stark/7d2e9b14-0000-4000-8000-000000000002/application",
};
