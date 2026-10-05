/** What Dayforce does differently, for the agent (see sites/index.ts). */
export const dayforce = `Dayforce:
- Steps: Candidate Info, Questionnaire (a page per questionnaire), Submit, each with Next and Previous.
- The resume first: uploading it sends it to Dayforce, which parses it into the fields. Upload it before
  autofill_step, then check what the parse filled rather than trusting it.
- Personal Information is a form of its own: after filling it, press its \`save\` button
  (save.personal-information). Shown as a summary, its \`edit\` button opens it again.
- Employment and education are records saved one by one with their \`save\` button. Record dates are \`YYYY-MM-DD\`.
- Deleting a saved record (remove_repeatable) deletes it from the candidate's Dayforce profile, not just this
  application: ask the user first.
- Each phone number is two fields: the dialling code (fill it with the country) and the number.
- The Submit step is the review page: the Candidate Acknowledgement is the user's to read and agree to. Leave its box.
- The email comes from the sign-in and is read-only.`;
