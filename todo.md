# ezapply: todo

Proposals, as of 2026-10-07: only work that isn't built. Whatever is built, in whole or in part, is described in
`references/` (what still needs a live run is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | UX overhaul: onboarding and review pages | Medium–High | XL, in four parts | a change to `philosophy.md` |
| 2 | Application forms on an employer's own page | Medium | M–L | a page saved from a real one |
| 3 | Put off re-indexing a repo for a set time | Low | S | — |
| 4 | Application tracker: progress and outcomes (application manager) | Medium | M | — |
| 5 | Job search across the boards ezapply knows (application manager) | Medium | L | — |
| 6 | Job alerts (application manager) | Medium | M | Job search |
| 7 | Auto mode (application manager) | High if trusted, else Low | XL | Tracker, job search, alerts; a change to `philosophy.md` |
| 8 | Agents that try to break a new adapter (adapter building) | Medium | M–L | — |
| 9 | One directory per adapter (adapter building) | Medium | M–L | — |

Suggested order: the live runs in `references/status.md` ("Not yet verified for real"): a Workday run with debug
mode off whose timings match the earlier runs' (the adapter trace's no-op path), which also presses a row's Delete
and binds a job-board posting's tab; then runs with debug on, the two comparing the browser behind and in front
among them; a Greenhouse application embedded in a careers page; then an Oracle run.

Item 1 goes part by part, each useful alone. Item 9 before the next new site, and before item 2, so neither is
built in the old layout and then moved. Item 2 waits for a saved careers page whose application is its own form,
with no frame. The application manager (items 4 to 7) is built in that order, each on the one before; auto mode
last, and only once the rest has shown the quality holds without the user watching.

---

## 1. UX overhaul: onboarding and review pages (Medium–High, XL in four parts)

**Why.**
- **Review**, on every application: the page stacks up to six iframes of the browser's own PDF viewer under
  plain HTML from a template string. The viewer differs per browser, can't be drawn on, and can't compare
  versions, so a change request is words in a box ("the second bullet under Acme") and each revision round is a
  full re-read of every document.
- **Onboarding**, once but long: eight steps of chat, most of them form-filling the agent only relays (a path,
  a choice of repos, phone and address, 6–8 screening answers per message, preferences). Every turn costs tokens,
  the user's replies are transcribed by the agent, and "reply 'all good' or give the numbers to change" is a form
  in disguise. The agent is needed only where there's judgment: installing TeX, indexing repos, reading the resume
  into a profile, a cover template from an example.

**Philosophy first.** Principle 1 ("almost no UI", everything in chat) and the non-goal on screens of ezapply's
own change to: pages for what is form-filling and reading (onboarding, review), chat for what needs judgment.
Claude Code stays the only agent; the pages never run one.

### Part A: a UI package (`packages/ui/`, `@ezapply/ui`)
- **Stack:** React 19 and TypeScript, bundled by esbuild as the extension is (no dev server), one entry per page
  (`review`, `onboard`) plus a shared chunk, a stylesheet and pdf.js's worker, into `packages/ui/dist/` with hashed
  names. `npm run build` builds it; `ezapply doctor` reports it missing. *Why React:* template strings with an
  inline script fit one form and a Send button; the viewer (pages, highlights, comments) and onboarding (steps,
  forms, live agent progress) are state a component tree handles and string templates don't.
- **Look:** design tokens as CSS custom properties, light and dark by `prefers-color-scheme`, the system font
  stack (no web fonts: nothing leaves the machine, and it works offline), a few components of our own (button,
  field, card, step, toast, progress, file drop). No component library. Keyboard and screen-reader usable: labels,
  focus rings, landmarks.
- **Served by the companion** from `/ui/<file>` (`http.ts`), cached as immutable. The GitHub setup pages
  (`/github/…`) keep their server-rendered flow and take the same stylesheet.
- **API:** each page loads its state from `GET /api/<page>/<id>` and acts through JSON `POST`s; the companion
  pushes changes (a task's progress, a review replaced) over Server-Sent Events (`/api/<page>/<id>/events`), so
  nothing polls.
- **Auth:** the page URL keeps its random token (`?t=`). The first load trades it for an `HttpOnly`,
  `SameSite=Strict` cookie scoped to the page's path, and the page drops it from the address bar
  (`history.replaceState`). Every API call needs the cookie and an `Origin` equal to the companion's own (no
  cross-site request can act); the loopback `Host` check stays. CSP: `default-src 'self'`, `worker-src 'self'`
  (pdf.js), `img-src 'self' blob: data:` (rendered pages), `connect-src 'self'`; no inline script, so no nonce.
- **Tests:** components with Testing Library on jsdom; the companion serving the bundles, the headers, the token
  traded for the cookie, a call without the cookie or from another origin refused.

