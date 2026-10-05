---
name: ezapply-onboard
description: Set up or resume ezapply onboarding (GitHub login and repo selection, project knowledge base, resume import and profile, cover letter template, screening-question answers, preferences), and keep the workspace current. Use when the user says onboard, set up, or get started, when workspace_check reports missing steps, or when workspace_changes lists changes.
---

# Keeping the workspace current

When `workspace_changes { refresh? }` lists changes, the knowledge base, a template, the profile or the cover
letter's fields are behind what they come from. Never re-import, re-index or change the profile without the
user's agreement: these cost time, and the templates and profile are theirs.

1. Tell the user what changed, one short line per change (its `summary`). Say which ones the request in hand
   needs first (`affects`): a resume tailored from a template whose source moved, a form filled from a profile
   behind the resume. Ask whether to update now, after this posting, or later. Mark the ones put off with
   `workspace_change_mark { id, as: "later" }`, so later sessions in this chat don't ask again.
2. Work in this order, since each feeds the next:
   - **`template-source`:** confirm first, then `template_import { source, kind, replace: true }` with the
     folder or file from the summary. The old copy moves to `templates/.old/`. If it held a fix made at onboarding
     (a font path, a `% !TEX program` line), carry it over and compile. If the user says the difference doesn't
     matter, mark it `done` instead.
   - **`template-untracked`:** the template came from a copy in a scratchpad, so the user's edits go unnoticed.
     Ask which file or folder they actually edit (a `library-template` change, or a library file its `detail`
     names, is likely it), then `template_import { source, kind, replace: true }` from that. If they keep no file
     of their own, mark it `done`.
   - **`library-template`:** a LaTeX document in `library/` that no template came from. Ask whether it's their
     resume or cover letter (usually a newer one). If so, confirm replacing the current template and
     `template_import` with the `source` its `detail` gives; that ends this change and any `template-untracked`
     for that kind, and a new resume then shows up as `resume-edited` for the profile. If it isn't a template,
     mark it `done`.
   - **`resume-edited`:** update `profile/profile.yaml` from the change's `diff` alone, with the Edit tool: add
     or change only what the diff shows (a new job, a degree, skills, reworded highlights). Keep what the resume
     never held (address, work authorization, answers given in chat). A job or degree gone from the resume is
     asked about, not deleted: forms often want the full history. `profile_check`, then mark it `done`. A diff
     that touches nothing in the profile (layout, spacing) is marked `done` too.
   - **`profile-identity`:** update the cover template's name and contact fields (`\myname`, `\mycontact`) from
     the profile, `tex_compile { path }`, `pdf_render { path, page? }`, then mark it `done`.
   - **`repo-pushed`:** run the **ezapply-index-repo** skill for each repo, in parallel subagents when there are
     more than two. Its `knowledge_mark_indexed { repo }` ends the change. If `claims_list` was read earlier in this
     session, read it again afterwards.
   - **`repo-deselected`:** ask whether to delete that repo's knowledge and cache (mark it `done`, which deletes
     them) or select the repo again (the **ezapply-repos** skill).
3. Finish with one line on what was updated, then carry on with the user's request.

`notChecked` lists what couldn't be checked. Mention it only when the user can fix it: an expired GitHub login
(its hint says `github_login`), or a template's source folder that has moved.

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
1. Ask for the folder that holds their LaTeX resume, or the `.tex` file itself when it's a single file
   (absolute path). Call `template_import { source, kind: "resume", main?, replace? }` with that path, never a
   copy you make of it: the workspace check watches the source for the user's later edits, and a copy never
   changes. A file in `library/` is imported from there as it is. If it reports ambiguity, ask which file
   is the main one. If the result has `texProgram.added`, tell the user its `note`: the template is now marked
   to build with pdflatex.
2. `tex_compile { path }` the imported main file. Fix only environment problems (missing packages are
   installed automatically; font paths may need adjusting). Never change the content. Confirm it is one page
   and `pdf_render { path, page? }` it. If it only builds under another engine than the one used (e.g.
   `Undefined control sequence \pdfglyphtounicode` under XeLaTeX), add `% !TEX program = <engine>` as its
   first line rather than editing the template.
3. Read the resume source and write `profile/profile.yaml`: identity, contact, links, work history
   (YYYY-MM dates, `end: null` for current), education, skills, languages, certifications. Run
   `profile_check` until it is valid.
4. Ask for everything `profile_check` lists as missing in **one** message: phone, full address, work
   authorization countries, sponsorship now and in the future, relocation, work mode, earliest start. Ask
   whether they want to store EEO answers (gender, race/ethnicity, veteran, disability). "decline" is a
   valid stored answer. Leaving them unset means they'll be asked every time. Update the profile and
   re-check.

## 5. Cover letter template
`templates/cover/` starts with ezapply's default: a plain one-page letter. Ask which they want:
1. **The default.** Fill its identity fields (`\myname`, `\mycontact`) from the profile. Offer to restyle
   it to match the resume's fonts and header so the two look like a set.
2. **Their own LaTeX template.** `template_import { source, kind: "cover" }` with their folder or `.tex` file. It
   replaces the default without asking.
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

## 7. Preferences
First ask how documents should reach applications, and save it with `attach_mode_set { mode }`:
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
