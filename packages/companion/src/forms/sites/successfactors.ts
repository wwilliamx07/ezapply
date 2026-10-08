/** What SAP SuccessFactors does differently, for the agent (see sites/index.ts). */
export const successfactors = `SAP SuccessFactors:
- The page comes filled from the candidate's profile with this employer (contact details, work and education rows,
  documents). Correct what's there rather than adding rows beside it.
- Upload documents first, one at a time, then read the form (get_form) and fill the rest. The page can re-render
  itself after an upload, which drops answers not yet saved and a document uploaded just before.
- A document is posted to the employer's site as soon as it's chosen. Removing one deletes it there at once: ask the
  user first. A required document (the resume) can't be removed: upload the new one onto it to replace it. An
  optional one has to be removed before another goes in its place.
- A typed signature or disclaimer acknowledgement is the user's to give: leave it empty.`;
