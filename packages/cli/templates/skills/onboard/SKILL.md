---
name: onboard
description: Set up or resume ezapply onboarding (GitHub login and repo selection, project knowledge base, resume import and profile, cover letter template, screening-question answers, preferences). Use when the user says onboard, set up, or get started, or when workspace_check reports missing steps.
---

# Onboarding

Onboarding is resumable. Always start with `workspace_check` and skip what is already done. Tell the user
the few steps that remain, then work through them in order. Keep each step conversational and short.

## 1. tex / extension
If `tex` is not done, tell the user to run `ezapply doctor` and stop. If `extension` is not done, explain
how to pair (`ezapply pair`, then paste into the extension options). Neither blocks the next steps.

## 2. GitHub (`github_login`, then `repos`)
1. Say what will happen before calling `github_login`: a browser page opens. The first time, GitHub asks
   them to create a private, read-only "ezapply" app, pick which repositories it may read, install it,
   and authorize. Only contents and metadata can be read; nothing can be written.
2. Call `github_login`, relay its `tell` text, then `github_login_wait`. If it times out, ask whether they
   finished, and wait again.
3. Run the **repos** skill to choose repositories.

## 3. Knowledge base
For each selected repo not yet indexed, run the **index-repo** skill. With more than two repos, index
them in parallel with subagents (one repo each) and summarize when all finish.

## 4. Resume template and profile
1. Ask for the folder that holds their LaTeX resume (absolute path). Call `template_import` with
   `kind: "resume"`. If it reports ambiguity, ask which file is the main one.
2. `tex_compile` the imported main file. Fix only environment problems (missing packages are installed
   automatically; font paths may need adjusting). Never change the content. Confirm it is one page and
   `pdf_render` it.
3. Read the resume source and write `profile/profile.yaml`: identity, contact, links, work history
   (YYYY-MM dates, `end: null` for current), education, skills, languages, certifications. Run
   `profile_check` until it is valid.
4. Ask for everything `profile_check` lists as missing in **one** message: phone, full address, work
   authorization countries, sponsorship now and in the future, relocation, work mode, earliest start. Ask
   whether they want to store EEO answers (gender, race/ethnicity, veteran, disability). "decline" is a
   valid stored answer. Leaving them unset means they'll be asked every time. Update the profile and
   re-check.

## 5. Cover letter template
If they have one in LaTeX, import it with `template_import kind: "cover"`. Otherwise create
`templates/cover/cover.tex` matching the resume's class, fonts, colours and header, with placeholders
(`\newcommand{\company}{}` etc.) and a plain one-page letter body. Then `template_set_main`, compile,
render, and ask them to approve the look.

## 6. Answer bank
Call `answers_check`. Go through the unanswered questions in groups of 6–8. For each group list:
- the question
- the suggested answer, or the value from their profile when a `source` applies

Ask them to confirm or correct, e.g. "reply 'all good' or give the numbers to change". Write confirmed
answers into `answer` in `profile/answers.yaml` (leave `suggested` as is). Leave sensitive ones `null`
unless they insist. Run `answers_check` after each group.

## 7. Preferences
Ask 4–5 quick questions and write `profile/preferences.md`:
- the tone for cover letters
- what to emphasize
- anything never to mention
- target roles and locations
- whether cover letters should be written by default

## 8. Library (optional)
Mention they can drop transcripts, certificates or writing samples into `library/` for bundling.

Finish with `workspace_check` and a two-line summary of what is ready.
