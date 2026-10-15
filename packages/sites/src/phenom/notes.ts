/** What Phenom does differently, for the agent (see ../notes.ts). */
export const phenom = `Phenom (an employer's careers site):
- Steps like Workday's (My information, My experience, Application questions…), each with Next and Previous. Next
  saves the step to the employer's system first and can take up to 30 s.
- The resume comes first: step 1 won't go on without one. upload_file it to \`resume\` before anything else; the page
  parses it into the fields, so then get_form and correct what the parse got wrong rather than trusting it.
- Work dates are months picked from a calendar: give \`YYYY-MM\`. A refusal names the years the page allows (never
  before the start date, never after today).`;
