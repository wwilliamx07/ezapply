---
name: ezapply-onboard
description: Set up or resume ezapply on its setup page in the browser (TeX, extension, GitHub and repos, resume and profile, cover letter template, screening answers, preferences), doing the tasks the page hands you, and keep the workspace current. Use when the user says onboard, set up, or get started, wants to change a setup step, when workspace_check reports missing steps, or when workspace_changes lists changes.
---

# Keeping the workspace current

When `workspace_changes { refresh? }` lists changes, the knowledge base, a template, the profile or the cover
letter's fields are behind what they come from. Never re-import, re-index or change the profile without the
user's agreement: these cost time, and the templates and profile are theirs.

1. Tell the user what changed, one short line per change (its `summary`). Say which ones the request in hand
   needs first (`affects`): a resume tailored from a template whose source moved, a form filled from a profile
   behind the resume. Ask whether to update now, after this posting, or later. Mark the ones put off with
   `workspace_change_mark { ids, as: "later", hours? }`, one call for all of them:
   - **Repos (`repo-pushed`):** "later" puts them off past this chat, for a day unless the user says longer
     (`hours`: "for a week" is 168; at most 90 days). They aren't checked or asked about until then. All of them
     unless the user names some. Say until when.
   - **Anything else:** no `hours`. It's hidden for the rest of this chat only: a template or profile behind its
     source feeds the next document, so the next chat asks again.

   If the user asks what they put off, `workspace_changes` lists the repos under `deferred`, with when each is
   checked again; re-indexing one early ends its timer.
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

Onboarding happens on a page in the user's browser, not in this chat: TeX, the extension, GitHub and repos,
the resume and profile, the cover letter template, screening answers, preferences, library. The user fills in
the page; you do the parts that need you, as tasks it sends.

1. Call `onboarding {}`. It opens the page (or gives you its `url` to pass on when no browser opened, then
   call it again) and waits for work. Tell the user in one line that setup is on the page that opened and you'll
   handle what it hands you.
2. A `task` comes back with `{ id, kind, params, how }`. Do what `how` says, with your tools and the skills it
   names. Keep the chat short: the page shows the user what you're doing. Then report and wait for the next in
   one call: `onboarding { taskId, result: { ok, note? } }`. `note` is shown on the page: a sentence on what you
   did, or what the user must do if it failed (`ok: false`).
3. `waiting` means nothing came yet: call `onboarding {}` again. Past two minutes the call continues in the
   background and its result arrives as a notification, so the chat stays usable meanwhile.
4. `done` means the user finished (or paused) on the page: say in two lines what's ready and what's left
   (`notDone`), and that they can ask you to set them up again any time.

**In the ezapply panel** (ezapply started with `ezapply`), you don't wait in `onboarding`: a task arrives as a
message ("Setup task t3 from the setup page …") with what to do and its parameters. Do it, then report it
without waiting: `onboarding { taskId, result: { ok, note? }, wait: false }`. To open the page, call
`onboarding { wait: false }`.

The same call reopens the page later, when the user wants to change a step (another resume, more repos).
Never ask in chat for what the page collects: a password, a client secret, an address, screening answers.