### Part B: the review page and its PDF viewer
- **The viewer:** pdf.js in the page (`pdfjs-dist`, the version the companion already uses), in place of the
  browser's viewer in an iframe. The same in every browser, and it can be drawn on. Pages render on canvas as they
  scroll into view, with the text layer (select, search with Ctrl+F inside the viewer); fit width by default, fit
  page, zoom; page n of m; arrow keys; Download gives the exact bytes under review.
- **Layout:** the documents in a side list (name, pages, and to review, approved, changes asked, or changed since
  last reviewed), one document at a time in the middle, its panel beside it (its checks, comments, changes since
  the last review, Approve or Ask for changes). One Send for all, as now. On a narrow window the list becomes tabs
  and the panel goes under the page.
- **Checks beside the document,** from what the companion already reads (`pdfInfo`): page count (a resume over one
  page is marked), a text layer present (an applicant-tracking system reads it), fonts embedded.
- **Comments on a passage:** select text in the PDF, Comment, and type the change. Each comment keeps its page and
  the quoted words, stays highlighted, and can be edited or removed before Send. A document's request is the
  general box plus its comments. `review_documents` returns them beside the text (`comments[] { page, quote,
  note }`, optional in the result), so the agent knows the exact line. The skills' call shapes and
  `skill-calls.test.ts` follow.
- **Kept as it is:** the snapshot (bytes read when the review opened, approvals hashing those bytes), one call that
  opens and waits, a newer review replacing an open one, expiry, the tab closing after Send, and "only the page
  approves".
- **Tests:** the companion's e2e test of the review page moved onto the new page (token and cookie, files served
  from the snapshot, answers with comments, waiting, replaced and answered reviews), and the viewer's comment
  anchoring on a test PDF.

### Part C: what changed since the last review
- **Kept per document:** when the user answers a review, each document's text (as `pdf_text` reads it, per page)
  and hash go to `postings/<id>/reviewed.json`, keyed by its path in the posting folder as approvals are
  (`{ schemaVersion: 1, documents: { "<path>": { hash, at, reviewId, pages: string[] } } }`). A renamed file has
  no history.
- **The diff:** words, not lines, on normalised text: hyphenation at line ends joined, ligatures unfolded (NFKC),
  quotes and dashes unified, whitespace and line breaks collapsed. *Why words on collapsed text:* a word changed
  early in a paragraph reflows every line after it, and a line diff would mark all of them. *Why the PDF's text,
  not the `.tex` source:* it's what the user approves, and a bundle or an imported template has no source of
  ours. The normaliser and the diff are one module (`protocol/src/textdiff.ts`, no DOM) used by both sides.
- **On the page:** the new version's inserted words highlighted on its text layer, deletions as markers with the
  removed words on hover, and a list of changes in the panel that jumps to each; a toggle hides them. The first
  review of a document says so and shows none. Text the viewer can't place on the page (a rotated line, an odd
  font's text items) still shows in the list.
- **For the agent:** `pdf_text { path, sinceReviewed: true }` returns the same diff as hunks with page numbers,
  so its report after a revision quotes what changed instead of re-describing it.
- **Approvals stay per version** (the hash): the diff is a reading aid. `tex_diff` stays as the agent's tool;
  latexdiff isn't needed for any of this.
- **Tests:** normalisation (a hyphenated break, a ligature, reflow alone not a change), the word diff, the text
  stored on answering and read back on the next review, `pdf_text { sinceReviewed }`, a first review with no diff.

### Part D: onboarding in a page
- **Starting it:** `EZAPPLY.md` has the agent call `onboarding {}` when `workspace_check` isn't `ready`, or when the
  user asks to set up or change a setup step. It opens `http://127.0.0.1:<port>/onboard?t=…` through the `Opener`
  (or returns the URL when no browser opened, as `review_documents` does) and waits for the page. The page lives
  while the chat does, like the review page, since the agent's tasks need it.
