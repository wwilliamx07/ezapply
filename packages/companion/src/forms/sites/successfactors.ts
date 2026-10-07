/** What SAP SuccessFactors does differently, for the agent (see sites/index.ts). */
export const successfactors = `SAP SuccessFactors:
- The page comes filled from the candidate's profile with this employer (contact details, work and education rows,
  documents). Correct what's there rather than adding rows beside it.
- A document is posted to the employer's site as soon as it's chosen. Removing one deletes it there at once: ask the
  user first.
- A typed signature or disclaimer acknowledgement is the user's to give: leave it empty.`;
