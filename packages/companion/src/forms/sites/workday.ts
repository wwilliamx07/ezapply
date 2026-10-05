/** What Workday does differently, for the agent (see sites/index.ts). */
export const workday = `Workday:
- Steps, each with Save and Continue. Add buttons all read "Add" or "Add Another": their \`section\` says which list.
- Resume/CV is often the only file field (\`multiple: true\`): resume.pdf and cover.pdf both go into it, one
  upload_file each. No cover-letter field is never a reason to leave the letter out.
- Use My Last Application (\`use_last_application\`) and a returning candidate's account pre-fill fields, rows,
  skills and files from the user's last application: clear stale files and skills with remove_items and rows the
  profile doesn't have with remove_repeatable before filling.`;