- **The page is the checklist** from `workspace_check`: each item a step with its status, done steps folded with
  a Change link, so it's resumable from whatever state the workspace is in. Optional steps can be skipped.
  1. **TeX:** what's found. Missing: the install command for this OS and Install, which gives the agent an
     `install-tex` task. *Why the agent runs it, not the page:* Claude Code's permission prompt is where the user
     approves a command, and a loopback page that could start installers would widen what a stolen token can do.
     Check again re-reads.
  2. **Extension:** the browsers the `Opener` finds; for the chosen one, the steps and the folder to load with a
     Copy button (a page can't open `chrome://extensions` itself). The page opens the pairing window
     (`extension_pair`'s work) and turns green when the extension connects.
  3. **GitHub:** existing app or new, then the flow the `/github/` pages run today (Client ID and secret typed into
     the page, never the chat), as a step.
  4. **Repos:** every repo `github_list_repos` gives, with language, last push, size and description, a search and
     filters. Preselected by the skill's rules that need no judgment (none of forks without the user's commits,
     archived, under 10 KB, the profile README repo, names like dotfiles or config); the user ticks the rest. Save
     is `repos_selection_set`. A repo that's missing links to `github_status.manageUrl`.
  5. **Knowledge base:** Index gives the agent an `index-repos { repos }` task. Each repo shows waiting,
     indexing, or done with its claim count as the agent's `knowledge_mark_indexed` calls arrive (subagents call
     the same server, so parallel indexing shows too).
  6. **Resume:** the folder or `.tex` file by path, with Browse… opening the OS's own dialog through the
     companion (a folder or file dialog through PowerShell on Windows, `osascript` on macOS, `zenity` or `kdialog`
     on Linux; typing the path where none is there). *Why not the browser's file picker:* it gives the file's
     contents, never its path, and `template_import` must record the path to watch the user's later edits. Then
     import and compile, the PDF shown in the Part B viewer with its page count. A build that fails on the
     environment (a font path) gives the agent a `fix-template-build { kind, log }` task.
  7. **Profile:** the agent drafts `profile.yaml` from the resume source (`draft-profile`), then the page shows it
     as a form built from the profile's schema: identity, contact, links, work, education, skills, languages,
     certifications, work authorization, sponsorship, relocation, work mode, earliest start, and the EEO answers
     with "decline" as a choice and empty meaning ask every time. What `profile_check` lists as missing is marked.
     Save validates with the same schema and writes through the `yaml` library's document API, keeping the
     user's comments and order.
  8. **Cover letter template:** three choices. The default, its name and contact filled from the profile and
     shown in the viewer, with an offer to restyle it like the resume (`restyle-cover`). Their own template, by
     path as in step 6. Or an example letter dropped on the page (PDF or image, into `library/`), which the agent
     rebuilds as a template (`cover-from-example { file }`). The result is approved, or commented on, in the viewer.
  9. **Answer bank:** the unanswered questions from `answers_check`, each with its suggested answer or profile
     value filled in, editable, confirmed a group at a time; sensitive ones left unanswered unless the user fills
     them. Writes `answers.yaml` through the same validated, comment-keeping write.
  10. **Preferences:** the attach mode (`attach_mode_set`), then tone, emphasis, never mention, target roles and
     locations, and cover letters by default, written to `profile/preferences.md` under fixed headings.
  11. **Library:** a drop zone that saves files into `library/` (PDF, Word, images, text, LaTeX; 25 MB each).
- **The agent as worker.** `onboarding {}` blocks until the page has a task for the agent, then returns `{ task: {
  id, kind, params } }`; the agent does it with its tools and skills and calls `onboarding { taskId, result: { ok,
  note? } }`, which reports and waits for the next in the same call. `{ done: true }` once the user finishes or
  closes onboarding. Tasks run one at a time, in the order asked; the page shows the one running and what's
  queued, and the note when it ends. Claude Code moves a call still running after 120 s to the background and
  delivers its result as a notification, as with `review_documents`, so the chat stays usable. *Why not a
  headless `claude -p` started by the companion:* Claude Code stays the only agent, in the user's chat, with the
  workspace's skills and permissions, and the user sees its commands in the terminal.
- **What stays in chat:** keeping the workspace current (`workspace_changes`), and everything after onboarding.
  There's no chat onboarding beside the page, so there's one way to maintain. `ezapply-onboard` shrinks to what
  each task means and the keeping-current part; its conversational steps go.
- **Tests:** a page action becoming a task the blocking call returns, its result reported and shown, tasks queued
  in order, `done`; the profile and answers writes validating, keeping comments and order, refusing what the schema
  refuses; the native dialog's fallback to a typed path; the checklist resuming mid-way; the library drop's size and
  type limits; the skill's call shapes.

**References when built:** a new `components/ui.md` (the package, pages, API, auth, events), `documents.md` (the
review page, viewer, comments, changes since the last review), `flows.md` (onboarding), `mcp-tools.md`
(`onboarding`, `review_documents`' comments, `pdf_text`'s `sinceReviewed`), `data-formats.md` (`reviewed.json`),
`security.md` (the cookie, the origin check, the page writing the profile, answers and `library/`, the native
dialog, no commands from the page), `workspace.md` (the skill), `philosophy.md`, `architecture.md`,
`development.md` (build, tests), `README.md`, `status.md`.

**Challenges and open questions.**
- Writing YAML from a form: fields the schema doesn't model must survive a save untouched.
- How much of an agent task the page can show depends on the tool calls the companion sees. A task with no calls
  to report (drafting the profile) shows only as running.
- Native dialogs: Windows' needs PowerShell in single-threaded mode, and a Linux desktop may have neither
  `zenity` nor `kdialog`.
