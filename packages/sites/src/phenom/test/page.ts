import type { ConformancePage } from "../../../test/adapters.js";
import { savedPage } from "../../../test/adapters.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks this site on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => {
    doc.documentElement.innerHTML = savedPage("phenom", "phenom-step2");
  },
  url: "https://jobs.globex.example/ca/en/apply?jobSeqNo=GLOBA0001R0000000001EXTERNALENCA&step=2&stepname=workAndEducation",
};
