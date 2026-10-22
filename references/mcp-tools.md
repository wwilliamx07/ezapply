# MCP tools

The `ezapply` MCP server's full surface, as registered in `companion/src/mcp/tools/`. Every tool validates
its input with zod, returns compact JSON text (an image for `screenshot`, plain text for `claims_list`), and on
failure returns `isError: true` with `{ error: { code, message, hint? } }` (`mcp/result.ts`; `permission_ask` never
fails, it denies). Paths may be absolute or relative to the
workspace root and must fall under the folders listed for that tool (`path_not_allowed` otherwise).
Read-only tools carry the MCP `readOnlyHint`.

Results and descriptions are kept short because they cost context: results are serialized without
indentation (indentation added a fifth to a third to large results), `get_form` leaves out default values,
and descriptions say what Claude needs and no more (all of them sit in context for the whole session).

**Naming.** The names grew up in two styles: most groups are `<noun>_<verb>` (`posting_get`,
`template_import`, `repo_sync`), the form tools read as commands (`fill_fields`, `go_next`). New tools follow
their group's style, `<noun>_<verb>` everywhere except the form group. The odd ones out (`tab_bind`
vs `postings_list`, `repos_selection_get` vs `github_list_repos`, `claims_check` vs `knowledge_mark_indexed`)
stay as they are: renaming would break every workspace's skills and habits for no gain. If a major version
ever happens, rename with the old names kept as aliases for a while. The skills spell out parameter names
too ([call shapes](components/workspace.md#call-shapes)), so renaming a parameter means updating them;
`cli/test/skill-calls.test.ts` fails until then.

## Setup and status

| Tool | Input | Does |
|---|---|---|
| `workspace_check` | — | The onboarding checklist `{ ready, nextStep?, items[] }` ([details](components/companion.md#readiness-checklist-workspace_check)) |
| `onboarding` | `step?` (a page step: `repos`, `resume`, …), `taskId?`, `result?` `{ ok, note? }`, `timeoutSeconds` (5–900, default 600), `wait` (default false) | By default (the side panel's agent, which gets setup tasks as messages): reports the task and returns `{ reported: true }`, or without `taskId` opens the setup page and returns its `url`; with `step` the page opens at that step, and a page already open moves to it (`{ pageOpen: true, showing }`). Its description says a change to a setup step (repos, another resume) is opened on the page for the user, and never asked for in chat. With `wait: true` (only without a panel agent: tests): opens the setup page in the user's browser (when no page of it is listening) and waits for work from it: `{ url, openedIn?, task { id, kind, params, status, how } }` (do what `how` says, then call it again with `taskId` and `result`, which reports and waits for the next in one call), `{ done: true, ready, notDone[] }` once the user finishes, or `{ waiting: true, hint }` when nothing came. A task taken and never reported is given again. When no browser opened it returns at once with `openedBrowser: false`, `tell` and a hint. Reporting an unknown task is `not_found` ([details](components/ui.md#the-onboarding-page-onboard)) |
| `workspace_changes` | `refresh?` | What in the workspace is behind its source: `{ changes[] { id, kind, summary, detail, diff?, affects[] }, notChecked?[] { what, reason, hint? }, deferred?[] { repo, until }, pending? }`, `{ changes: [] }` when all is current. Kinds: `repo-pushed`, `repo-deselected`, `template-source`, `template-untracked` (imported from a scratchpad copy), `library-template` (a LaTeX document in `library/` no template came from), `resume-edited` (with the template's `diff`), `profile-identity`. The repos are checked once per chat in the background; this waits up to 15 s for that check, then answers with `pending: true`. `refresh` checks the repos again. `deferred` lists the repos put off whose timer still runs; they aren't checked. `EZAPPLY.md` has Claude call it at the start of every session ([details](components/companion.md#keeping-the-workspace-current-workspace_changes)) |
| `workspace_change_mark` | `ids[]`, `as` (`done` \| `later`), `hours?` | `{ marked[] { id, as, removed?, until? } }`; every id is checked before any is marked. `later` on a `repo-pushed` change puts that repo off for `hours` (24 by default, capped at 2160, i.e. 90 days): it isn't checked or asked about in any chat until `until`, and re-indexing or deselecting it ends that early. `later` on any other change hides it until the chat ends, and `hours` with one is refused. `done` records the derived part as current: a template's source hash, a scratchpad import no longer watched (drops `importedFrom`), a library document that isn't a template (until it changes), the resume template the profile now matches, the profile the cover fields now match; for `repo-deselected` it deletes the repo's knowledge folder and cache (`removed`). Refused for `repo-pushed` (re-indexing ends it) and for an id that isn't current (`not_found`) |
| `extension_pair` | `replace?` | Opens pairing for 15 min and returns `chrome: { page, steps, folder }`, what to load in Chrome or another Chromium browser (plus a hint if not built). Already connected → `{ connected: true }`. `replace` first forgets the paired extension and rotates the code |
| `extension_pair_wait` | `timeoutSeconds` (5–900, default 180) | Waits for the extension to connect; `{ connected, extension? , hint? }` |
| `browser_status` | — | Companion version, bridge status (with `browser { name, version? }`: the browser the extension runs in, where ezapply opens pages and PDFs; kept after a disconnect), and when connected the extension version and every tab with its site (a registry site's id, as its page shows it, else its URL; else `generic`; [telling a page's site](components/extension.md#telling-a-pages-site-framests)) and `frames` (applications embedded in the page: `{ frameId, url, site }`); when not, a hint |

## Postings

There's no workspace-wide "active posting". A call is about the posting it names (`id`), else its conversation's
own: a posting's panel conversation works on that posting (`PostingsService.resolve`, from the call's session), so
conversations about different postings run side by side
([agent](components/agent.md#conversations-servicets)). From a posting's conversation, naming another posting is
`bad_request` (the user opens that one from the panel's list). Elsewhere (the general conversation, a terminal
chat) there's no default: leaving out `id` is `no_posting`, and the form tools work without a posting (nothing is
credited or logged, no tab is bound). The form tools' default tab and crediting use the conversation's posting.
*Why:* one global choice meant two conversations working at once could act on each other's posting, and a
terminal chat silently worked on whatever was captured last.

| Tool | Input | Does |
|---|---|---|
| `posting_get` | `id?` (a plain folder name; anything with separators or `..` is `bad_request`; default: the conversation's posting) | Within 40 s of `ezapply` starting, first waits for the paired extension to reconnect, and for any capture it queued ([details](components/companion.md#extension-bridge-extensionbridge)). The posting's metadata, folder, paths of `posting.md`, `visible.txt`, `raw.html`, its files, and `documents { attachMode, approved[] { file, approvedAt, current }, openReview? }` ([review](components/documents.md#review-before-attaching)). When the paired extension hasn't connected since the start (the wait ran out), adds `extensionReconnecting` (a note: a capture made while ezapply wasn't running may still arrive). An unknown id is `not_found`; no id outside a posting's conversation is `no_posting` (with the same note in the hint, if it applies) |
| `postings_list` | `status?`, `company?` (substring over company and tenant), `limit?` (default 25, max 200) | Postings newest first with id, company, role, status, site, url, updatedAt. Settles like `posting_get`; with the extension still reconnecting the result is `{ postings, extensionReconnecting }` |
| `tab_bind` | `tabId`, `id?` (default: the conversation's posting) | Only when the user says that tab is this posting's application, usually from a `postingMismatch` or `postingBound` hint: binds the tab to the posting, replacing any earlier binding, and stores the tab's site, tenant and job as the posting's `application` (`from: "user"`). Returns `{ posting, boundTab { tabId, url }, application }`. A tab that isn't on a form site is `bad_request`, a closed one `not_found` ([which posting](#forms)) |
| `posting_update_meta` | `id?` (default: the conversation's posting), `company?`, `role?`, `reqId?`, `location?`, `deadline?`, `bundleRequired?`, `status?` | Correct or add metadata; set status `drafting` (its description says later statuses are automatic and approval sets none, so the agent doesn't invent one such as `ready`). `reqId` is trimmed, and one of more than three words is refused as a title (`bad_request`, hint: put it in `role`), since it would be compared with application URLs' job ids. Setting it lets the posting's capture be searched again for its application |

## Documents
TeX source under `postings/` or `templates/`; PDFs read from `postings/`, `templates/`, `library/`; output
under `postings/` or `library/`. Details: [documents.md](components/documents.md).

| Tool | Input | Does |
|---|---|---|
| `tex_compile` | `path`, `maxPages?` | Compile next to the file (no shell escape) with the engine named by the file's `% !TEX program` comment, else `tex.engine` ([documents](components/documents.md#tex-engines-texenginests)). `{ ok, engine, engineFrom, pdf, pages, pageLimit?, pageLimitExceeded?, overflow?, lint?, freeLines?, diagnostics[], logPath, durationMs, snapshot, hint? }`. `*resume*`/`*cv*` files are checked against the page limit, `*cover*`/`*letter*` files against one page; over it, `overflow { lines, text }` is the text past the limit (first 400 characters) and its line count, so cuts can be sized in one edit. Within it, `lint[] { kind, page, text, message }` lists layout problems (`short-line`, `ragged-right`, `underfilled`, `off-page`: [layout lint](components/documents.md#compile-compile)), and `freeLines` is how many more lines fit on the last page; there is no tool that renders a page as an image. Snapshots to `.history/` |
| `tex_diff` | `oldPath`, `newPath` | latexdiff → compiled change-highlighted PDF (needs latexdiff): `tex_compile`'s result for `<new>-diff.tex`, plus `diffTex` |
| `pdf_text` | `path`, `pages?` (`"1-2,4"`), `sinceReviewed?` | Text per page in reading order. With `sinceReviewed: true` (a PDF in a posting folder): instead what changed in its text since the user last answered a review of it, `{ since { reviewedAt, reviewId }, changes[] { page, removed?, added?, before } }`, word by word as the review page marks it, or `{ firstReview: true, hint }`. The agent quotes these in its report after a revision ([details](components/ui.md#what-changed-since-the-last-review-changests-protocolsrctextdiffts)) |
| `pdf_info` | `path` | Pages, bytes, page sizes, encrypted, text layer, title, author |
| `pdf_merge` | `inputs[] { path, pages?, label? }`, `output`, `bookmarks` (true), `normalize` (`auto`/`none`/`letter`/`a4`), `title?`, `author?` | One PDF with bookmarks and consistent page sizes; returns sections with page ranges, and snapshots the output to `.history/` |
| `pdf_from_images` | `images[]`, `output`, `pageSize` (`letter`/`a4`) | Images → PDF, one per page |
| `pdf_compress` | `path`, `output?` (default overwrite), `targetBytes?` (default config, 5 MB) | Lossless, then Ghostscript if installed; before/after, method, target met |
| `review_documents` | `files[]` (1–6 PDFs under one `postings/<id>/`) or `reviewId`; `short?[] { file, reason }`; `again?[] { file, reason }`; `timeoutSeconds` (5–900, default 600) | With `files`: opens a review page in the user's browser showing those PDFs, where the user approves each or comments on passages and writes what should change, and waits for the answer: `{ reviewId, url, postingId, files, openedIn, done: true, approved[], changes[] { file, request?, comments?[] { page, quote, note } } }` (`openedIn`: the browser it opened in, or `default`), or on timeout `{ …, done: false, url, hint }`. When no browser opened it returns at once with `openedBrowser: false`, `tell` (the URL to give the user) and a hint to wait with `reviewId`. With `reviewId`: waits again for that review (`{ reviewId, done, … }`; a replaced one gives `supersededBy`; an unknown or expired one is `not_found`). **From a panel conversation** it doesn't wait: it returns at once with `pending: <reviewId>` and a hint to end the turn, beside `openedIn` (or `openedBrowser: false` and `tell`), and the answer, or `{ done: false, expired }`, comes as the conversation's next message ([results as messages](components/agent.md#results-as-messages)); `reviewId` on an open review returns `pending` again. Both or neither of `files` and `reviewId` is `bad_request`. A resume or cover letter with 3 or more free lines on its last page is `bad_request` unless `short` names it with the reason it's meant to be shorter ([underfilled](components/documents.md#review-before-attaching)), and so is a document already approved in its current bytes, unless `again` names it with what the user asked. A newer review of the same posting replaces an open one. Why opening and waiting are one tool: [details](components/documents.md#review-before-attaching) |
| `attach_mode_set` | `mode` (`after-approval` / `immediately`) | Saves `documents.attach` in `ezapply.config.json`, keeping everything else as written |
| `open_file` | `path` (under `postings/`, `templates/`, `library/`) | Opens a PDF, image or `.txt` in the user's browser (the extension's), anything else in its default app, without waiting. `{ opened, openedIn }` (a browser name, or `default`) |

## Profile and templates
Details: [profile-and-templates.md](components/profile-and-templates.md).

| Tool | Input | Does |
|---|---|---|
| `profile_check` | — | Validate `profile.yaml`: errors with paths, or commonly-needed fields still missing |
| `answers_check` | — | Validate `answers.yaml`; counts; unanswered entries with suggestions; `fromProfile`, the entries answered from the profile, each with its `source` and the profile's `value` there (absent when it holds none); sensitive ids; `notProfileSources { ids, hint }` when an entry's `source` isn't a profile path (agents have written `source: user`) |
| `template_import` | `source` (absolute: a folder or a single `.tex` file, outside the workspace or in `library/`), `kind` (`resume`/`cover`), `main?`, `replace?` | Copy a LaTeX project into `templates/<kind>/` and watch the source for edits (`template-source`); a source in a Claude scratchpad is refused; replaces the default cover without asking, anything else needs `replace`; the old one goes to `templates/.old/`. Adds `% !TEX program = pdflatex` to a pdfTeX-only main file and reports it in `texProgram`. `contentFiles` lists the `.tex` files the main file `\input`s (tailored copies need them) |
| `template_import_example` | `sourcePath` (absolute) | Copy a sample cover letter (PDF, PNG/JPG/WebP, TXT, MD; ≤20 MB) into `templates/cover/example/`; Word → hint to export PDF |
| `template_set_main` | `kind`, `main` (relative to `templates/<kind>/`, must stay inside it and end in `.tex`) | Record the main file and its `contentFiles`; marks a non-imported template `custom`. Returns `{ kind, main, contentFiles }` |

## GitHub and knowledge base
Details: [github-and-repos.md](components/github-and-repos.md), [knowledge-base.md](components/knowledge-base.md).

| Tool | Input | Does |
|---|---|---|
| `github_status` | — | App registered, slug, `manageUrl`, logged in, login, name, token expiry, and `portMismatch { appUrl, localUrl, hint }` when the app's callback URLs point at another port than ezapply's |
| `github_login` | `app?` (`new` / `existing`) | Opens ezapply's login page in the browser; returns the URL, `openedBrowser`, `openedIn` (when it opened), `firstTimeSetup`, and a `tell` text (when no browser opened, it gives the user the URL to open). Without `app`: the app registered here, or a new one. `new` creates an app from the manifest; `existing` connects an ezapply app the user already has, with the Client ID and a new client secret entered on the local page, never in chat, and returns the `callbackUrl` the app must list ([details](components/github-and-repos.md#reusing-an-existing-app)). Without `app`, refuses with the fix while `portMismatch` stands |
| `github_login_wait` | `timeoutSeconds` (5–900, default 300) | Waits for the browser flow; times out with a hint |
| `github_logout` | — | Revoke and delete the token; returns `github_status`'s result |
| `github_list_repos` | — | Every repo the app can read, newest push first, with `selected` |
| `repos_selection_get` | — | Selected repos with cache and index state |
| `repos_selection_set` | `repos[] { fullName, source (app/public-url), note? }` | Replace `profile/repos.yaml` |
| `repo_sync` | `repo` (must be selected) | Clone or update the read-only cache; `{ path, headSha, indexedSha, changedSince, affectedClaims, fileCount }`: `changedSince` is each file changed since the indexed commit as `{ path, added, removed }` (null counts for a binary file), `[]` when current, null when there's no usable earlier index; `affectedClaims` the ids of claims whose `files` include a changed path |
| `repo_diff` | `repo`, `paths?` (files or folders) | The unified diff from the indexed commit to the cached HEAD, for `paths` or everything; `{ from, to, diff, truncated }`, cut at 60k characters. Refused before the repo's first index. How a re-index reads changes without re-reading files ([why](components/knowledge-base.md#indexing-procedure-the-ezapply-index-repo-skill)) |
| `repo_contributions` | `repo` | The user's share of commits, dates, areas touched, top authors |
| `claims_list` | — | Every claim of every indexed repo as compact text: `## owner/name`, then `- id: claim (impact: …)`, the impact only when set; evidence, skills and confidence left out. A repo whose `claims.yaml` doesn't parse gets one line pointing at `claims_check`. `EZAPPLY.md` has Claude call it once, at the first request about a posting ([why](components/workspace.md#the-agent-file-ezapplymd)) |
| `claims_check` | `repo` | Validate `claims.yaml`: schema, unique ids, every path in a claim's `files` present in the cache. `{ valid, claims, errors[] }` |
| `knowledge_mark_indexed` | `repo` | Requires a clean `claims_check`; rewrites old-form `evidence` as `files`, records the indexed commit. Returns the meta with the knowledge `folder` and `key` |

## Forms
Every site in the registry: Workday, Oracle Recruiting Cloud, Greenhouse, Lever, Ashby, Phenom, Dayforce and SAP
SuccessFactors. Each call is an RPC
to the extension, which runs the tab's site adapter, one engine with a definition per site
([adapters](components/adapters.md); [every site](components/sites.md)); the logic around it lives
in `FormsService` (`companion/src/forms/service.ts`). Every adapter answers every method the same way, and what
differs between sites shows in the schema's facts (`lastPage`, the add buttons' `kind`, `saved` sections), which
the tool descriptions explain once for every site. **The tool descriptions never name a site**
([why](building-adapters.md#principles)).

### Site notes
What a site does differently that no fact says (a document it needs first, a removal that reaches the candidate's
profile on the site, a choice that's the user's) is in its notes, `SITE_NOTES` (`@ezapply/sites/notes`), each site's
`notes.ts` in [its directory](components/sites.md#the-package), keyed by every registry site (a site without notes doesn't compile). `get_form` gives
them as `siteNotes`, first in the result, the first time a page of that site is read in a
Claude session, and never again in that session. The session is the one the MCP relay names in its requests
(`x-ezapply-session`, a panel conversation's Claude Code session), passed to the form tools when the
request's MCP server is built (`createMcpServer(services, session)`); requests naming none (Claude Code run by
hand in the workspace, another client) share one. **Why once per session:** the agent needs them only for the site it's on, and from then
on for the rest of that application; repeating them on every read would cost context on every step. A session whose
context was compacted may have lost them: the notes are short, and the generic skill still holds.

- **One call per tab at a time:** Claude Code sends tool calls in parallel, and two acting on one page
  interfere (two dropdown reads each open a listbox and both can read whichever is on screen; a fill can land
  while `go_next` changes the step). After the tab is chosen, each form call waits for earlier ones on the
  same tab and runs in order (`onTab`, a `KeyedQueue` per tab id); calls on other tabs aren't held up, and a
  failed call doesn't stop the next. Choosing the tab (reading the debug setting, asking the extension for its
  tabs, reading the conversation's posting) is done one call at a time, in the order the calls came: those reads can
  finish out of order, and a call that overtook an earlier one would act on the page first.

- **Embedded applications:** an application in a frame of another site's page (a careers page showing its
  Greenhouse form, `TabInfo.frames`) counts as an application tab of its own, with the frame's URL and site
  (`formTabs`). Everything below (tab choice, which posting, binding) works on that URL, never the careers page
  around it, so the form is matched by its own board and job; a posting captured from the frame (`frameUrl`) or
  on a page naming the job (`?gh_jid=`) has them too. Asked for by `tabId`, a tab's own page wins when it's an
  application, else its frame that best matches the conversation's posting, else its first. Every call on it sends the
  frame's `frameId` (`framed`); results carry `frameId` and the frame's `url`, and the agent keeps passing just the
  `tabId`. The frame is resolved again on every call, never cached, since a frame that reloads gets a new id.
  `tab.show`, `screenshot` and the one-call-at-a-time queue stay per tab. `tab_bind { tabId }` binds the
  tab's own application, else the one embedded in it.
- **Which posting** (`forms/match.ts`): fills, removals, uploads, steps and the confirmation page are appended
  to the conversation's posting's `form-log.jsonl`, and its status moves forward automatically, but only when the
  tab may be that posting's. A call with no posting (outside a posting's conversation) credits and logs nothing. What a URL says (site, tenant, job) comes only from the site registry, and what a page says
  from its site's definition (`FormSchema.job`), so every registry site is matched the same way.
  - **The posting's side:** its `application` (`meta.json`): its own URL when that's a form site's page, else
    found in its capture (`postings/application.ts`: the page's link to the application, or an embedded board's
    job in its URL), else bound later. Its job is the application's, else its URL's, else a `reqId` without
    spaces. `sameJob` takes Workday's `-1` posting suffix as the same job, and on a site with its own rule (the tab's
    site's registry entry) that rule too: a Phenom `jobSeqNo` and the requisition it embeds are one job.
  - **The tab's side:** its site as the extension found it on the page (else its URL's), whose registry entry
    reads the tenant and job from the tab's URL (`tabSite`): a Phenom job page, whose URL names no site, is still
    Phenom's, with the careers host as tenant.
  - **The evidence, strongest first:** `site` (the application is on another site than the tab), `job` (both
    URLs name one: `siteJob` reads Workday's requisition from the job's path segment, `…/Engineer_JR1000001-1/apply`
    → `jr1000001-1`, Oracle's job id, the Greenhouse, Lever or Ashby job, Phenom's `jobSeqNo`, Dayforce's posting id, and SuccessFactors' requisition), `binding` (an earlier call bound
    the tab to a posting; it holds while the tab stays on that tenant), `page-reqid` (a requisition the page
    shows), `tenant`, then `title` (the page's job title against `role`, only where no job id is known on
    either side: all of one's significant words in the other is the same job, none shared is another, anything
    between decides nothing). With none of it the tab is `unconfirmed` and credited. Where only the title could
    decide and the posting has a role, the companion reads the page first.
  - **Tab choice** (no `tabId`): the tab matching by job or binding, then by tenant, then one nothing ties to
    another posting, then any application tab; among equals the one the user is looking at, else the most
    recently used. The tenant is the registry's `siteTenant` (a Workday tenant, an Oracle career site as
    `host/site`, a Greenhouse board…). The companion picks from `browser.status` and always passes the tab
    explicitly.
  - **Binding:** the first call that changes a page binds the tab to the conversation's posting (in memory; a restart
    loses it) and, when the posting had no `application`, stores the tab's site, tenant and job as one
    (`from: "bound"`). A tab bound to one posting is `other` for the next even with nothing else to compare: two
    applications at one employer captured from a job board can't take each other's fills. When the bound tab was
    `unconfirmed`, that result carries `postingBound { id, company?, role?, formTitle?, hint }` once, and the agent
    tells the user which posting this application is credited to. `tab_bind { tabId }` rebinds.
  - **Results:** `get_form` carries `postingMatch { by, from? }` (`by`: the evidence, or
    `["unconfirmed"]`; `from`: how the application was found), and other results carry it when it changed since
    the tab's last call. Every `form-log.jsonl` event gets `matchedBy`. A tab that's another posting's is read
    with `postingMismatch { posting { id, company?, role?, tenant?, job? }, formTenant?, formJob?,
    formTitle?, boundTo?, by, hint }`; every call that changes the page (`fill_fields`, `upload_file`,
    `remove_items`, `add_repeatable`, `remove_repeatable`, `go_next`, `go_back`, `page_action`) is refused with
    `posting_mismatch` and the same hint (fill it from that posting's conversation in the panel, or switch tabs,
    or, if the user says this tab is the posting's, `tab_bind { tabId }`).
  - *Why:* without the check, two open applications or an old confirmation page on screen would credit the wrong
    posting, up to marking it `submitted`. Comparing only tenants and URL jobs isn't enough: postings captured off
    the form sites (a school's job board, employers' careers pages) have neither, so two open applications at one
    employer could each take the other's fills; hence the binding and the title.
- **The hand-off checklist** (`forms/checklist.ts`): the list the `ezapply-apply` skill gives at the hand-off,
  kept by the companion instead of the model's memory. Live runs missed parts of it: the cover letter twice
  (which `notAttached` catches), and sections that start empty are easy to miss.
  - `stepWarnings` runs on each step page (`get_form`, and `go_next` as the step is left). It flags an add button's list whose rows differ from the profile's. The list comes from the
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
    - `removed`: removals and deleted rows, with their reasons.
  - Only for a posting the tab is credited to. A checklist that can't be built is skipped (logged), never
    failing the call.
- **The tab at full speed:** inside the tab's queue, right before each call reaches the adapter, the companion
  sends `tab.show`, and the extension turns on focus emulation for the tab
  ([extension](components/extension.md#focus-emulation-emulationts)): the page runs visible and focused where it
  is, in the background, minimized or behind the terminal, with nothing switched or raised. Chrome shows "ezapply
  started debugging this browser" while it's on; a user who closes that bar gets it back on the next call. Why: a
  hidden tab's timers are throttled and a window behind another app gets no focus events, so a hidden tab filled
  many times slower (seen live: a few dates took most of half a minute), past the companion's timeout, and
  Workday's dates weren't taken
  ([focus emulation](components/extension.md#focus-emulation-emulationts),
  [Workday's dates](components/sites/workday.md#dates-typed-into-workdays-split-widget)).
  - **When focus emulation can't run** (another debugger holds the tab, a policy forbids the debugger, an older
    extension), the page runs as the browser leaves it, and every logged event of the call gets
    `focusNotEmulated: true`. Nothing is brought to the front: switching to the tab and raising the browser window
    would pull the browser in front of the user's terminal on every call, and can't help a window the user keeps
    minimized.
  - When the page is hidden then, results that are objects carry `tabHidden: { hint }` (`get_form`,
    `fill_fields`, `upload_file`, `remove_items`, `add_repeatable`, `remove_repeatable`, `go_next`, `go_back`,
    `page_action`; not the option lists; for `add_repeatable`, and a `remove_repeatable` or `go_next` that
    succeeded, inside their `form`), and the logged event gets `tabHidden: true`. The hint asks the user to
    keep the tab visible, or to close DevTools or other debugging on it. The `ezapply-apply` skill passes it on
    once and keeps filling.
  - When the page is on screen but without focus on a call that changes it, results that are objects carry
    `browserBehind: { hint }` (the tools that carry `tabHidden` except `get_form`) and the logged event gets
    `windowInBackground: true`. The hint asks the user to bring the browser to the front. Not when `tabHidden`
    is said. The skill passes it on when a field (a date) isn't taken.
  - An extension that can't serve `tab.show` in its current form
    ([protocol](components/protocol.md#methods)) fails it: the call goes ahead, and the companion logs that once.
    Any other `tab.show` failure is logged and ignored too.

| Tool | Input | Does |
|---|---|---|
| `get_form` | `onlyEmpty?`, `section?`, `tabId?` | The page's `FormSchema`, lean: `required` only when true, `multiple` only when true, `options` only when non-empty, no `automationId` or `optionsLazy` (dropdowns and typeaheads always list options on demand). A list of more than 25 options (`MAX_INLINE_OPTIONS`) goes out as `optionCount` instead: native selects send theirs whole, and on a live run a certificate dropdown's issuers and the same language list on three rows were 91% of a 42k-character read, re-sent with every later turn; `fill_fields` matches the closest option and returns the closest options on a miss, and `search_options` searches a long list. `onlyEmpty` keeps fields that are empty or show an error; `section` keeps sections whose id or title contains it. Add buttons carry their `section` (ids like `add.work-experience`); notices such as upload confirmations are in `messages`, not `errors`. Adds `posting` (the id it's credited to) or `postingMismatch`, and `timingIssues` when `autofill-timing.yaml` has mistakes ([waits](components/adapters.md#waits-owned-by-the-site)). Seeing `review` sets status `filled`, and adds `notAttached` when approved documents never went in (see `upload_file`); `confirmation` sets `submitted`. On a step of a posting this tab is credited to, `checklist`: warnings about the step (see **The hand-off checklist** below). On the review page, or a step whose only way on is Submit (`lastPage`: Oracle's last or only page, every Greenhouse, Lever, Ashby and SuccessFactors application), `handoff`. `debug: true` while debug mode records every form call ([format](data-formats.md#debugdate-postingid-companionsrcformsdebugts)), so it isn't left on unnoticed; `siteNotes` the first time a page of its site is read in the session ([site notes](#site-notes)) |
| `search_options` | `fieldId`, `query`, `tabId?` | Type into a typeahead (on Oracle, a dropdown: its lists search as you type) and return matches, each label once, once the results for this query are in |
| `fill_fields` | `fills[] { fieldId, value, source, answerId? }`, `tabId?` | Fill in one batch. `source`: `profile`, `answer-bank` (+`answerId`), `computed`, `user`, `judgment`. `{ results[] }` (on another posting's tab it's refused with `posting_mismatch`); the companion waits `fillTimeoutSeconds` (`autofill-timing.yaml`, default 120) for it. A clean success whose read-back equals the value exactly is just `{ fieldId, ok: true }` (`leanFillResult`); anything else keeps ok, read-back (e.g. the full text of a matched option), error, and a typeahead's `unmatched` (entries with the options their search showed) and `inexact` (an option the page selected itself). **A miss is the query:** `availableOptions` and each `unmatched` entry's `suggestions` are the 10 options closest to the value (`MISS_OPTIONS`, `closestOptions`: one that holds the value or that it holds first, then by shared letter pairs, ties in page order), with `optionCount` when there were more. *Why:* `list_options`, which read a field's options before filling, cost a turn each time (three calls of a few hundred tokens each re-read 60–90k of context), and a whole list of hundreds would be re-read with every later call; a fill is one call when the guess matches and two when it misses. It's gone, and the skill checks `inexact` and `readBack` where the wording decides (reversed polarity, ranges) instead of listing first. On Oracle the fields are filled in page order, whatever order they're given in, since its address lists load from the one above. Dates also take `MM/YYYY` and `MM/DD/YYYY`; option text is matched as in [widget drivers](components/adapters.md#widget-drivers). A field that still shows an error after filling keeps `ok: true` with "Filled, but the page reports: …" in `error`. An empty string clears a text field. The description asks for the whole step in one call |
| `upload_file` | `fieldId`, `path` (under `postings/` or `library/`, ≤25 MB), `tabId?` | Attach a file; success needs a newly shown file (a same-named file left from a previous application doesn't count) and sets status `attached`. In the `after-approval` attach mode a file from `postings/` must be approved in its current version, or it's refused with a hint to review it; `library/` files never need approval. After a successful upload, `notAttached: { files, hint }` lists the posting's approved documents (current version) that no successful upload of this application has attached (from `form-log.jsonl`), with a hint that a field with `multiple: true` takes several files; left out for a `bundleRequired` posting. Why: two live runs uploaded the resume into Workday's single Resume/CV field and never the approved cover letter |
| `remove_items` | `fieldId`, `values?` (labels or file names; omit = all), `reason?`, `tabId?` | Remove selected entries from a multi-select (e.g. Skills; on Oracle a multi-choice `checkbox-group`) or attached files from a file field, typically what Workday carried over from the last application or Oracle from the candidate's profile. A text field (`text`, `textarea`, `number`) is cleared instead (with `values`, only when they name what it holds), and is done when it reads back empty. *Why:* an agent asked to clear a field reaches for this tool; `fill_fields` with `""` clears it too. `{ ok, removed, remaining, notFound?, error? }`; logged as `remove` |
| `add_repeatable` | `addButtonIds?` (or `addButtonId?`), `tabId?` | Press buttons from `addButtons`, named by their section (`add.websites`), in order, repeating an id for each row: every row a step needs in one call. Stops at the first that fails. `{ ok, pressed, failed? { addButtonId, error }, form }`: `form` is the step's empty fields as `get_form` (`onlyEmpty`) gives them, the new rows to fill. *Why:* on a live run five presses took five turns and a `get_form` after them, each re-sending the whole conversation. By its `kind`: `row` adds a row of fields; `form` opens an inline form (Oracle's items, Dayforce's records), and its `save` button (`save.<block>`, also in `addButtons`) adds the item once filled: `ok: false` with the page's errors when it wants more; `save` also saves a form that's part of the step (Dayforce's Personal Information); `edit` opens a saved item's form again |
| `remove_repeatable` | `sectionId` (a section `get_form` marks `removable`), `reason?`, `tabId?` | Delete that repeatable row, e.g. a work-history entry carried over from the last application (or a saved item: Oracle's language or license tile, a timeline entry; Dayforce's saved record, through the page's own dialog, or an open new one, through its Cancel). Where a removal reaches beyond this application (Dayforce's profile), the site's notes say so, not the tool's description. `{ sectionId, ok, removed?, error?, form? }`; logged as `remove-row`. Later rows' field ids change, so on success `form` is the step as `get_form` gives it, with the new ids |
| `go_next` | `tabId?` | Next / Save and Continue. For a posting this tab is credited to, it first reads the step and logs a `step-check` with its warnings, then returns them as `checklist` (what still looked off on the step left). `advanced` when the step index, title or page kind changed. Advanced: `{ advanced, messages?, checklist?, form }`, where `form` is the new page read as `get_form` gives it (so its own `checklist` is the new step's, and on the review page it carries `notAttached` and sets status `filled`); on Workday the move returns once the new step shows its fields (up to `stepFieldsMs`) and the requests it started are back (up to `stepRequestsMs`), so the read sees the step and its saved choices. *Why:* every advance was followed by a `get_form`, a turn that re-sent the conversation for nothing else. Not advanced: `{ advanced, pageKind, step?, errors, messages?, refusedReason?, checklist? }`. Refuses on review, on any submit control (a one-page application, `lastPage`, has only Submit) and on Oracle's email step; logged as `next` with the step title and index |
| `go_back` | `tabId?` | Back to the previous step (`get_form` shows `backLabel` when there's a Back button), e.g. to fix an answer from the review page. `{ moved, pageKind, step?, errors, refusedReason? }`: `moved` when the step index, title or page kind changed, then it waits for the step's fields as `go_next` does; refuses on the first step and after submitting; logged as `back`. Entries not saved with `go_next` may be lost |
| `page_action` | `action` (`apply`, `apply_manually`, `autofill_with_resume`, `use_last_application`), `tabId?` | Start-page buttons. On Oracle only `apply` (Apply Now) and `use_last_application` (Use My Profile) exist |
| `screenshot` | `tabId?` | The visible part of the tab as an image (tab must be visible). A last-resort escape hatch: its description and the `ezapply-apply` skill limit it to a page or widget that `get_form` and `browser_status` leave unexplained, never to reading or checking fields. Why: `get_form` already gives the page as structured data, and an image stays in the conversation and is re-sent with every later turn |

An extension built before `form.remove`, `form.removeRepeatable` or `form.back` existed answers "Unknown
method"; the tools turn that into "rebuild and reload the extension".

There is deliberately no general click, navigate or script tool, and no submit.

## The panel
How the agent behind the extension's side panel asks the user ([agent](components/agent.md#cards-needsts)). Both
know which conversation a call comes from by the relay's session header: a panel conversation's always gets a card;
a terminal chat's only while a panel is open.

| Tool | Input | Does |
|---|---|---|
| `ask_user` | `title`, `intro?`, `questions[]` (1–25: `id`, `prompt`, `type` `single` \| `multi` \| `text`, `options[] { value, label?, description? }`, `allowOther?`, `min?`, `max?`, `multiline?`, `placeholder?`, `maxLength?`, `proposed?`, `why?`, `sensitive?`, `required?`, `remember? { answerId }`), or `askId`; `timeoutSeconds` (5–900, default 600) | Shows the questions on a card and waits: `{ done: true, answers: { <id>: { value, other?, remember? } \| { skipped: true } }, savedToAnswerBank?, toSave?, hint? }` (answers marked to save go into the answer bank when it has the entry, else come back in `toSave` for the agent to add), `{ replied, message }` when the user wrote in the chat instead, `{ done: false, askId, hint }` on timeout (`ask_user { askId }` waits again; a late answer is kept), `{ noPanel, hint }` for a terminal chat's question with no panel open. **From a panel conversation** it returns `{ pending: <askId>, hint }` at once (the hint says to end the turn), and the answers or reply come as the conversation's next message ([results as messages](components/agent.md#results-as-messages)); `askId` on an open card returns `pending` again. A suggestion may go on any question, sensitive ones too. A suggestion that isn't an option (without `allowOther`), a choice question without options, an id twice or min over max are `bad_request` |
| `permission_ask` | `tool_name`, `input`, `tool_use_id?` | Claude Code's permission prompt for the panel's agent (`--permission-prompt-tool`), not for the agent to call: a card with the tool and its input. Returns Claude Code's result as JSON text: `{ behavior: "allow", updatedInput }`, or `{ behavior: "deny", message }` (the user's reason; no answer in 10 minutes; the conversation reset; no panel for a terminal chat) |