- Whether workspace changes should later move into a page too. Not now: they come up mid-chat, tied to the request
  in hand.

## 2. Application forms on an employer's own page (Medium, M–L)

**Why.** Some careers pages show the application straight in their own page, with no frame. Nothing finds it:
the extension tells a page's site by its body (`references/components/extension.md`, "Telling a page's site"),
and every signature is a provider's own markup.

**What such a page is.** Submitting through Greenhouse's Job Board API, Lever's postings API or Ashby's
`applicationForm.submit` takes the employer's secret API key, so a careers page can't send an application to the
provider from the browser. A frameless application is the employer's own form, posted to its own server, which
forwards it. It has none of the provider's markup, so no per-provider signature (the earlier idea: a `form`
posting to `greenhouse.io`) finds it, and the provider's definition couldn't read it anyway. What fits is one
definition for plain HTML forms, used only when asked for. An embedded application differs: its frame is the
provider's own page, so the provider's signature and definition work there unchanged.

**Part 1: a `generic` definition** (`extension/src/adapters/sites/generic/`, or `generic/` in the sites package
once "One directory per adapter" is built), on the engine, shared drivers only.
- **The form.** Each `<form>`, or for a page without one (a React app), the smallest element holding an email
  input and a submit control. It counts as an application when it has an email input and either a file input or
  at least four labelled fields. A form with a password input never counts (sign-in and account forms stay the
  user's). Among several, the one with the most fields. None → `pageKind: unknown`, no fields.
- **Fields**, in page order, inside the form only:
  - text, email, tel and url inputs and textareas: `textDriver`; number inputs `textDriver("number")`; date
    inputs `dateInputDriver`; native selects: `selectDriver`;
  - radios and checkboxes grouped by `name` (container: their `fieldset`, else their closest common ancestor):
    `radioDriver`, `checkboxGroupDriver`, a lone one `checkboxDriver`;
  - file inputs, visible or hidden behind a label or button: `fileDriver`, names from the input's `files`;
  - `role=combobox` with its listbox (`aria-controls`): `comboboxDriver`;
  - never hidden, password, search, submit or button inputs. A control it can't place (no prompt, a custom
    widget) is left out and counted in a message, so the agent tells the user to fill it.
- **Prompts:** `promptOf` (label `for`, wrapping label, `aria-labelledby`, `aria-label`), else the placeholder;
  a group's from its legend. **Required:** `required`, `aria-required`, or a trailing `*`. **Errors:**
  `ariaError`, else `[role=alert]` inside the form.
- **Ids:** the control's `name`, slugged (`first_name`, `urls[LinkedIn]` → `urls-linkedin`), else its `id`, else
  the prompt's slug. **Section:** the nearest heading or legend before the field within the form, else
  "Application".
- **Hints** from the HTML `autocomplete` tokens first, since they're a standard and many forms set them:
  `given-name`, `additional-name`, `family-name`, `name` (full name), `email`, `tel`/`tel-national`,
  `tel-country-code`, `address-level2` (city), `address-level1` (region), `postal-code`, `country`/`country-name`.
  Then by `name` and by prompt, as the boards do: first and last name, email, phone, LinkedIn, GitHub, website or
  portfolio. Nothing else is guessed; the planner and the agent handle the rest by prompt.
- **One page, Submit at the end**, like the boards: `singlePageKind`, `singlePageMessages`, `lastPage: true`,
  `next` refuses. **Job title** (`titledJob`): the first visible `h1`, else `document.title`.
- **Submit, broadly:** `isSubmit` is `isSubmitByText`, plus any button reading "Apply" inside the form, plus the
  form element itself, so the guard also blocks a synthetic `submit` event. A false positive only blocks a
  press; it never submits.
- **Waits:** the standard ones.

**Part 2: used only when asked, never by detection.** Almost any page has a form, so `generic` has no signature
and no URL rule. It isn't in `SITES`, and `browser.status` never lists a tab as one.
- **Protocol:** a `GENERIC: SiteInfo` beside the registry (`protocol/src/sites.ts`): tenant the page's host; job
  any registry site's `hostPageJob(url)` (a careers page with `?gh_jid=` still names its Greenhouse job).
  `adapterOf` (`background/forms.ts`) and `build.mjs` know it, so it gets its own `generic-main.js`. `SiteId` already has `generic`.
- **Extension** (`background/forms.ts`): a form call with an explicit `tabId` on a page that's no registry
  site's, where no frame is one either (a framed board always wins), injects the generic adapter instead of
  failing with "not an application page". It still fails, with today's message, when the page has no form that
  counts. Without a `tabId`, `resolveTab` still picks registry sites only.
- **Companion** (`forms/service.ts`): the agent's `tabId` already reaches the extension when the tab has no form
  site (`target()` falls back to `own`). `decide` returns early for a tab that isn't a form site, so nothing would
  be logged or credited: let it go on when the extension's answer says `adapter: "generic"`. Matching then works
  on the binding or the page's title (the URL says nothing); `posting_activate { id, tabId }` binds such a tab
  like any other.
