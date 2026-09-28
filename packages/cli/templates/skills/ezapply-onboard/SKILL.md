---
name: ezapply-onboard
description: Set up or resume ezapply onboarding (GitHub login and repo selection, project knowledge base, resume import and profile, cover letter template, screening-question answers, preferences). Use when the user says onboard, set up, or get started, or when workspace_check reports missing steps.
---

# Onboarding

Onboarding is resumable. Always start with `workspace_check` and skip what is already done. Tell the user
the few steps that remain, then work through them in order. Keep each step conversational and short.

## 1. tex / extension
- **tex:** the item's `detail` has the install command for this OS. Say what it installs and roughly how
  big it is, ask, then run it with your shell tool (it can take several minutes). Call `workspace_check`
  again to confirm; no restart is needed.
- **extension:** call `extension_pair`. Ask which browser they use, give them that browser's page, steps and
  path, then call `extension_pair_wait`. If it times out, ask what they see, then wait again.

Neither blocks the next steps. If the user wants to skip one, move on and come back to it later.

## 2. GitHub (`github_login`, then `ezapply-repos`)
1. If `github_status` shows no app registered here, ask first: "Do you already have an ezapply GitHub App,
   from another computer or an earlier install (it's listed at github.com/settings/apps as ezapply-…), or
   should I create a new one?"
   - **Existing:** `github_login` with `app: "existing"`. A local page walks them through it: edit the app on
     GitHub, add the `callbackUrl` from the result as a Callback URL if it's missing, copy the Client ID,
     generate a new client secret (their other computers keep working), paste those into the page, and
     authorize. Never ask for the Client ID or secret in chat, and if they paste the secret here anyway, tell
     them to generate a new one and use the page.
   - **New:** `github_login` with `app: "new"`. GitHub asks them to create a private, read-only "ezapply" app,
     pick which repositories it may read, install it, and authorize.
   - Unsure, or no GitHub App: new.

   Only contents and metadata can be read either way; nothing can be written. With an app already
   registered, just call `github_login`: it's a single authorize click.
2. Say what will happen, call `github_login`, relay its `tell` text, then `github_login_wait`. If it times
   out, ask whether they finished, and wait again. If the page says the app isn't installed yet, they install
   it on the repositories ezapply may read (the link is on the page), then carry on.
3. Run the **ezapply-repos** skill to choose repositories.

## 3. Knowledge base
For each selected repo not yet indexed, run the **ezapply-index-repo** skill. With more than two repos, index
them in parallel with subagents (one repo each) and summarize when all finish.

## 4. Resume template and profile
1. Ask for the folder that holds their LaTeX resume (absolute path). Call `template_import` with
   `kind: "resume"`. If it reports ambiguity, ask which file is the main one. If the result has
   `texProgram.added`, tell the user its `note`: the template is now marked to build with pdflatex.
2. `tex_compile` the imported main file. Fix only environment problems (missing packages are installed
   automatically; font paths may need adjusting). Never change the content. Confirm it is one page and
   `pdf_render` it. If it only builds under another engine than the one used (e.g. `Undefined control
   sequence \pdfglyphtounicode` under XeLaTeX), add `% !TEX program = <engine>` as its first line rather
   than editing the template.
3. Read the resume source and write `profile/profile.yaml`: identity, contact, links, work history
   (YYYY-MM dates, `end: null` for current), education, skills, languages, certifications. Run
   `profile_check` until it is valid.
   Education needs `start` too (forms ask "From", and the year of study is computed from it), and `end` as
   `YYYY-MM-DD` when the user knows the expected graduation day: some forms want a full date. Ask for both
   if the resume doesn't show them.
4. Ask for everything `profile_check` lists as missing in **one** message: phone, full address, work
   authorization countries, sponsorship now and in the future, relocation, work mode, earliest start. Ask
   whether they want to store EEO answers (gender, race/ethnicity, veteran, disability). "decline" is a
   valid stored answer. Leaving them unset means they'll be asked every time. Update the profile and
   re-check.

## 5. Cover letter template
`templates/cover/` starts with ezapply's default: a plain one-page letter. Ask which they want:
1. **The default.** Fill its identity fields (`\myname`, `\mycontact`) from the profile. Offer to restyle
   it to match the resume's fonts and header so the two look like a set.
2. **Their own LaTeX template.** `template_import kind: "cover"` with the folder path. It replaces the
   default without asking.
3. **An example letter to copy the format from** (PDF, screenshot, or text; Word files exported to PDF).
   Follow **Build from an example** in the **ezapply-cover-letter** skill.

Then compile, `pdf_render`, and ask them to approve the look.

## 6. Answer bank
Call `answers_check`. Go through the unanswered questions in groups of 6–8. For each group list:
- the question
- the suggested answer, or the value from their profile when a `source` applies

Ask them to confirm or correct, e.g. "reply 'all good' or give the numbers to change". Write confirmed
answers into `answer` in `profile/answers.yaml` (leave `suggested` as is). Leave sensitive ones `null`
unless they insist. Run `answers_check` after each group.

For a student, include the student and co-op questions (`currently_enrolled`, `year_of_study`,
`expected_graduation`, `available_work_terms`, `returning_to_school`, `full_time_interest`): campus postings
ask them all. For someone not in school, skip them.

## 7. Preferences
First ask how documents should reach applications, and save it with `attach_mode_set`:
- **after-approval** (default): each resume, cover letter or bundle opens in the browser for them to approve
  or ask changes, and is attached only once approved.
- **immediately**: attached as soon as it's built, without a review step.

Then ask 4–5 quick questions and write `profile/preferences.md`:
- the tone for cover letters
- what to emphasize
- anything never to mention
- target roles and locations
- whether cover letters should be written by default

## 8. Library (optional)
Mention they can drop transcripts, certificates or writing samples into `library/` for bundling.

Finish with `workspace_check` and a two-line summary of what is ready.
