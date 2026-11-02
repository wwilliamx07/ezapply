/**
 * Ashby's server, for the adapter harness's stand-in: each of a job board's requests by kind. Every call is a JSON
 * POST to `/api/non-user-graphql?op=<operation>`; the posting page, its bundles, fonts and the board's theme are
 * answered from the saved front end as recorded. Read from a clone of a public board and the board's bundle.
 */
import type { CloneDescription } from "../clones.js";

const graphql = (op: string) => new RegExp(`^https://jobs\\.ashbyhq\\.com/api/non-user-graphql\\?op=${op}$`);

/** The ids Ashby issues for each load of a form: the form's, its entries' (prefixed with it) and its buttons'. */
const formIds = (form: string) => [
  `${form}.id`,
  `${form}.formControls.*.identifier`,
  `${form}.sections.*.fieldEntries.*.id`,
];

export const ashbyClone: CloneDescription = {
  endpoints: [
    // The application and every other `ApiSubmit…` action (the texting consent's among them).
    { name: "submit", kind: "submit", method: "POST", url: graphql("ApiSubmit[A-Za-z]*") },
    // The posting page: the same, but for its CSP nonce, on every load.
    {
      name: "posting-page",
      kind: "static",
      method: "GET",
      url: /^https:\/\/jobs\.ashbyhq\.com\/[^/?]+\/[0-9a-f-]{36}(\/application)?(\?|$)/,
      varies: true,
    },
    { name: "organization", kind: "static", method: "POST", url: graphql("ApiOrganizationFromHostedJobsPageName") },
    // The posting with its application and survey forms, whose ids are issued afresh on each load.
    {
      name: "job-posting",
      kind: "static",
      method: "POST",
      url: graphql("ApiJobPosting"),
      volatile: [...formIds("data.jobPosting.applicationForm"), ...formIds("data.jobPosting.surveyForms.*")],
    },
    // Each answer is saved as it's given, by the field's path, under the form's id from the posting; the answer is the
    // whole form (the application or the survey, told apart by their definition) with the values saved so far.
    {
      name: "set-form-value",
      kind: "save",
      method: "POST",
      url: graphql("ApiSetFormValue"),
      key: ["body.variables.formDefinitionIdentifier"],
      volatile: [...formIds("data.setFormValue"), "data.setFormValue.sections.*.fieldEntries.*.fieldValue"],
    },
    // Location: a geocoder searched as you type, countries first. It ranks fuzzily ("ac" brings Ascension Island): a
    // query not recorded gets the places with a word starting with it.
    {
      name: "location-search",
      kind: "search",
      method: "POST",
      url: graphql("ApiAutocompleteGeoLocation"),
      query: "body.variables.text",
      match: "word",
      items: "data.result.suggestions",
      label: "name",
    },
    // The invisible reCAPTCHA: its loader and scripts carry a release and its frames a nonce, on every load.
    {
      name: "recaptcha-loader",
      kind: "static",
      method: "GET",
      url: /^https:\/\/www\.recaptcha\.net\/recaptcha\/enterprise\.js(\?|$)/,
      varies: true,
    },
    {
      name: "recaptcha-release",
      kind: "static",
      method: "GET",
      url: /^https:\/\/www\.gstatic\.com\/recaptcha\/releases\//,
      varies: true,
    },
    // The browser's own request for the board's icon, made on some loads and not others.
    {
      name: "favicon",
      kind: "beacon",
      method: "GET",
      url: /^https:\/\/cdn\.ashbyprd\.com\/cdn_assets\/[^/]+\/favicon\.(svg|png)$/,
    },
    {
      name: "recaptcha-frames",
      kind: "beacon",
      url: /^https:\/\/www\.recaptcha\.net\/recaptcha\/enterprise\/(anchor|bframe|reload|clr|webworker\.js)/,
    },
  ],
  // Every answer is a save, and Ashby rate-limits saves (429 after about 75 in a few minutes, across both passes):
  // trying 4 answers per choice keeps a clone of a posting with a diversity survey under it.
  explorer: { maxAnswers: 4 },
};
