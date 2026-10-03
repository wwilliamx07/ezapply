# Flows

End-to-end behaviour, step by step. Each step names the component that does it.

## 1. Setup and onboarding

**Terminal (once, and after each update):**
1. `npm run setup` in the repo: `npm install`, `npm run build`, then `ezapply init` ([cli](components/cli.md)).
2. `init` writes `~/.ezapply/config.json` (keeping existing tokens and pairing) and creates or refreshes the
   workspace: folders, `EZAPPLY.md`, `CLAUDE.md` stub, `.mcp.json`, `.claude/settings.json`, skills, and the
   default cover letter template if `templates/cover/` is empty.
3. It also writes the `ezapply` launcher into the workspace, and prints: `cd` into the workspace, run
   `./ezapply chat` (`.\ezapply chat` on Windows), say "set me up". `ezapply chat` is how ezapply is run from
   then on ([cli](components/cli.md#chat-chatts)): it hosts the companion and runs Claude Code, and ezapply
   runs only while it's open. After an update, a chat that was open must be exited and started again.

**In Claude Code** (driven by `EZAPPLY.md` and the `ezapply-onboard` skill; resumable, skips what's done):
1. `workspace_check` returns the checklist: `agent_file`, `tex`, `extension`, `github_login`, `repos_selected`,
   `knowledge_indexed`, `resume_template`, `profile`, `cover_template`, `answer_bank` (required), and
   `preferences`, `library` (optional). `nextStep` is the first required item not done.
2. **TeX:** if missing, the item's detail carries the install command for this OS. Claude asks, runs it,
   and re-checks. No restart is needed.
3. **Extension:** see [flow 2](#2-pairing-the-extension).
4. **GitHub:** with no app registered here, Claude asks whether the user already has an ezapply GitHub App
   (from another computer or an earlier install) or wants a new one. `github_login` opens a page ezapply serves in
   the browser (or, when it can't, gives the user the URL to open). New: it creates a private, read-only
   GitHub App through the manifest flow, has the user install it on chosen repos, then authorizes. Existing:
   the page walks the user through adding the callback URL, copying the Client ID and generating a new
   client secret on GitHub, takes them on the page (not in chat), then authorizes. `github_login_wait` blocks
   until done. Details: [github-and-repos](components/github-and-repos.md).
5. **Repos:** the `ezapply-repos` skill lists accessible repos, proposes a selection, saves it with
   `repos_selection_set`.
6. **Knowledge base:** the `ezapply-index-repo` skill per selected repo (in parallel via subagents when there are
   more than two). See [knowledge-base](components/knowledge-base.md).
7. **Resume and profile:** `template_import` of the user's LaTeX resume folder (a pdfTeX-only template is
   marked `% !TEX program = pdflatex`, and Claude tells the user), compile to check one page, then
   Claude writes `profile/profile.yaml` from it and asks for what `profile_check` lists as missing.
8. **Cover letter template:** keep the default (Claude fills in the identity fields), import the user's own
   LaTeX, or rebuild it from an example letter. See [profile-and-templates](components/profile-and-templates.md).
9. **Answer bank:** unanswered screening questions in groups of 6–8, each with a suggested answer to confirm.
10. **Preferences:** tone, emphasis, never-mention list, target roles and locations → `profile/preferences.md`.
11. **Library (optional):** transcripts, certificates, samples dropped into `library/`.

Any tool failure along the way comes back with a `hint`; Claude follows it (ask, fix, retry).

## 2. Pairing the extension
1. Claude calls `extension_pair`. The companion opens a 15-minute pairing window and returns, per browser,
   the page to open, the steps, and the path to load (`packages/extension/dist` for Chrome, the manifest in
   `dist-firefox` for Firefox), plus a hint if the extension isn't built.
2. Claude relays that for the user's browser. The user loads the unpacked extension: the one manual step.
3. The extension has no pairing code yet, so it connects to the default port and sends `hello` with an
   empty code. Because the window is open, the companion accepts it, pins its id (Chrome extension id or
   Firefox install UUID), closes the window, and returns the real code in `welcome`. The extension stores
   it and uses it from then on.
4. `extension_pair_wait` returns once the extension is connected. The badge turns green.

`extension_pair` with `replace: true` first forgets the pinned extension and rotates the code, so an old
copy (for example in another browser) can't reconnect. A code typed on the options page still works for
non-default ports.

## 3. Capturing a posting ("Set posting")
1. The user clicks the toolbar button (or Alt+Shift+P) on any `http(s)` page. On an Oracle career site the
   browser also asks, once per site, to let ezapply read and change it: that's what lets Claude fill the
   application there later ([site access](components/oracle-adapter.md#site-access)).
2. The extension injects `capturePage` into the tab's frames it may read (the `activeTab` grant, so no host
   permission is needed). Each returns the body HTML, a visible-only copy (hidden subtrees removed by walking
   the live DOM with `checkVisibility`), `innerText`, JSON-LD blocks, URL, title and its visible iframes. The
   frame holding the posting is chosen: the top one, unless an embedded job board frame has the `JobPosting`
   data or more text. A large embedded board it couldn't read opens in a new tab instead, for the user to
   capture there ([extension](components/extension.md#set-posting)).
3. If ezapply isn't connected (no `ezapply chat` is open), the capture is stored as pending (badge `…`) and
   sent on the next connection. Only the latest pending capture is kept. When the user next starts
   `ezapply chat`, `posting_active` waits for the extension to reconnect and deliver it.
4. The companion ([postings](components/postings.md)) canonicalizes the URL (for Workday, without the locale
   segment; for Oracle, without the language or the application pages after the job id); a posting already captured at that URL reuses its folder. Otherwise it makes `postings/<date>_<company>_<role>/`. It writes the raw
   and visible captures, runs extraction to `posting.md`, writes `meta.json` (keeping fields Claude
   corrected earlier), and makes it the active posting.
5. The badge flashes ✓ and the tooltip shows "Active: <company>: <role>".
6. **A fresh Claude session.** The companion tells `ezapply chat` that the active posting changed. If the
   running session has used a tool (and none is running, or as soon as the running one ends), it ends that Claude and starts a new one in the
   same terminal, with one line saying so; the user types their next request there. So the earlier
   application (or the onboarding, at the first capture) isn't re-sent with every turn of the next one. A
   session that hasn't done anything, or a re-capture of the same posting, keeps going. Off with
   `context.restartOnCapture: false` in `ezapply.config.json`.

## 4. Tailoring the resume ("tailor my resume")
The `ezapply-resume` skill:
1. `posting_active` → read `posting.md`; correct company or role with `posting_update_meta`. If
   `notes.md` has no `## Application requirements`, write it (documents wanted, single PDF → `bundleRequired`,
   format, naming, limits, addressee, deadline) and mention them to the user. Every later skill (cover
   letter, bundle, apply) follows it. Any request about a posting does this first, per `EZAPPLY.md`.
2. Read the profile, preferences, every claim (`claims_list`, already called at the first request per
   `EZAPPLY.md`) and the template; copy the template's main file to
   `postings/<id>/resume.tex` if it isn't there (it keeps the template's `% !TEX program` comment, so it
   builds with the same engine), along with the files it `\input`s (`contentFiles` in `template.json`) at the
   same relative paths; set status `drafting`.
3. Write `notes.md`: requirements, key terms, an **evidence map** from each requirement to claim ids or
   profile entries, and gaps (never presented as skills).
4. Edit `resume.tex` content only (structure and styling stay), with a `% src:` comment per changed bullet.
5. Loop: `tex_compile` (must be exactly one page; `*resume*`/`*cv*` files are checked against the page
   limit, and `overflow` says how much ran over) → `pdf_render` to look → `pdf_text` for ATS order → self-check each bullet against its evidence.
6. Report the changes and gaps in a few lines; `tex_diff` on request. Then the attach mode decides: see
   [flow 8](#8-review-and-attach).

## 5. Cover letter ("write a cover letter")
The `ezapply-cover-letter` skill: same inputs plus `templates/cover/format.md` if the user supplied an example.
Copy the template to `postings/<id>/cover.tex`, fill the per-letter fields, write the body between the
`% BODY START` / `% BODY END` markers (opening, two evidence paragraphs, close, 250–380 words unless
`format.md` says otherwise), compile to one page, render, report.

## 6. Bundle ("put them in one PDF")
The `ezapply-bundle` skill (also triggered by "all files in one PDF" in the recorded requirements): record `bundleRequired`, order (posting's order, else cover → resume → extras),
convert scans with `pdf_from_images`, `pdf_merge` with a bookmark per section and page sizes normalized,
check with `pdf_info` (and that the resume section is still one page), `pdf_compress` if over the limit
(form limit, else 5 MB).

## 7. Autofill ("fill out the application")
The `ezapply-apply` skill, over the [form tools](mcp-tools.md#forms) and the site adapters
([Workday](components/workday-adapter.md), [Oracle](components/oracle-adapter.md)):
1. `posting_active`; read the profile and answer bank. The form tools act on the application tab (Workday or
   Oracle) of this posting's tenant and credit everything to it; a tab of another posting (another company's tenant, or another requisition at the same one) is
   read with `postingMismatch`, every call that would change it is refused with `posting_mismatch`, and Claude
   stops to sort it out with the user. Before each form call the companion
   brings that tab to the front of its window (not while a review page waits for the user); if it's still
   hidden (a minimized window), results carry `tabHidden` and Claude tells the user once to keep it visible,
   since the browser slows hidden tabs.
2. `get_form` → by `pageKind`: `posting` → `page_action apply`; `auth` → the user signs in (on Oracle: the
   email step and its emailed code) and says when done; `start-choice` → `page_action apply_manually` (on
   Oracle, "Welcome Back": the user chooses Use My Profile or an import); `review` → hand-off;
   `confirmation` → done; `unknown` → `get_form` again and `browser_status`, then the user is asked what the
   page shows, and only if neither explains it a `screenshot` (the last-resort escape hatch; a widget that
   still fails after one retry goes to the user without one). An Oracle application is often one page with only Submit: every section is filled,
   then hand-off. Oracle's work, education, language and license items are added through an inline form and
   its `save.<block>` button: `autofill_step` adds the profile's work, education and language entries itself.
3. Each step: `autofill_step` fills what the profile and answer bank settle (hinted profile fields; work,
   education, language and website rows, adding the rows the profile needs; link fields; Oracle's items through
   their inline forms; questions worded exactly as an answer-bank entry, with a plain or computed answer;
   [autofill](components/autofill.md)) and returns the rest; Claude glances at what was filled, fixes what failed, and decides every field left (profile facts via hints; screening questions matched to the answer bank
   by meaning, with an explicit polarity check; numbers computed; unknown, sensitive, EEO or salary asked
   in one message per step, and a resolved miss or a new answer offered for saving to the answer bank; the
   skills that fit the role, not necessarily all), `add_repeatable` for lists autofill doesn't fill
   (certifications), `fill_fields` once for the whole step with a
   `source` per value, then one retry call for all the failures (from their `availableOptions`), never one
   field per call (`unmatched` typeahead entries come with the options their search showed; a date the page
   doesn't take is typed by the user); `list_options` first only for questions whose option wording decides the answer, all in
   one call; `upload_file` for documents (every approved one: on Workday's single Resume/CV field, which
   takes several files, the resume and the cover letter both; `notAttached` in the upload result lists what's
   left); `go_next`. To change an earlier step, `go_back` to it,
   fix, and `go_next` forward again. Values carried over from the last
   application are cleared first: attached files this application didn't upload (per `form-log.jsonl`) and
   multi-select entries such as skills that don't belong go through `remove_items`, extra work-history,
   education or website rows through `remove_repeatable`, then the current documents and values are added.
4. **Hand-off** at the review page (Oracle: once every section is filled and Submit is next). The page's
   `handoff` (the companion's summary from the log: warnings still open per step, answers from the user or
   judgment, automatic fills, replaced and removed values) is what Claude's message is built from. If `go_next`
   or `get_form` reports `notAttached` there, Claude goes back and attaches those documents first. Then it summarizes what was filled, what was removed from a previous application (attachments, skills, rows), what came from the user or Claude's
   judgment, and what couldn't be filled. The user reviews and presses Submit.
5. Every fill, removal, upload and step is appended to `form-log.jsonl`; status moves automatically: `attached` on
   a successful upload, `filled` at the review page, `submitted` when the confirmation page is seen. Oracle has
   no review page, so there `filled` isn't set automatically.
   After an interruption, `get_form` shows where things stand and filling continues from there.

## 8. Review and attach
Once a document is finished, the attach mode (`documents.attach`, asked during onboarding) decides:
- **after-approval** (default): `review_documents` opens a page in the browser with the PDFs, each with a box
  for changes, and waits. The user approves (empty box) or writes what should change and sends it; the tab
  closes and the call returns both; Claude revises the changed documents, rebuilds, and reviews them again until everything is approved.
  Approvals are stored per exact version in `approvals.json`.
- **immediately**: no review step.

Then, if the application is open at the step with the file field, Claude attaches the documents right away
(`upload_file`, after clearing leftovers); otherwise it says they're ready and attaches them when filling
([flow 7](#7-autofill-fill-out-the-application)). In after-approval mode `upload_file` itself refuses anything
not approved in its current version, so a rebuilt document is reviewed again.

## Posting status

`captured` → `drafting` (resume/cover work starts) → `attached` → `filled` → `submitted`; `archived` is set
by hand. Automatic moves only go forward.
