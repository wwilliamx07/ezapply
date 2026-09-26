# Flows

End-to-end behaviour, step by step. Each step names the component that does it.

## 1. Setup and onboarding

**Terminal (once, and after each update):**
1. `npm run setup` in the repo: `npm install`, `npm run build`, then `ezapply init` ([cli](components/cli.md)).
2. `init` writes `~/.ezapply/daemon.json` (keeping existing tokens and pairing) and creates or refreshes the
   workspace: folders, `EZAPPLY.md`, `CLAUDE.md` stub, `.mcp.json`, `.claude/settings.json`, skills, and the
   default cover letter template if `templates/cover/` is empty.
3. It prints: `cd` into the workspace, run `claude`, say "set me up".

**In Claude Code** (driven by `EZAPPLY.md` and the `onboard` skill; resumable, skips what's done):
1. `workspace_check` returns the checklist: `agent_file`, `tex`, `extension`, `github_login`, `repos_selected`,
   `knowledge_indexed`, `resume_template`, `profile`, `cover_template`, `answer_bank` (required), and
   `preferences`, `library` (optional). `nextStep` is the first required item not done.
2. **TeX:** if missing, the item's detail carries the install command for this OS. Claude asks, runs it,
   and re-checks. No restart is needed.
3. **Extension:** see [flow 2](#2-pairing-the-extension).
4. **GitHub:** `github_login` opens a daemon page in the browser. The first time, it creates a private,
   read-only GitHub App through the manifest flow, has the user install it on chosen repos, then
   authorizes. `github_login_wait` blocks until done. Details: [github-and-repos](components/github-and-repos.md).
5. **Repos:** the `repos` skill lists accessible repos, proposes a selection, saves it with
   `repos_selection_set`.
6. **Knowledge base:** the `index-repo` skill per selected repo (in parallel via subagents when there are
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
1. Claude calls `extension_pair`. The daemon opens a 15-minute pairing window and returns, per browser,
   the page to open, the steps, and the path to load (`packages/extension/dist` for Chrome, the manifest in
   `dist-firefox` for Firefox), plus a hint if the extension isn't built.
2. Claude relays that for the user's browser. The user loads the unpacked extension: the one manual step.
3. The extension has no pairing code yet, so it connects to the default port and sends `hello` with an
   empty code. Because the window is open, the daemon accepts it, pins its id (Chrome extension id or
   Firefox install UUID), closes the window, and returns the real code in `welcome`. The extension stores
   it and uses it from then on.
4. `extension_pair_wait` returns once the extension is connected. The badge turns green.

`extension_pair` with `replace: true` first forgets the pinned extension and rotates the code, so an old
copy (for example in another browser) can't reconnect. `ezapply pair` does the same from a terminal, and
a code typed on the options page still works for non-default ports.

## 3. Capturing a posting ("Set posting")
1. The user clicks the toolbar button (or Alt+Shift+P) on any `http(s)` page.
2. The extension injects `capturePage` into the tab (the `activeTab` grant, so no host permission is
   needed). It returns the body HTML, a visible-only copy (hidden subtrees removed by walking the live DOM
   with `checkVisibility`), `innerText`, JSON-LD blocks, URL and title.
3. If the daemon isn't connected, the capture is stored as pending (badge `…`) and sent on the next
   connection. Only the latest pending capture is kept.
4. The daemon ([postings](components/postings.md)) canonicalizes the URL; a posting already captured at
   that URL reuses its folder. Otherwise it makes `postings/<date>_<company>_<role>/`. It writes the raw
   and visible captures, runs extraction to `posting.md`, writes `meta.json` (keeping fields Claude
   corrected earlier), and makes it the active posting.
5. The badge flashes ✓ and the tooltip shows "Active: <company>: <role>".

## 4. Tailoring the resume ("tailor my resume")
The `resume` skill:
1. `posting_active` → read `posting.md`; correct company or role with `posting_update_meta`. If
   `notes.md` has no `## Application requirements`, write it (documents wanted, single PDF → `bundleRequired`,
   format, naming, limits, addressee, deadline) and mention them to the user. Every later skill (cover
   letter, bundle, apply) follows it. Any request about a posting does this first, per `EZAPPLY.md`.
2. Read the profile, preferences and template; copy the template's main file to
   `postings/<id>/resume.tex` if it isn't there (it keeps the template's `% !TEX program` comment, so it
   builds with the same engine); set status `drafting`.
3. Write `notes.md`: requirements, key terms, an **evidence map** from each requirement to claim ids or
   profile entries, and gaps (never presented as skills).
4. Edit `resume.tex` content only (structure and styling stay), with a `% src:` comment per changed bullet.
5. Loop: `tex_compile` (must be exactly one page; `*resume*`/`*cv*` files are checked against the page
   limit) → `pdf_render` to look → `pdf_text` for ATS order → self-check each bullet against its evidence.
6. Report the changes and gaps in a few lines; `open_file` the first time. `tex_diff` on request.

## 5. Cover letter ("write a cover letter")
The `cover-letter` skill: same inputs plus `templates/cover/format.md` if the user supplied an example.
Copy the template to `postings/<id>/cover.tex`, fill the per-letter fields, write the body between the
`% BODY START` / `% BODY END` markers (opening, two evidence paragraphs, close, 250–380 words unless
`format.md` says otherwise), compile to one page, render, report.

## 6. Bundle ("put them in one PDF")
The `bundle` skill (also triggered by "all files in one PDF" in the recorded requirements): record `bundleRequired`, order (posting's order, else cover → resume → extras),
convert scans with `pdf_from_images`, `pdf_merge` with a bookmark per section and page sizes normalized,
check with `pdf_info` (and that the resume section is still one page), `pdf_compress` if over the limit
(form limit, else 5 MB).

## 7. Autofill ("fill out the application")
The `apply` skill, over the [form tools](mcp-tools.md#forms) and the [Workday adapter](components/workday-adapter.md):
1. `posting_active`; read the profile and answer bank.
2. `get_form` → by `pageKind`: `posting` → `page_action apply`; `auth` → the user signs in and says when
   done; `start-choice` → `page_action apply_manually`; `review` → hand-off; `confirmation` → done.
3. Each step: decide every field (profile facts via hints; screening questions matched to the answer bank
   by meaning, with an explicit polarity check; numbers computed; unknown, sensitive, EEO or salary asked
   in one message per step), `add_repeatable` until rows match, `fill_fields` in one batch with a `source`
   per value, `upload_file` for documents, fix errors, `go_next`.
4. **Hand-off** at the review page: summarize what was filled, what came from the user or Claude's
   judgment, and what couldn't be filled. The user reviews and presses Submit.
5. Every fill, upload and step is appended to `form-log.jsonl`; status moves automatically: `attached` on
   a successful upload, `filled` at the review page, `submitted` when the confirmation page is seen.
   After an interruption, `get_form` shows where things stand and filling continues from there.

## Posting status

`captured` → `drafting` (resume/cover work starts) → `attached` → `filled` → `submitted`; `archived` is set
by hand. Automatic moves only go forward.
