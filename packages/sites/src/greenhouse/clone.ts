/**
 * Greenhouse's server, for the adapter harness's stand-in: each of a job board's requests by kind. The posting page,
 * its bundles, fonts and translations are answered from the saved front end as recorded. Read from a clone of a
 * public board; the hosts are Greenhouse's own and the providers its board loads.
 */
import type { CloneDescription } from "../clones.js";

export const greenhouseClone: CloneDescription = {
  endpoints: [
    // The application: a JSON POST to the board's `submitPath` (the job's URL on boards.greenhouse.io).
    {
      name: "application",
      kind: "submit",
      method: "POST",
      url: /^https:\/\/(job-)?boards(\.eu)?\.greenhouse\.io\/[^/?]+\/jobs\/\d+(\?|$)/,
    },
    // A file goes to Greenhouse's storage as soon as it's chosen, through fields signed for it by `presigned_fields`.
    { name: "file-upload", kind: "upload", method: "POST", url: /^https:\/\/grnhse-[^./]+\.s3\.amazonaws\.com\// },
    {
      name: "presigned-fields",
      kind: "list",
      method: "GET",
      url: /^https:\/\/(job-)?boards(\.eu)?\.greenhouse\.io\/uncacheable_attributes\/presigned_fields(\?|$)/,
      key: ["query.fields[]"],
      volatile: [
        "resume.key",
        "resume.fields.policy",
        "resume.fields.x-amz-date",
        "resume.fields.x-amz-signature",
        "cover_letter.key",
        "cover_letter.fields.policy",
        "cover_letter.fields.x-amz-date",
        "cover_letter.fields.x-amz-signature",
      ],
    },
    // The email field's check: the same answer for any placeholder address, which it echoes.
    {
      name: "email-check",
      kind: "validate",
      method: "GET",
      url: /^https:\/\/email-address-validator(\.[a-z]+)?\.greenhouse\.io\/address\/validate(\?|$)/,
      key: [],
      volatile: ["address"],
    },
    // Location (City): the page's geocoder, searched as you type, and again with a chosen place's label to confirm it.
    // It ranks fuzzily: a query not recorded gets the results whose place name has a word starting with it.
    {
      name: "location-search",
      kind: "search",
      method: "GET",
      url: /^https:\/\/api-geocode-earth-proxy\.greenhouse\.io\/v1\/autocomplete(\?|$)/,
      query: "query.text",
      match: "word",
      items: "features",
      label: "properties.name",
      // A timestamp, and the query echoed back (a cached answer's, which may differ in case from the one sent).
      volatile: ["geocoding.timestamp", "geocoding.query"],
    },
    // Google's sign-in and Drive scripts, loaded for picking a file from Drive: a nonce and feature flags each load.
    {
      name: "google-sign-in",
      kind: "static",
      method: "GET",
      url: /^https:\/\/accounts\.google\.com\/gsi\//,
      varies: true,
    },
    {
      name: "google-api-proxy",
      kind: "static",
      method: "GET",
      url: /^https:\/\/content\.googleapis\.com\/static\/proxy\.html(\?|$)/,
      varies: true,
    },
    // Analytics, ad pixels, the application-complete signal and the invisible reCAPTCHA's frames: answered empty.
    { name: "analytics", kind: "beacon", url: /^https:\/\/c\.spl\.greenhouse\.io\// },
    { name: "appcast", kind: "beacon", url: /^https:\/\/click\.appcast\.io\// },
    { name: "seek-signal", kind: "beacon", method: "POST", url: /\/seek\/send_signal(\?|$)/ },
    {
      name: "recaptcha-frames",
      kind: "beacon",
      url: /^https:\/\/www\.(recaptcha\.net|google\.com)\/recaptcha\/enterprise\/(anchor|bframe|reload|clr|webworker\.js)/,
    },
  ],
};