- **Skill** (`ezapply-apply`): when the application is on the employer's own page (Apply opens no known site),
  call `get_form` with that tab's `tabId`. Say to the user that this form isn't from a known site, and check every
  field on the page after filling, since the generic reader may have missed custom widgets.

**Part 3 (only if a saved page shows it): a provider's markup served on the employer's host**, through a proxy or
a copied render. The signature finds it already, but the tenant and job are read from a URL that isn't the
provider's. `tabSite` (`forms/match.ts`) and the engine's `extract` would then fall back to the page's
`hostPageJob`, and to the board and job ids in the page where it carries them.

**Tests.**
- Generic, on synthetic forms: an application form read with its prompts, ids, groups and hints; a newsletter,
  search or sign-in form not counted; a page with two forms picks the application; a custom widget counted and
  reported; Submit blocked when pressed synthetically, including a `submit` event on the form. It also passes
  the conformance test every definition does (`sites.test.ts`), with a saved page from a real one when there is
  one.
- Extension: a page with no site and no frame, asked by `tabId`, gets the generic adapter; without `tabId`, or
  with a framed board, it doesn't.
- Companion: a generic answer is logged and credited by binding or title; nothing changes for registry
  sites.

**References when built:** `components/sites.md` (a Generic section), `components/adapters.md` (replace "No
generic definition"), `components/extension.md` (replace "Not covered"), `protocol.md` (`GENERIC`),
`mcp-tools.md` (which tab), `security.md` (the submit guard on arbitrary pages; password forms excluded),
`status.md`.

**Challenges and open questions.**
- Custom widgets are the employer's own (a home-made dropdown, a date picker). The generic reader finds only what
  standard markup says; the rest is the user's. How much to try, beyond `role=combobox`, needs real pages.
- The forms' quality varies: unlabelled inputs, prompts in neighbouring `div`s. A prompt from the nearest
  preceding text is tempting but often wrong; start strict.
- A form that forwards to Workday or Oracle may still send the user to that site for a later step: it's then a
  registry site from that point on.

## 3. Put off re-indexing a repo for a set time (Low, S)

**Why.** When the user answers "later" to re-indexing a repo with new commits, `workspace_change_mark { as:
"later" }` hides it only until the chat ends (`FreshnessService.later`, in memory, by change id). Every new
`ezapply chat` asks again, which for someone opening several chats a day is the same question each time, and a
repo pushed to daily is asked about daily.

**How.**
- **A timer per repo,** in `state.json`: `deferred: { repos: { "<owner>/<name>": { until, at } } }`. Optional, so
  no `schemaVersion` bump.
- **Setting it:** `workspace_change_mark { ids, as: "later", hours? }` (`ids` replaces `id`, so one call puts off
  several). On a `repo-pushed` change, `later` starts that repo's timer: 24 hours by default, longer when the user
  says ("for a week" → 168), at most 90 days so no repo is silenced for good (deselecting it is how to stop for
  good). **All:** the agent passes every current `repo-pushed` id; **some:** the ones the user names.
- **While a timer runs** the repo isn't checked at all (no `ls-remote`), so pushes made meanwhile don't ask, unlike
  the change id's state today. **When it has run out,** the next chat's check reports the repo if its head differs
  from `indexedSha`, pushes made while it was put off included. A repo with no running timer that gets new commits
  is asked about at the next chat's start, as now.
- **Ending a timer early:** re-indexing (`knowledge_mark_indexed`) and deselecting the repo drop it. Expired
  timers are dropped on any write to `state.json`.
- **Seen by the agent:** `workspace_changes` lists running timers as `deferred[] { repo, until }`, so it can answer
  "what did I put off?" and offer to re-index one early.
- **Other kinds keep `later` for the chat,** and `hours` on them is refused with a hint: a template or profile
  behind its source feeds the next document, so asking each chat is right for them.
- **Skill** (`ezapply-onboard`, keeping current): ask now, after this posting, or put off, for a day unless the
  user says longer; all repos or the ones named.
- **Tests:** a timer set and the repo not checked in a new service (no `ls-remote`); the default and a given
  length, the cap; an expired timer checked and reporting pushes made meanwhile; a repo without a timer reported
  at once; all and some through `ids`; `hours` on another kind refused; re-indexing and deselecting dropping the
  timer; `deferred` listed; the skill's call shape.

**References when built:** `components/companion.md` ("Keeping the workspace current"), `mcp-tools.md`,
`data-formats.md` (`state.json`), `flows.md`, `development.md` (the freshness test's row), `status.md`.

---

## Application manager

One place for the user's job search: the postings they might apply to, where each application stands, and what
to do next. ezapply already keeps each application's record (the posting folder: `meta.json`, `form-log.jsonl`),
so the manager reads and extends those; it adds no database.

### 4. Application tracker: progress and outcomes (Medium, M)

**What.** "What's in flight?": each posting's progress (drafted, filled, submitted), deadline, date submitted, what
happened after (applied, interviewing, rejected, offer, withdrawn), and the next action. Postings drafted but not
applied to show up as such.

**How.**
- **Outcomes**, beside `status` rather than in it: `status` is ezapply's own progress, moved forward by the form
  tools; an outcome is what the employer did, told by the user. `meta.json` gains an optional `outcome { state,
  at, note? }` with a short `outcomes[]` history (`interviewing`, `rejected`, `offer`, `withdrawn`, `no-response`),
  set through `posting_update_meta` when the user says "Acme turned me down" (the agent finds the posting with
  `postings_list { company }`). Optional, so no `schemaVersion` bump.
- **The list:** `postings_list` gains `deadline`, `submittedAt` (from the log's confirmation step), `outcome`, and
  filters (not yet submitted, awaiting a reply, by outcome), sorted by deadline, then by date submitted.
- **Views:** an `ezapply-status` skill formats it in chat and suggests the next action per posting (tailor, review,
  fill, submit, follow up after N weeks with no reply). `ezapply status --postings` prints the same table without
  starting Claude, at no token cost. A read-only page on the companion's loopback server, beside the review page,
  could show it as a board by stage; it lives only while a chat is open.

**Challenges and open questions.**
- `deadline` is set only when the agent finds one in the posting, so many will be empty.
- Outcomes are set by hand; replies arrive by email, which ezapply doesn't read. The user can paste a reply into
  chat for the agent to record.
- Is a page worth it over the CLI table and the skill? With the UI package of the UX overhaul built, a page costs
  less than it does now.

### 5. Job search across the boards ezapply knows (Medium, L)

**What.** Find new postings that fit the user, from the employers they care about, without visiting each careers
page: a list to pick from, each captured as a posting with one word.

**How.**
- **Sources are the boards' public job lists**, per registry site: Greenhouse's Job Board API, Lever's postings
  API, Ashby's public job board API, Workday's careers-site JSON, Oracle's requisitions REST. Each registry entry
  gains an optional `listJobs(tenant)` in a companion module (`search/`), so a new site covers itself. No scraping of
  LinkedIn, Indeed or other aggregators: their terms forbid it and they block headless clients; the live-check
  rule against bot-protection workarounds holds here too.
- **Which employers:** a watch list in the profile (`profile/watchlist.yaml`: company, site, tenant), seeded from
  the tenants of past postings and grown by the user ("watch Acme's Greenhouse board").
- **Matching** in two passes: a deterministic filter from `jobPreferences` (locations, work mode) and keywords the
  user sets (titles, seniority, exclusions), then the agent ranks what's left against the profile and says why.
- **Dedupe** by canonical URL against `search/seen.jsonl` and existing postings, so a job is shown once.
- **Tools:** `jobs_search { companies?, query? }` returns new matches; `posting_capture_url { url }` captures a
  chosen one without the browser, from the board's JSON (its description is the posting text), so
  the posting folder is the same as a capture's.

**Challenges and open questions.**
- Discovery: the boards have no search across employers, so the watch list is as good as the user makes it.
- Workday's and Oracle's JSON endpoints are the careers sites' own, not published APIs; they can change without
  notice. Rate-limit and cache politely.
- A posting captured from JSON has no visible-HTML step; its description is still untrusted, so the
  prompt-injection rules apply unchanged.

### 6. Job alerts (Medium, M)

**What.** Tell the user when a new posting matching their search appears, without a chat open. Deadline reminders
from the tracker ride along.

**How.** The companion runs only inside `ezapply chat`, and Claude Code's scheduled tasks only while a session is
open, so alerts need the OS scheduler. `ezapply alerts on` registers a job (Task Scheduler, launchd, a systemd timer
or cron) that runs `ezapply search --new`: the deterministic pass of the job search only, no Claude, no tokens. New
matches go to `search/new.jsonl` and an OS notification ("3 new postings at Acme, Globex"); deadlines within two
days get one too. The next `ezapply chat` lists them first, as it does workspace changes, for the agent to rank.
`ezapply alerts off` removes the job.

**Challenges and open questions.**
- Registering a scheduled job differs per OS and may need the user's approval; `ezapply doctor` should report it.
- How often: daily is enough for most boards; more risks rate limits.
- Email or phone alerts need a sender or a service, which ezapply avoids: start with OS notifications.

### 7. Auto mode (High if trusted, else Low; XL)

**What.** The agent searches regularly, drafts the documents for strong matches, fills each application, and leaves
it at the review step, so that applying is the user checking it and pressing Submit.

**How.**
- **The agent:** the alerts job, on new matches above a score, starts Claude Code headless (`claude -p`) in the
  workspace with an `ezapply-auto` skill. Claude Code stays the only agent; ezapply gains a trigger, not a loop.
- **Per match:** capture, tailor the resume and cover letter with the existing skills, compile and check. Anything
  the agent would ask about (a sensitive or unanswered question, a gap in the evidence, a document it isn't sure
  of) goes into a queue rather than being guessed.
- **Filling:** a browser the companion starts for this (its own profile, with the extension loaded and the user's
  sessions on the sites), filling through the same tools and adapters up to the review step, never past it. A tab in
  a truly headless browser can't be handed to the user, so it runs as a window kept in the background.
- **The queue** (the tracker's page or the `ezapply-status` skill): each application ready to submit, with its
  documents to approve on the review page, its questions to answer, and the tab to open. Submit stays the user's
  press; the guard is unchanged.
- **Limits:** a daily cap, a minimum match score, and nothing for an employer already applied to.

**Challenges and open questions.**
- It goes against the philosophy as written: "the user decides" becomes "the user checks", and "applying in bulk"
  is a non-goal. Adopt it only by changing `philosophy.md` first, and keep the honesty rules (no fabrication, ask
  rather than guess) as hard as they are now.
- Sessions: Workday wants an account per employer and Oracle an email code each time, and signing in and signing up
  stay the user's, so most applications stop at sign-in until the user signs in.
- Documents drafted without the user's chat lose the corrections they'd give along the way. The review page and
  its view of what changed since the last review (the UX overhaul) carry the weight.
- Tokens: each application is a full tailoring and filling run. The cap bounds the cost.

---

## Improvements to the adapter-building workflow

### 8. Agents that try to break a new adapter (Medium, M–L)

**Why.** One agent writing an adapter and judging it too sees what it meant to build, not what it built. The
process in `references/building-adapters.md` goes from tests the builder wrote straight to a live run with the
user's account; nothing in between tries to break the adapter.

**How.** A skill in this repo (`.claude/skills/break-adapter/`, for Claude working on ezapply, not the
workspace), run once a site's definition and tests exist (after "Tests" in the process, before "Check it live").
It links to `building-adapters.md` rather than copying it, and splits the work across subagents with separate
contexts, in a loop:
- **Runner:** gets only the built bundle, the saved pages and the live-check script, never the builder's reasoning.
  It runs the whole flow against the saved pages served locally (every field read, filled with fake values and read
  back, rows added and removed, Next and Back, Submit pressed synthetically to prove the guard), then against the
  variants below. It reports each failure with the page, the variant, the call, its arguments, what came back and
  what should have, and the debug trace.
- **Improver:** fixes what the report names, adding a failing test for each failure first, and hands back to the
  runner.
- **Stops** when the conformance and extraction tests pass and a runner round finds nothing new, or after a set
  number of rounds, leaving what's still failing for the user. On a public page the runner may then do the same
  live, under the live-check rules; a page behind an account waits for the user's first run with debug mode on.

**The live-check script, in the repo** (`scripts/live-check/`): the script used for Greenhouse, Lever and Ashby
(`references/components/adapters.md`, "Checking a site live"), with this machine's paths made options: the
browser (Chrome or Edge, found as the companion's `Opener` finds them), headless or not, the page (a URL, or a
saved page served by a loopback static server), and the site. It injects `<site>-main.js` into the page's main
world over the DevTools protocol as the extension does, runs a list of adapter calls from a JSON file, and writes
each result, with debug mode's trace when asked. Its rules don't change: never submits, obviously fake values, no
upload to a third party, no bot-protection workarounds.

**Variants,** each a named transform of a saved page (`scripts/live-check/variants/`), so a failure reproduces and
every site reuses them: fields rendered late (inserted by a script after a delay), sections reordered, prompts
relabelled (a synonym, a trailing `*`, extra whitespace), a list replaced by one that loads as you type, rows added
or removed by the page, errors appearing on blur, a second form on the page, duplicate ids.

**Tests:** the call runner and the variants on one existing site's saved page, so the tool isn't what's flaky.

**References when built:** `building-adapters.md` (a step between "Tests" and "Check it live"),
`components/adapters.md` ("Checking a site live": the script is in the repo), `development.md` (scripts, the
skill).

**Challenges and open questions.**
- Real markup of application steps needs an account and an application in progress. The user has to drive that;
  debug mode's markup and `ezapply debug export` make one run enough.
- The variants are guesses about how the site behaves; an adapter hardened against them can still miss what the
  real site does. They test robustness, not fidelity: the saved pages and a live run stay the evidence.
- A loop of agents costs many tokens per site; worth it for sites with many applications behind them.

### 9. One directory per adapter (Medium, M–L)

**Why.** A site is spread over three packages. Its URL rules (`protocol/src/<site>.ts`), registry entry and id
(`protocol/src/sites.ts`, `SiteId` in `postings.ts`, the export in `index.ts`, a `PROTOCOL_VERSION` bump), its
definition (`extension/src/adapters/sites/<site>/`, listed in `sites/index.ts`), its notes
(`companion/src/forms/sites/`, listed in `index.ts`), its posting reader (`companion/src/postings/readers/`), and
its tests and saved pages (`PAGES` and `SAVED` in `extension/test/sites.test.ts`, `sites-live.test.ts`,
`protocol/test/sites.test.ts`, `extension/test/fixtures/live/`). And some of its knowledge sits in shared code:
`JOB_ID_PARAMS` in `postings/service.ts` (Phenom's `jobseqno`, SuccessFactors' `career_job_req_id` and `company`),
`companyFromUrl` and `ATS_HOSTS` in `postings/extract.ts` (Oracle's and SuccessFactors' data-centre hosts, the
boards' hosts). Reviewing a site means opening all of these, and the types catch only some of a missing piece:
nothing notices a site's job parameter left out of `JOB_ID_PARAMS`.

**Layout.** A package of its own, everything about a site in its directory:
```
packages/sites/               @ezapply/sites
  src/<site>/
    registry.ts               SiteInfo: id, name, signature, URL rules, tenant, job, canonical path,
                              hostPageJob, waits, and what shared code knows now: jobParams (query
                              parameters naming its job), providerHosts (hosts that name the provider,
                              not the employer)
    definition/               site.ts, main.ts, and its own widgets.ts, page.ts, fill.ts, selectors.ts
    notes.ts                  its notes for the agent
    reader.ts                 its posting reader, when it has one
    test/                     its URL rules, extraction from its saved pages, its behavioural tests
                              (Workday's, Oracle's) and golden schemas
    fixtures/                 its saved, scrubbed pages
  src/registry.ts             SITES, in detection order
  src/definitions.ts          SITE_DEFINITIONS (the extension's side)
  src/notes.ts, readers.ts    SITE_NOTES, POSTING_READERS (the companion's side)
  src/conformance.test.ts     every site: today's conformance and signature tests
packages/engine/              @ezapply/engine: today's extension/src/adapters/engine/ and widgets/
```
- **The lists stay per side,** so the extension's bundles never pull in notes or readers and the companion never
  pulls in the drivers. A test fails when a directory is missing from any list, or a list names one that's gone.
- **Dependencies:** `protocol` ← `engine` ← `sites` ← `extension`, `companion`. The engine leaves the extension
  because the definitions import it and the extension imports the definitions. Protocol keeps the types
  (`SiteInfo`, `Timing`, `STANDARD_WAITS`) and stops knowing the sites: `SITES`, `FormSiteId` (now derived from
  `SITES`), `detectSite` and `isFormSite` move to `@ezapply/sites`, and the wire schemas take a site as a string
  each peer checks against `SITES` (`generic` stays protocol's).
- **No `PROTOCOL_VERSION` bump per site:** `hello` carries the extension's site ids, and the companion reports a
  mismatch as an extension built from another version, with the rebuild hint a version mismatch gets. Today the
  bump is how an older peer rejects a new id; the list says which site is missing.
- **Shared code loses site knowledge:** `JOB_ID_PARAMS` becomes the generic parameters plus every site's
  `jobParams`, and `companyFromUrl` and `ATS_HOSTS` ask the sites' `providerHosts` and hosts. A test scans the
  other packages' sources, comments stripped with TypeScript's scanner, for any site id, so knowledge can't creep
  back.
- **The build:** `extension/build.mjs` builds `sites/src/<site>/definition/main.ts` for each of `SITES`; vitest
  picks up `packages/sites/**/test/`.
- **References stay in `references/`:** a site's reference page doesn't move into its directory. The
  directory gets no README of its own, so there's one place to keep current.

**Doing the move.** In three steps, each with every test passing:
1. A pure move: files and imports only. Golden schemas unchanged, and the built bundles compared with the
   previous build's (paths in comments and the version hash aside) to show the code is the same. So no live run is
   spent on it.
2. The site knowledge in shared code moves into registry entries, with tests that canonical URLs and companies
   from captures come out as before.
3. The site list in `hello` replaces the per-site protocol bump.

**References when built:** `building-adapters.md` (the table "What, where" and the process become the one
directory and its files; the checklist), `components/adapters.md`, `protocol.md`, `extension.md`, `companion.md`,
`postings.md`, `architecture.md`, `development.md` (packages, tests), `README.md`.

**Challenge.** Workday's and Oracle's fixtures and helpers (`test/adapters.ts`) are shared with the companion's
e2e tests. They move with the sites, and the e2e tests import them from there.
