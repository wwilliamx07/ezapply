# MCP tools

The `ezapply` MCP server's full surface, as registered in `companion/src/mcp/tools/`. Every tool validates
its input with zod, returns compact JSON text (images for `pdf_render` and `screenshot`), and on failure
returns `isError: true` with `{ error: { code, message, hint? } }`. Paths may be absolute or relative to the
workspace root and must fall under the folders listed for that tool (`path_not_allowed` otherwise).
Read-only tools carry the MCP `readOnlyHint`.

Results and descriptions are kept short because they cost context: results are serialized without
indentation (indentation added a fifth to a third to large results), `get_form` leaves out default values,
and descriptions say what Claude needs and no more (all of them sit in context for the whole session).

**Naming.** The names grew up in two styles: most groups are `<noun>_<verb>` (`posting_activate`,
`template_import`, `repo_sync`), the form tools read as commands (`fill_fields`, `go_next`). New tools follow
their group's style, `<noun>_<verb>` everywhere except the form group. The odd ones out (`posting_active`
vs `postings_list`, `repos_selection_get` vs `github_list_repos`, `claims_check` vs `knowledge_mark_indexed`)
stay as they are: renaming would break every workspace's skills and habits for no gain. If a major version
ever happens, rename with the old names kept as aliases for a while. The skills spell out parameter names
too ([call shapes](components/workspace.md#call-shapes)), so renaming a parameter means updating them;
`cli/test/skill-calls.test.ts` fails until then.

## Setup and status

| Tool | Input | Does |
|---|---|---|
| `workspace_check` | — | The onboarding checklist `{ ready, nextStep?, items[] }` ([details](components/companion.md#readiness-checklist-workspace_check)) |
| `workspace_changes` | `refresh?` | What in the workspace is behind its source: `{ changes[] { id, kind, summary, detail, diff?, affects[] }, notChecked?[] { what, reason, hint? }, pending? }`, `{ changes: [] }` when all is current. Kinds: `repo-pushed`, `repo-deselected`, `template-source`, `resume-edited` (with the template's `diff`), `profile-identity`. The repos are checked once per chat in the background; this waits up to 15 s for that check, then answers with `pending: true`. `refresh` checks the repos again. `EZAPPLY.md` has Claude call it at the start of every session ([details](components/companion.md#keeping-the-workspace-current-workspace_changes)) |
| `workspace_change_mark` | `id`, `as` (`done` \| `later`) | `later` hides the change until the chat ends. `done` records the derived part as current: a template's source hash, the resume template the profile now matches, the profile the cover fields now match; for `repo-deselected` it deletes the repo's knowledge folder and cache (`removed`). Refused for `repo-pushed` (re-indexing ends it) and for an id that isn't current (`not_found`) |
| `extension_pair` | `replace?` | Opens pairing for 15 min and returns, per browser, the page, steps and path to load (plus a hint if not built). Already connected → `{ connected: true }`. `replace` first forgets the paired extension and rotates the code. Firefox's steps mention Grant site access, and that Oracle career sites and Greenhouse, Lever and Ashby boards are granted one site at a time by Set posting |
| `extension_pair_wait` | `timeoutSeconds` (5–900, default 180) | Waits for the extension to connect; `{ connected, extension? , hint? }` |
| `browser_status` | — | Companion version, bridge status (with `browser { name, version? }`: the browser the extension runs in, where ezapply opens pages and PDFs; kept after a disconnect), active posting id, and when connected the extension version and every tab with its site (a registry site: `workday`, `oracle`, `greenhouse`, `lever`, `ashby`; else `generic`); when not, a hint |

## Postings

| Tool | Input | Does |
|---|---|---|
| `posting_active` | — | Also `documents { attachMode, approved[] { file, approvedAt, current }, openReview? }` ([review](components/documents.md#review-before-attaching)). Within 40 s of `ezapply chat` starting, first waits for the paired extension to reconnect, and for any capture it queued ([details](components/companion.md#extension-bridge-extensionbridge)). The active posting's metadata, folder, paths of `posting.md`, `visible.txt`, `raw.html`, its files, `active`. When the paired extension hasn't connected since the start (the wait ran out), adds `extensionReconnecting` (a note: a capture made while ezapply wasn't running may still arrive). None → `no_active_posting` (with the same note in the hint, if it applies) |
| `postings_list` | `status?`, `company?` (substring over company and tenant), `limit?` (default 25, max 200) | Postings newest first with id, company, role, status, site, url, updatedAt, active. Settles like `posting_active`; with the extension still reconnecting the result is `{ postings, extensionReconnecting }` |
| `posting_activate` | `id` (a plain folder name; anything with separators or `..` is `bad_request`), `tabId?` | Make it active; returns its details. With `tabId` (only when the user says that tab is this posting's application, usually from a `postingMismatch` hint), also binds that tab to it and stores the tab's site, tenant and job as the posting's `application` (`from: "user"`); the result adds `boundTab { tabId, url }`. A tab that isn't on a form site is `bad_request` ([which posting](#forms)) |
| `posting_update_meta` | `id?` (default active), `company?`, `role?`, `reqId?`, `location?`, `deadline?`, `bundleRequired?`, `status?` | Correct or add metadata; move status. `reqId` is trimmed, and one of more than three words is refused as a title (`bad_request`, hint: put it in `role`), since it would be compared with application URLs' job ids. Setting it lets the posting's capture be searched again for its application |

## Documents
TeX source under `postings/` or `templates/`; PDFs read from `postings/`, `templates/`, `library/`; output
under `postings/` or `library/`. Details: [documents.md](components/documents.md).

| Tool | Input | Does |
|---|---|---|
| `tex_compile` | `path`, `maxPages?` | Compile next to the file (no shell escape) with the engine named by the file's `% !TEX program` comment, else `tex.engine` ([documents](components/documents.md#tex-engines-texenginests)). `{ ok, engine, engineFrom, pdf, pages, pageLimit?, pageLimitExceeded?, overflow?, diagnostics[], logPath, durationMs, snapshot, hint? }`. `*resume*`/`*cv*` files are checked against the page limit; over it, `overflow { lines, text }` is the text past the limit (first 400 characters) and its line count, so cuts can be sized in one edit. Snapshots to `.history/` |
| `tex_diff` | `oldPath`, `newPath` | latexdiff → compiled change-highlighted PDF (needs latexdiff) |
| `pdf_render` | `path`, `page` (default 1), `scale` (0.5–3, default 1.5) | The page as an image; a copy saved to `.previews/` |
| `pdf_text` | `path`, `pages?` (`"1-2,4"`) | Text per page in reading order |
| `pdf_info` | `path` | Pages, bytes, page sizes, encrypted, text layer, title, author |
| `pdf_merge` | `inputs[] { path, pages?, label? }`, `output`, `bookmarks` (true), `normalize` (`auto`/`none`/`letter`/`a4`), `title?`, `author?` | One PDF with bookmarks and consistent page sizes; returns sections with page ranges |
| `pdf_from_images` | `images[]`, `output`, `pageSize` (`letter`/`a4`) | Images → PDF, one per page |
| `pdf_compress` | `path`, `output?` (default overwrite), `targetBytes?` (default config, 5 MB) | Lossless, then Ghostscript if installed; before/after, method, target met |
| `review_documents` | `files[]` (1–6 PDFs under one `postings/<id>/`) or `reviewId`; `timeoutSeconds` (5–900, default 600) | With `files`: opens a review page in the user's browser showing those PDFs, each with a box for changes, and waits for the answer: `{ reviewId, url, postingId, files, openedIn, done: true, approved[], changes[] { file, request } }` (`openedIn`: the browser it opened in, or `default`), or on timeout `{ …, done: false, url, hint }`. When no browser opened it returns at once with `openedBrowser: false`, `tell` (the URL to give the user) and a hint to wait with `reviewId`. With `reviewId`: waits again for that review (`{ reviewId, done, … }`; a replaced one gives `supersededBy`). A newer review of the same posting replaces an open one. *Why one tool:* with a separate wait call the agent opened three reviews without waiting, and the user's answers sat unread ([details](components/documents.md#review-before-attaching)) |
| `attach_mode_set` | `mode` (`after-approval` / `immediately`) | Saves `documents.attach` in `ezapply.config.json`, keeping everything else as written |
| `open_file` | `path` (under `postings/`, `templates/`, `library/`) | Opens a PDF or image in the user's browser (the extension's), anything else in its default app, without waiting. `{ opened, openedIn }` (a browser name, or `default`) |

## Profile and templates
Details: [profile-and-templates.md](components/profile-and-templates.md).

| Tool | Input | Does |
|---|---|---|
| `profile_check` | — | Validate `profile.yaml`: errors with paths, or commonly-needed fields still missing |
| `answers_check` | — | Validate `answers.yaml`; counts; unanswered entries with suggestions and sources; sensitive ids; `notProfileSources { ids, hint }` when an entry's `source` isn't a profile path (agents have written `source: user`) |
| `template_import` | `sourceDir` (absolute, outside the workspace), `kind` (`resume`/`cover`), `main?`, `replace?` | Copy a LaTeX project into `templates/<kind>/`; replaces the default cover without asking, anything else needs `replace`; the old one goes to `templates/.old/`. Adds `% !TEX program = pdflatex` to a pdfTeX-only main file and reports it in `texProgram`. `contentFiles` lists the `.tex` files the main file `\input`s (tailored copies need them) |
| `template_import_example` | `sourcePath` (absolute) | Copy a sample cover letter (PDF, PNG/JPG/WebP, TXT, MD; ≤20 MB) into `templates/cover/example/`; Word → hint to export PDF |
| `template_set_main` | `kind`, `main` (relative to `templates/<kind>/`, must stay inside it and end in `.tex`) | Record the main file and its `contentFiles`; marks a non-imported template `custom`. Returns `{ kind, main, contentFiles }` |

## GitHub and knowledge base
Details: [github-and-repos.md](components/github-and-repos.md), [knowledge-base.md](components/knowledge-base.md).

| Tool | Input | Does |
|---|---|---|
| `github_status` | — | App registered, slug, `manageUrl`, logged in, login, name, token expiry, and `portMismatch { appUrl, localUrl, hint }` when the app's callback URLs point at another port than ezapply's |
| `github_login` | `app?` (`new` / `existing`) | Opens ezapply's login page in the browser; returns the URL, `openedBrowser`, `openedIn` (when it opened), `firstTimeSetup`, and a `tell` text (when no browser opened, it gives the user the URL to open). Without `app`: the app registered here, or a new one. `new` creates an app from the manifest; `existing` connects an ezapply app the user already has, with the Client ID and a new client secret entered on the local page, never in chat, and returns the `callbackUrl` the app must list ([details](components/github-and-repos.md#reusing-an-existing-app)). Without `app`, refuses with the fix while `portMismatch` stands |
| `github_login_wait` | `timeoutSeconds` (5–900, default 300) | Waits for the browser flow; times out with a hint |
| `github_logout` | — | Revoke and delete the token |
| `github_list_repos` | — | Every repo the app can read, newest push first, with `selected` |
| `repos_selection_get` | — | Selected repos with cache and index state |
| `repos_selection_set` | `repos[] { fullName, source (app/public-url), note? }` | Replace `profile/repos.yaml` |
| `repo_sync` | `repo` (must be selected) | Clone or update the read-only cache; `{ path, headSha, indexedSha, changedSince, fileCount }` |
| `repo_contributions` | `repo` | The user's share of commits, dates, areas touched, top authors |
| `claims_list` | — | Every claim of every indexed repo as compact text: `## owner/name`, then `- id: claim (impact: …)`, the impact only when set; evidence, skills and confidence left out. A repo whose `claims.yaml` doesn't parse gets one line pointing at `claims_check`. `EZAPPLY.md` has Claude call it once, at the first request about a posting ([why](components/workspace.md#the-agent-file-ezapplymd)) |
| `claims_check` | `repo` | Validate `claims.yaml`, every evidence path and line range, and that stamped lines haven't changed. `{ valid, claims, errors[], unstamped }` |
| `knowledge_mark_indexed` | `repo` | Requires a clean `claims_check`; stamps a hash on evidence that has none, records the indexed commit. Returns the meta plus `stamped` |

## Forms
Every site in the registry: Workday, Oracle Recruiting Cloud, Greenhouse, Lever and Ashby. Each call is an RPC
to the extension, which runs the tab's site adapter, one engine with a definition per site
([adapters](components/adapters.md); [Workday](components/workday-adapter.md),
[Oracle](components/oracle-adapter.md), [Greenhouse, Lever, Ashby](components/sites.md)); the logic around it lives
in `FormsService` (`companion/src/forms/service.ts`). Every adapter answers every method the same way; where a
site differs (Oracle's inline forms, one-page applications), the tool descriptions say so.

- **One call per tab at a time:** Claude Code sends tool calls in parallel, and two acting on one page
  interfere (two dropdown reads each open a listbox and both can read whichever is on screen; a fill can land
  while `go_next` changes the step). After the tab is chosen, each form call waits for earlier ones on the
  same tab and runs in order (`onTab`, a `KeyedQueue` per tab id); calls on other tabs aren't held up, and a
  failed call doesn't stop the next.

- **Which tab:** `tabId` if given; otherwise an application tab (of any registry site) on the active posting's
  tenant whose job is the posting's (see below), then any on its tenant (the one the user is looking at, else
  the most recently used), otherwise any application tab the same way. The tenant is `siteTenant`: the Workday tenant, the Oracle career site (`host/site`), the Greenhouse board, the Lever company or the Ashby organization. The companion picks
  it from `browser.status` and always passes it explicitly.
- **Which posting** (`forms/match.ts`): fills, removals, uploads, steps and the confirmation page are appended
  to the active posting's `form-log.jsonl`, and its status moves forward automatically, but only when the tab may
  be that posting's. What a URL says (site, tenant, job) comes only from the site registry, and what a page says
  from its site's definition (`FormSchema.job`), so every registry site is matched the same way.
  - **The posting's side:** its `application` (`meta.json`): its own URL when that's a form site's page, else
    found in its capture (`postings/application.ts`: the page's link to the application, or an embedded board's
    job in its URL), else bound later. Its job is the application's, else its URL's, else a `reqId` without
    spaces. `sameJob` takes Workday's `-1` posting suffix as the same job.
  - **The evidence, strongest first:** `site` (the application is on another site than the tab), `job` (both
    URLs name one: `siteJob` reads Workday's requisition from the job's path segment, `…/Engineer_JR1000001-1/apply`
    → `jr1000001-1`, Oracle's job id, and the Greenhouse, Lever or Ashby job), `binding` (an earlier call bound
    the tab to a posting; it holds while the tab stays on that tenant), `page-reqid` (a requisition the page
    shows), `tenant`, then `title` (the page's job title against `role`, only where no job id is known on
    either side: all of one's significant words in the other is the same job, none shared is another, anything
    between decides nothing). With none of it the tab is `unconfirmed` and credited. Where only the title could
    decide and the posting has a role, the companion reads the page first.
  - **Tab choice** (no `tabId`): the tab matching by job or binding, then by tenant, then one nothing ties to
    another posting, then any application tab; among equals the one the user is looking at, else the most
    recently used.
  - **Binding:** the first call that changes a page binds the tab to the active posting (in memory; a restart
    loses it) and, when the posting had no `application`, stores the tab's site, tenant and job as one
    (`from: "bound"`). A tab bound to one posting is `other` for the next even with nothing else to compare: two
    applications at one employer captured from a job board can't take each other's fills. When the bound tab was
    `unconfirmed`, that result carries `postingBound { id, company?, role?, formTitle?, hint }` once, and the agent
    tells the user which posting this application is credited to. `posting_activate { id, tabId }` rebinds.
  - **Results:** `get_form` and `autofill_step` carry `postingMatch { by, from? }` (`by`: the evidence, or
    `["unconfirmed"]`; `from`: how the application was found), and other results carry it when it changed since
    the tab's last call. Every `form-log.jsonl` event gets `matchedBy`. A tab that's another posting's is read
    with `postingMismatch { activePosting { id, company?, role?, tenant?, job? }, formTenant?, formJob?,
    formTitle?, boundTo?, by, hint }`; every call that changes the page (`fill_fields`, `upload_file`,
    `remove_items`, `add_repeatable`, `remove_repeatable`, `go_next`, `go_back`, `page_action`) is refused with
    `posting_mismatch` and the same hint (activate the right posting, or switch tabs, or, if the user says this
    tab is the posting's, `posting_activate { id, tabId }`), and `autofill_step` fills nothing.
  - *Why:* without the check, two open applications or an old confirmation page on screen would credit the wrong
    posting, up to marking it `submitted`. At first a mismatch only skipped the logging. Later
    only tenants and URL jobs were compared, and most of the user's postings were captured off the form
    sites (a school's job board, employers' careers pages) with neither, so nothing was checked for them: the two
    applications at one employer filled one evening could each have taken the other's fills.
- **The hand-off checklist** (`forms/checklist.ts`): the list the `ezapply-apply` skill gives at the hand-off,
  kept by the companion instead of the model's memory. Live runs missed parts of it: the cover letter twice
  (now `notAttached`), and sections that start empty are easy to miss.
  - `stepWarnings` runs on each step page (`get_form`, `autofill_step`, and `go_next` as the step is
    left). It flags an add button's list whose rows differ from the profile's. The list comes from the
    button's label, else its section (`forms/lists.ts`; by label first because Oracle's Add Experience and Add
    Education share one section): work, education, languages, certifications, and links. Links count LinkedIn
    only when the page has no LinkedIn field of its own. Rows are Workday's `<list>-N` sections, saved items (sections
    the schema marks `saved`: Oracle's `….experience-N` is work, `….education-N` education, `<block>.item-N` the
    block's list) and link fields ("Link 1"); Save buttons (`kind: "save"`) are skipped. It also flags a file field holding a file no upload
    of this application made.
  - Warnings are things to check, never errors: a row count can be right on purpose.
  - `handoff` is built from `form-log.jsonl`:
    - `steps`: the warnings from the last `step-check` of each step that still had any;
    - `answersToFlag`: the last fill of each field whose source is `user` or `judgment`;
    - `automatic`: `autofill_step`'s fills, by section;
    - `replaced`: the values it overwrote;
    - `removed`: removals and deleted rows, with their reasons.
  - Only for a posting the tab is credited to. A checklist that can't be built is skipped (logged), never
    failing the call.
- **The tab in front:** inside the tab's queue, right before each call reaches the adapter, the companion
  sends `tab.show` so the application tab is the active tab of its window
  ([extension](components/extension.md#serving-form-requests-formsts)). Why: browsers run a hidden tab's
  timers at most about once a second (Chrome also only once a minute for chained timers after five hidden
  minutes) and stop `requestAnimationFrame`. Every adapter wait is a timer, and Workday's widgets render on
  timers and animation frames, so a hidden tab fills many times slower: in one live run 16
  fields took 6.7 s, then `review_open` opened the review page in front of the form and 4 dates took 28 s. A
  slow fill runs past the companion's timeout and keeps going in the page unlogged, which looks like a broken
  adapter. The tab gets hidden in ordinary use: the review page opens as a new tab in front of the form, the
  user reads something else, the window is minimized.
  - While a review page waits for the user (`ReviewService.pending()`), it's sent with `activate: false`:
    switching would take the review away from them mid-approval.
  - When the page is still hidden afterwards (minimized or covered window, or a pending review), results
    that are objects carry `tabHidden: { hint }` (`get_form`, `fill_fields`, `upload_file`, `remove_items`,
    `add_repeatable`, `remove_repeatable`, `go_next`, `go_back`, `page_action`; not the option lists), and
    the logged event gets `tabHidden: true`. A switch adds `tabActivated: true` to the logged event. The
    `ezapply-apply` skill passes the hint to the user once and keeps filling.
  - **The browser window too**, with `forms.focusBrowser` on (the default; read for every call): calls that
    change the page (everything but `get_form`, `list_options`, `search_options` and `screenshot`) send
    `focusWindow: true`, and the extension brings the browser window to the front, restoring it if minimized.
    Why: Chrome sends no focus events to a window behind another app, and widgets that track focus may depend on
    them. On Workday, all five multi-part dates read back right but were called empty in a run whose window may
    have been behind, and every date was taken the first time in a run with the window in front throughout
    ([workday adapter](components/workday-adapter.md)). Reads don't need it, so they leave the terminal in front.
    The cost of on: the browser comes in front of the terminal, with keyboard focus, on each such call, and the
    user clicks back. Never while a review page waits. A raise adds `windowFocused: true` to the logged event.
  - When the page is on screen but still without focus on a call that changes it (the option is off, or the OS
    kept the window behind), results that are objects carry `browserBehind: { hint }` (the tools that
    carry `tabHidden` except `get_form`, and `autofill_step`) and the logged event gets `windowInBackground: true`. The hint
    asks the user to bring the browser to the front, or to turn the option on (when it's off), or to click the
    browser window (when the raise didn't take). Not while a review page waits, nor when `tabHidden` is said.
    The skill passes it on when a field (a date) isn't taken.
  - An extension built before `tab.show` answers "Unknown method": the call goes ahead as before, and the
    companion logs that once. Any other `tab.show` failure is logged and ignored too. An extension built before
    `focusWindow` ignores it: only the tab is switched to, and `browserBehind` still says when the window is
    behind.

| Tool | Input | Does |
|---|---|---|
| `autofill_step` | `tabId?` | Starts every step instead of `get_form`. Fills, without the model, what `profile.yaml` and `answers.yaml` settle: hinted profile fields, work, education, language and website rows (adding the rows the profile needs), link fields, Oracle's work, education and language entries (each added through its inline form and saved), and questions worded as an answer-bank entry, with a plain answer or one computed from the profile. Fills go `strict`. Returns `get_form`'s view with only the fields left (each with `reason`; a dropdown left as `no-strict-match` with the `options` listed), plus `filled` (`{ fieldId, label, value, rule, was? }`), `failed` (with `error`, `availableOptions` or `inexact`; also an add or Save the page refused), `added` (rows and items added) and `kept`. Logs `add-row` and `add-item` events besides the fills. Fills nothing (`note` says why) off a `step` page, on another posting's tab, with `forms.autofill: "off"`, or without a valid profile ([autofill](components/autofill.md)) |
| `get_form` | `onlyEmpty?`, `section?`, `tabId?` | The page's `FormSchema`, lean: `required` only when true, `multiple` only when true, `options` only when non-empty, no `automationId` or `optionsLazy` (dropdowns and typeaheads always list options on demand). `onlyEmpty` keeps fields that are empty or show an error; `section` keeps sections whose id or title contains it. Add buttons carry their `section` (ids like `add.work-experience`); notices such as upload confirmations are in `messages`, not `errors`. Adds `posting` (the id it's credited to) or `postingMismatch`, and `timingIssues` when `autofill-timing.yaml` has mistakes ([waits](components/workday-adapter.md#waits-autofill-timingyaml)). Seeing `review` sets status `filled`, and adds `notAttached` when approved documents never went in (see `upload_file`); `confirmation` sets `submitted`. On a step of a posting this tab is credited to, `checklist`: warnings about the step (see **The hand-off checklist** below). On the review page, or a step whose only way on is Submit (`lastPage`: Oracle's last or only page, every Greenhouse, Lever and Ashby application), `handoff`. `debug: true` while autofill debug mode records every form call ([format](data-formats.md#debugdate-postingid-companionsrcformsdebugts)), so it isn't left on unnoticed |
| `list_options` | `fieldIds?` (or `fieldId?`), `tabId?` | Options of dropdowns or a typeahead's top level (`hasChildren` = nested menu). `fieldIds` → `{ <fieldId>: options \| { error } }`, one call for a whole step (the adapter opens them one after another); `fieldId` alone → that field's options. The description says a miss in `fill_fields` returns the options anyway, so listing first is only for questions whose wording decides the answer |
| `search_options` | `fieldId`, `query`, `tabId?` | Type into a typeahead (on Oracle, a dropdown: its lists search as you type) and return matches, each label once, once the results for this query are in |
| `fill_fields` | `fills[] { fieldId, value, source, answerId? }`, `tabId?` | Fill in one batch. `source`: `profile`, `answer-bank` (+`answerId`), `computed`, `user`, `judgment`. `{ results[], postingMismatch? }`; the companion waits `fillTimeoutSeconds` (`autofill-timing.yaml`, default 120) for it. A clean success whose read-back equals the value exactly is just `{ fieldId, ok: true }` (`leanFillResult`); anything else keeps ok, read-back (e.g. the full text of a matched option), error, available options, and a typeahead's `unmatched` (entries with the options their search showed) and `inexact` (an option the page selected itself). On Oracle the fields are filled in page order, whatever order they're given in, since its address lists load from the one above. Dates also take `MM/YYYY` and `MM/DD/YYYY`; option text is matched as in [filling](components/workday-adapter.md#filling). A field that still shows an error after filling keeps `ok: true` with "Filled, but the page reports: …" in `error`. The description asks for the whole step in one call |
| `upload_file` | `fieldId`, `path` (under `postings/` or `library/`, ≤25 MB), `tabId?` | Attach a file; success needs a newly shown file (a same-named file left from a previous application doesn't count) and sets status `attached`. In the `after-approval` attach mode a file from `postings/` must be approved in its current version, or it's refused with a hint to review it; `library/` files never need approval. After a successful upload, `notAttached: { files, hint }` lists the posting's approved documents (current version) that no successful upload of this application has attached (from `form-log.jsonl`), with a hint that a field with `multiple: true` takes several files; left out for a `bundleRequired` posting. Why: two live runs uploaded the resume into Workday's single Resume/CV field and never the approved cover letter |
| `remove_items` | `fieldId`, `values?` (labels or file names; omit = all), `reason?`, `tabId?` | Remove selected entries from a multi-select (e.g. Skills; on Oracle a multi-choice `checkbox-group`) or attached files from a file field, typically what Workday carried over from the last application or Oracle from the candidate's profile. `{ ok, removed, remaining, notFound?, error? }`; logged as `remove` |
| `add_repeatable` | `addButtonId`, `tabId?` | Press an add button (another work, education or website row), named by its section (`add.websites`). On Oracle an add button opens an inline form, and its `save.<block>` button (also in `addButtons`) adds the item once filled: `ok: false` with the page's errors when it wants more |
| `remove_repeatable` | `sectionId` (a section `get_form` marks `removable`), `reason?`, `tabId?` | Delete that repeatable row, e.g. a work-history entry carried over from the last application (on Oracle, a saved item: a language or license tile, a timeline entry). `{ sectionId, ok, removed?, error? }`; logged as `remove-row`. Later rows' field ids change: `get_form` again |
| `go_next` | `tabId?` | Next / Save and Continue. For a posting this tab is credited to, it first reads the step and logs a `step-check` with its warnings, then returns them as `checklist` (what still looked off on the step left). `{ advanced, pageKind, step?, errors, messages?, refusedReason?, checklist? }`: `advanced` when the step index, title or page kind changed; on Workday it returns once the new step shows its fields (up to `stepFieldsMs`), so `get_form` right after it reads the step. Reaching review adds `notAttached` as `get_form` does. Refuses on review, on any submit control (a one-page application, `lastPage`, has only Submit: Oracle's single page, Greenhouse, Lever, Ashby) and on Oracle's email step; logged as `next` with the step title and index |
| `go_back` | `tabId?` | Back to the previous step (`get_form` shows `backLabel` when there's a Back button), e.g. to fix an answer from the review page. `{ moved, pageKind, step?, errors, refusedReason? }`: `moved` when the step index, title or page kind changed, then it waits for the step's fields as `go_next` does; refuses on the first step and after submitting; logged as `back`. Entries not saved with `go_next` may be lost |
| `page_action` | `action` (`apply`, `apply_manually`, `autofill_with_resume`, `use_last_application`), `tabId?` | Start-page buttons. On Oracle only `apply` (Apply Now) and `use_last_application` (Use My Profile) exist |
| `screenshot` | `tabId?` | The visible part of the tab as an image (tab must be visible). A last-resort escape hatch: its description and the `ezapply-apply` skill limit it to a page or widget that `get_form` and `browser_status` leave unexplained, never to reading or checking fields. Why: `get_form` already gives the page as structured data, and an image stays in the conversation and is re-sent with every later turn |

An extension built before `form.remove`, `form.removeRepeatable` or `form.back` existed answers "Unknown
method"; the tools turn that into "rebuild and reload the extension".

There is deliberately no general click, navigate or script tool, and no submit.

## Decision tools (not registered)
`suggest_answers` and `decide` are reserved for a future `DecisionProvider` (e.g. Jev). With the only
provider being `none`, they don't exist. See [status.md](status.md#deferred).
