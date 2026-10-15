/** What Oracle Recruiting Cloud does differently, for the agent (see ../notes.ts). */
export const oracle = `Oracle Recruiting Cloud:
- Often one page with every section and only Submit (\`lastPage\`); multi-page sites have Next and Previous.
- \`auth\` is the email step: email and terms, then a code sent to the user. The user does it.
- \`start-choice\` is "Welcome Back": ask the user whether to \`use_last_application\` (Use My Profile) or import from
  Indeed themselves. Their profile then pre-fills fields and attachments: clear what belongs to another job.
- Short option lists are buttons (read as \`radio\` or \`checkbox-group\`, options listed). Long lists are dropdowns
  that search as you type: fill with the option text, or search_options first (cities, schools).
- Address lists depend on each other (country, province, city, postal code): fill them in one call.
- Work, education, languages and licenses are inline forms (add, fill, save), one entry at a time.
- A resume or cover letter already on the candidate's profile blocks a new upload until remove_items takes it off.
- The email comes from the sign-in and is read-only.`;
