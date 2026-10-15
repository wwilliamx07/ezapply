import type { ConformancePage } from "../../../test/adapters.js";
import { savedPage } from "../../../test/adapters.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => {
    doc.documentElement.innerHTML = savedPage("lever", "lever-apply");
  },
  url: "https://jobs.lever.co/wonka/5c1e7a2b-0000-4000-8000-000000000001/apply",
};
