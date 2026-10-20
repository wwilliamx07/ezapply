# Flows

End-to-end behaviour, step by step. Each step names the component that does it.

## 1. Setup and onboarding

**Terminal (once, and after each update):**
1. `npm run setup` in the repo: `npm install`, `npm run build`, then `ezapply init` ([cli](components/cli.md)).
2. `init` writes `~/.ezapply/config.json` (keeping existing tokens and pairing) and creates or refreshes the
   workspace: folders, `EZAPPLY.md`, `CLAUDE.md` stub, `.mcp.json`, `.claude/settings.json`, skills, and the
   default cover letter template if `templates/cover/` is empty.
3. It also writes the `ezapply` launcher into the workspace, and prints: `cd` into the workspace, run
   `./ezapply` (`.\ezapply` on Windows). That's how ezapply is run from then on ([cli](components/cli.md#ezapply-panelts)):
   it hosts the companion, which starts Claude Code headless for the side panel, and ezapply runs only while it
   does. It opens the setup page while setup isn't finished. After an update, a running ezapply must be stopped and started again.

**On the setup page** (driven by `EZAPPLY.md` and the `ezapply-onboard` skill; resumable, steps in any order;
[ui](components/ui.md#the-onboarding-page-onboard)):
1. Under `ezapply`, the setup page opens when ezapply starts while setup isn't finished, or from the panel's
   Setup; what needs Claude goes to the panel's agent as messages ([tasks](components/ui.md#the-agents-side-tasks)).
   Asked to set the user up, Claude calls `onboarding {}`, which opens the page (or gives Claude the link).
2. The page shows the `workspace_check` items as steps, done ones ticked
   ([the items](components/companion.md#readiness-checklist-workspace_check)). It opens on the first required step
   not done.
3. **TeX:** if missing, the page shows the install command for this OS and hands Claude an `install-tex` task;
   Claude runs it once the user approves it (an approval card in the panel). No restart is needed.
4. **Extension:** the page gives the steps and folder for the user's browser and opens the pairing window
   ([flow 2](#2-pairing-the-extension)); it turns green when the extension connects.
5. **GitHub:** a new app or an existing one, then the `/github/` flow in a new tab, as `github_login` runs it:
   the manifest flow and install for a new app; for an existing one, the callback URL, Client ID and a new client
   secret typed into that page, never the chat. Details: [github-and-repos](components/github-and-repos.md).
6. **Repos:** every repository the app can read, the ones a person would rarely pick (forks, archived, nearly
   empty, the profile README, dotfiles) left out of the suggestion; the user ticks and saves
   (`profile/repos.yaml`).
7. **Knowledge base:** an `index-repos` task: Claude runs the `ezapply-index-repo` skill per repo (in parallel via
   subagents when there are more than two), and the page ticks each as it's marked indexed. See
   [knowledge-base](components/knowledge-base.md).
8. **Resume:** the user's LaTeX folder or `.tex` file, typed or chosen in the system's dialog, imported
   (`template_import`: a pdfTeX-only template is marked `% !TEX program = pdflatex`) and built, with a preview and
   its page count. A build that fails on the environment becomes a `fix-template-build` task.
9. **Profile:** a `draft-profile` task: Claude writes `profile/profile.yaml` from the resume. The user checks it in
   a form of every field and fills what a resume doesn't say (phone, address, work authorization, sponsorship,
   EEO answers or "decline"); the page saves it in place, keeping the file's comments.
10. **Cover letter template:** keep the default (Claude fills in the identity fields, or restyles it like the
   resume), import the user's own LaTeX, or drop an example letter for Claude to rebuild the layout from; a preview,
   and changes asked of Claude. See [profile-and-templates](components/profile-and-templates.md).
11. **Answer bank:** unanswered screening questions eight at a time, each with its suggestion filled in, saved in
   place. Questions the profile answers (sponsorship, relocation, start date…) aren't asked again; the step lists
   them with the profile's value.
12. **Preferences:** the attach mode, then tone, emphasis, never-mention list, target roles and locations, cover
   letters → `profile/preferences.md`.
13. **Library (optional):** files dropped on the page go into `library/`; each listed file can be deleted there.
14. **Finish setup** (or **Finish later**) ends Claude's wait: it says in two lines what's ready and what's left.

Any tool failure along the way comes back with a `hint`; Claude follows it (ask, fix, retry). The page shows a
failed action's message and hint under the button that ran it.

**At the start of every session** (after onboarding too), Claude calls `workspace_changes` (with
`posting_get` in a posting's conversation). The companion has checked in the background since the chat started: repos pushed since
indexing, knowledge from repos no longer selected, a template's source folder edited since import (or a template imported from a scratchpad copy, which nothing can watch), a LaTeX document in `library/` no template came from, the resume
template edited since the profile was updated from it, the profile's contact changed under the cover's fields.
Nothing listed, Claude says nothing. Otherwise it lists them, and with the user's agreement re-imports,
updates the profile from the diff, updates the cover fields and re-indexes, marking each done, or marks them
`later`: a repo for a day unless the user says longer (it isn't checked in any chat until then), anything else
for the rest of the chat ([details](components/companion.md#keeping-the-workspace-current-workspace_changes)).

## 2. Pairing the extension
On the setup page its extension step does steps 1 and 2 (the same `startPairing`); later, in chat, Claude does:
1. Claude calls `extension_pair`. The companion opens a 15-minute pairing window and returns the page to open,
   the steps, and the folder to load (`packages/extension/dist`, for Chrome and other Chromium browsers), plus a
   hint if the extension isn't built.
2. Claude relays that. The user loads the unpacked extension: the one manual step.
3. The extension has no pairing code yet, so it connects to the default port and sends `hello` with an
   empty code. Because the window is open, the companion accepts it, pins its extension id, closes the window, and returns the real code in `welcome`. The extension stores
   it and uses it from then on.
4. `extension_pair_wait` returns once the extension is connected. The badge turns green.

`extension_pair` with `replace: true` first forgets the pinned extension and rotates the code, so an old
copy (for example in another browser) can't reconnect. A code typed on the options page still works for
non-default ports.

## 3. Capturing a posting ("Capture")
1. The user presses **Capture** in the side panel (or Alt+Shift+P) on any `http(s)` page. The extension holds
   every site from the install; where the user limited that, the click asks for it again
   ([access](components/extension.md#access-to-websites)).
2. The extension injects `capturePage` into the tab's frames it may read (every frame; with access withheld,
   the tab's own origin by the click's `activeTab` grant). Each returns the body HTML, a visible-only copy (hidden subtrees removed by walking
   the live DOM with `checkVisibility`), `innerText` (empty for a frame that isn't rendered), JSON-LD blocks, URL, title and its visible iframes. The
   frame holding the posting is chosen: the top one, unless an embedded job board frame has the `JobPosting`
   data or more text. A large embedded board it couldn't read opens in a new tab instead, for the user to
   capture there ([extension](components/extension.md#capture)). The chosen frame's site, as its body shows
   it ([telling a page's site](components/extension.md#telling-a-pages-site-framests)), goes with the capture.
3. If ezapply isn't connected (it isn't running), the capture is stored as pending (badge `…`) and sent on the
   next connection. Only the latest pending capture is kept. When the user next starts ezapply, `posting_get` and
   `postings_list` wait for the extension to reconnect and deliver it.
4. The companion ([postings](components/postings.md)) canonicalizes the URL (for Workday, without the locale
   segment; for Oracle, without the language or the application pages after the job id); a posting already captured at that URL reuses its folder. Otherwise it makes `postings/<date>_<company>_<role>/`. It writes the raw
   and visible captures, runs extraction to `posting.md`, writes `meta.json` (keeping fields Claude
   corrected earlier).
5. The badge flashes ✓ and the tooltip shows "Captured: <company>: <role>". The side panel's list shows it; captured
   from the panel's **+ Capture**, the panel opens the posting and its conversations (new ones, or the ones it had).
6. **Nothing restarts:** each posting has its own conversations with the agent, one for its documents and one for
   its application ([agent](components/agent.md#conversations-servicets)), so the next application starts clean,
   the earlier one isn't re-sent with every turn of it, and the earlier one can be picked up again.

**Requests (flows 4 to 7)** come from the side panel: its buttons send them in words (Tailor documents, Fill
form), or the user types them in its chat bar. Tailoring (flows 4 to 6, and revising after a review) runs in the
posting's documents conversation and filling (flow 7) in its application conversation, whichever comes first. Claude's questions come on cards in the panel (`ask_user`), its commands that need approval as approval
cards, and its reports in the panel's conversation ([ui](components/ui.md#the-side-panel-srcpanel)).

## 4. Tailoring the resume ("tailor my resume")
The `ezapply-resume` skill:
1. `posting_get` → read `posting.md`; correct company or role with `posting_update_meta`. If
   `notes.md` has no `## Application requirements`, write it (documents wanted, single PDF → `bundleRequired`,
   format, naming, limits, addressee, deadline) and mention them to the user. Every later skill (cover
   letter, bundle, apply) follows it. Any request about a posting does this first, per `EZAPPLY.md`.
2. Read the profile (the preferences are already in context, imported by `EZAPPLY.md`), every claim (`claims_list`, already called at the first request per
   `EZAPPLY.md`) and the template; copy the template's main file to
   `postings/<id>/resume.tex` if it isn't there (it keeps the template's `% !TEX program` comment, so it
   builds with the same engine), along with the files it `\input`s (`contentFiles` in `template.json`) at the
   same relative paths; set status `drafting`.
3. Write `notes.md`: requirements, key terms, an **evidence map** from each requirement to claim ids or
   profile entries, and gaps (never presented as skills).
4. Edit `resume.tex` content only (structure and styling stay), with a `% src:` comment per changed bullet, each
   round's Edits and its `tex_compile` in one message, then a reread of the changed passages.
5. Loop: `tex_compile` (must be exactly one page; `*resume*`/`*cv*` files are checked against the page
   limit, and `overflow` says how much ran over; within it, `lint` names layout problems) → fix what `lint`
   lists → `pdf_text` for ATS order → self-check each bullet against its evidence.
6. Report the changes and gaps in a few lines; `tex_diff` on request. Then the attach mode decides: see
   [flow 8](#8-review-and-attach).

## 5. Cover letter ("write a cover letter")
The `ezapply-cover-letter` skill: same inputs plus `templates/cover/format.md` if the user supplied an example.
Copy the template to `postings/<id>/cover.tex`, fill the per-letter fields, write the body between the
`% BODY START` / `% BODY END` markers (opening, one evidence paragraph per project or role until the page is full,
close; shorter only when the posting or `format.md` sets a length or the evidence runs out), compile to one
page, fix what `lint` lists and fill what `freeLines` leaves, report; the review refuses it underfilled
unless `short` says why.

## 6. Bundle ("put them in one PDF")
The `ezapply-bundle` skill (also triggered by "all files in one PDF" in the recorded requirements): record `bundleRequired`, order (posting's order, else cover → resume → extras),
convert scans with `pdf_from_images`, `pdf_merge` with a bookmark per section and page sizes normalized,
check with `pdf_info` (and that the resume section is still one page), `pdf_compress` if over the limit
(form limit, else 5 MB).

## 7. Filling the application ("fill out the application")
The `ezapply-apply` skill, over the [form tools](mcp-tools.md#forms) and the site adapters
([Workday](components/sites/workday.md), [Oracle](components/sites/oracle.md),
[Greenhouse, Lever, Ashby, Phenom, Dayforce, SAP SuccessFactors](components/sites.md)):
1. `posting_get`; read the profile and answer bank. The form tools act on this posting's application tab
   (by its job, the tab it was bound to, its tenant, or its title: [which posting](mcp-tools.md#forms)) and
   credit everything to it. An application embedded in a frame of a careers page counts as a tab of its own,
   and the tools act inside that frame. A posting captured off the form sites is tied to its application by the captured
   page's link, or else the first fill binds the tab to it and Claude tells the user once (`postingBound`). A tab
   of another posting (another employer, another requisition, a tab bound to another posting) is read with
   `postingMismatch`, every call that would change it is refused with `posting_mismatch`, and Claude stops to
   sort it out with the user (`tab_bind { tabId }` when the user says the tab is right). Before each form call the extension
   turns on focus emulation for that tab, so it runs at full speed and focused wherever it is (Chrome shows its
   debugging bar meanwhile). Where that can't run and the tab is hidden, results carry `tabHidden` and Claude
   tells the user once to keep it visible, since the browser slows hidden tabs; where the window is behind
   another app, results of calls that change the page carry `browserBehind`, which Claude passes on when a
   field (a date) isn't taken.
2. `get_form`. The first read of a site's page in the session carries that site's `siteNotes`, which Claude
   follows for the application ([site notes](mcp-tools.md#site-notes)). Then by `pageKind`: `posting` → `page_action apply`; `auth` → the user signs in (on Oracle: the
   email step and its emailed code) and answers Claude's card ("Signed in") when done; `start-choice` → `page_action apply_manually` (on
   Oracle, "Welcome Back": the user chooses Use My Profile or an import); `review` → hand-off;
   `confirmation` → done; `unknown` → `get_form` again and `browser_status`, then the user is asked what the
   page shows, and only if neither explains it a `screenshot` (the last-resort escape hatch; a widget that
   still fails after one retry goes to the user without one). An Oracle application is often one page with only Submit: every section is filled,
   then hand-off. Oracle's work, education, language and license items are added through an inline form and
   its `save.<block>` button, one entry at a time.
   Dayforce's employment and education records are added the same way, and its Personal Information is saved
   with its own Update (`save.personal-information`); its Submit step is the review page.
3. Each step: `get_form` (or the `form` `go_next` returned), then Claude decides every field (profile facts via
   hints and labels, read as written: a level on a numeric scale takes a number; screening questions matched to the answer bank
   by meaning, with an explicit polarity check; numbers computed; unknown, sensitive, EEO or salary asked
   on one `ask_user` card per step, with Claude's suggestion where it has one (in chat without a panel), and a resolved miss or a new answer offered for saving to the answer bank; the
   skills that fit the role, not necessarily all), one `add_repeatable { addButtonIds }` for every row or item
   missing from each list against the profile's entries (work, education, languages, certifications, links), `fill_fields` once for the whole step with a
   `source` per value, then one retry call for all the failures (from a miss's closest options), never one
   field per call and never listing options first (`unmatched` typeahead entries come with the options their
   search showed, and an item named without its category with its full path; a date the page doesn't take is
   typed by the user); `upload_file` for documents (every approved one: on Workday's single Resume/CV field, which
   takes several files, the resume and the cover letter both; `notAttached` in the upload result lists what's
   left); `go_next`. To change an earlier step, `go_back` to it,
   fix, and `go_next` forward again. Values carried over from the last
   application are cleared first: attached files this application didn't upload (per `form-log.jsonl`) and
   multi-select entries such as skills that don't belong go through `remove_items`, extra work-history,
   education or website rows through `remove_repeatable`, then the current documents and values are added.
4. **Hand-off** at the review page (Oracle: once every section is filled and Submit is next). The page's
   `handoff` (the companion's summary from the log: warnings still open per step, answers from the user or
   judgment, removed values) is what Claude's message is built from. If `go_next`
   or `get_form` reports `notAttached` there, Claude goes back and attaches those documents first. Then it summarizes what was filled, what was removed from a previous application (attachments, skills, rows), what came from the user or Claude's
   judgment, and what couldn't be filled. The user reviews and presses Submit.
5. Every fill, removal, upload and step is appended to `form-log.jsonl`; status moves automatically: `attached` on
   a successful upload, `filled` at the review page, `submitted` when the confirmation page is seen. Oracle has
   no review page, so there `filled` isn't set automatically.
   After an interruption, `get_form` shows where things stand and filling continues from there.
6. **Submit.** From the hand-off on, the extension watches the tab and, once the user's Submit brings the
   confirmation page, moves the posting to `submitted` with no agent involved
   ([the watch](components/extension.md#watching-for-the-users-submit-submit-watchts)). One it misses, the user
   marks in the panel (**Mark submitted**).

## 8. Review and attach
Once a document is finished, the attach mode (`documents.attach`, set on the onboarding page) decides:
- **after-approval** (default): `review_documents` opens a page in the browser with the PDFs; in the panel the
  agent's turn ends there ([results as messages](components/agent.md#results-as-messages)), and in a terminal chat
  the call waits. The user approves each, or comments on passages and writes what should change, and sends it; the
  tab closes and both reach the agent, as its next message in the panel or the call's result in a terminal. Claude revises the changed documents, rebuilds, reports what changed (`pdf_text { path,
  sinceReviewed: true }`), and reviews them again, the page marking what changed since, until everything is approved.
  Approvals are stored per exact version in `approvals.json`.
- **immediately**: no review step.

Then, if the application is open at the step with the file field, Claude attaches the documents right away
(`upload_file`, after clearing leftovers); otherwise it says they're ready and attaches them when filling
([flow 7](#7-filling-the-application-fill-out-the-application)). In after-approval mode `upload_file` itself refuses anything
not approved in its current version, so a rebuilt document is reviewed again.

## Posting status

`captured` → `drafting` (resume/cover work starts) → `attached` → `filled` → `submitted`; `archived` is set
by hand. Automatic moves only go forward.
