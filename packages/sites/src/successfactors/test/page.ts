import type { ConformancePage } from "../../../test/adapters.js";
import { savedPage } from "../../../test/adapters.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => {
    doc.documentElement.innerHTML = savedPage("successfactors", "successfactors-application");
  },
  url: "https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000&career_ns=job_application",
};
