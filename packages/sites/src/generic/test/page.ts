import type { ConformancePage } from "../../../test/adapters.js";
import { APPLICATION } from "./forms.js";

/** The page the conformance test (`sites/test/conformance.test.ts`) checks the generic definition on, and its URL. */
export const conformancePage: ConformancePage = {
  build: (doc) => {
    doc.body.innerHTML = APPLICATION;
  },
  url: "https://careers.example.com/jobs/software-developer/apply",
};
