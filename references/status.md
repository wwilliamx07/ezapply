# Status

As of 2026-10-06.

## Done
| Area | State |
|---|---|
| Scaffold | Monorepo, protocol package, CI (Ubuntu and Windows checks, a TeX Live job, `web-ext lint` of the Firefox build), Biome, Vitest, `ezapply doctor` |
| Companion, bridge, capture | The companion inside `ezapply chat` (no background process), MCP over the stdio relay (never re-sends, no timeout, "not running" outside a chat); extension pairs, stays connected (alarm recreated on every start), captures, including from embedded job board frames; verified live in Chrome |
| Documents | TeX compile with page count, log parsing and history; per-file engine from `% !TEX program` (pdfTeX-only templates marked at import); multi-file templates (content files copied with the main file); render, text, info, merge (normalizing keeps links), images, compress, open, diff |
| GitHub and repos | Per-user GitHub App via manifest, or an existing ezapply app connected from its Client ID and a new secret; OAuth login (browser opened, or the URL given), keychain tokens with single-flight refresh, port-mismatch detection, repo listing and selection, hardened read-only cache with the token in git's environment |
| Knowledge base | `ezapply-index-repo` skill, `claims.yaml` with `claims_check`, `claims_list` read once per posting, evidence hashes that flag changed code, contributions, incremental re-index |
| Profile | Profile, answer bank (33 seeded questions), repos schemas and checks; resume and cover templates (`TemplateService`), default cover letter, cover from an example; readiness checklist |
| Document skills | `ezapply-resume`, `ezapply-cover-letter`, `ezapply-bundle`; application requirements recorded in `notes.md` and followed; two attach modes: review in the browser and attach only approved versions (default, enforced by `upload_file`), or attach immediately |
| Workday read path | Page detection and extraction; posting, start-choice and sign-in verified on a live public tenant; tenants on myworkdaysite.com read from the path |
| Workday write path | All fillers (a dropdown reads its own listbox even while the previous one is still on screen; dates typed digit by digit and read from what the widget holds; typeahead entries matched one by one once their search results are in), removing carried-over selections, attachments and rows (`remove_repeatable`), repeatables, next and back, page actions, screenshot (refused by Chrome live while the extension held only Workday's hosts, see [the first Workday run on the engine](#the-first-workday-run-on-the-engine); it holds `<all_urls>`, which `captureVisibleTab` accepts, not yet re-run), submit guard, `ezapply-apply` skill; lean `get_form` with filters; tested against a behavioural fixture, which the companion's e2e tests also drive through the real adapter |
| Oracle Recruiting Cloud | A second adapter with the Workday API ([oracle-adapter](components/oracle-adapter.md)): detection by its pages' body on any host, else by path on Oracle Cloud hosts and employers' domains, tenant as host and site number; extraction of every widget (text, cx-select lists, pills, radios, dates, phone, attachments, agreements, saved items), fillers, uploads and removals, inline item forms with Save, deletes, single-page and multi-page flows, submit guard. Job page and email step verified live (headless, public pages); the single-page application read from a page the user saved; filling tested against a behavioural fixture built from that page and the Candidate Experience's own templates, also driven by the companion's e2e tests |
| Adapters: one engine, a definition per site | A site registry in the protocol (signature, URL rules, tenant, job, canonical paths, waits), from which the extension's bundles, its telling of each page's site (by body, then URL) and the companion's tab choice derive; the extension holds every site (`<all_urls>`) to read them; one adapter engine (API, extraction, ids, rows, fill loop, next and back, guard) with a definition per site; shared widget drivers (native controls, react-select through its props, toggle buttons, a search combobox, file fields); waits owned by each site, with per-site sections in `autofill-timing.yaml`; schema facts (`addButtons[].kind`, `Section.saved`, `lastPage`) instead of site names in the companion. Workday and Oracle moved onto it with their fillers unchanged and golden schemas equal ([adapters](components/adapters.md)) |
| Greenhouse, Lever, Ashby | Definitions on the engine using shared drivers only, built from live public application pages and checked on live forms with fake values, never submitted ([sites](components/sites.md)) |
| Phenom | Employers' careers sites run by Phenom, whose multi-step apply flow is on the employer's domain: a definition on the engine (shared drivers, a react-datepicker month picker, selects that settle late, rows, the resume required on step 1), built from steps 1 to 3 of a live flow saved with placeholder values ([sites](components/sites.md#phenom-sitesphenom)) |
| Dayforce | Dayforce's candidate portal (`jobs.dayforcehcm.com`, every employer on one host): a definition on the engine with an Ant Design Select driver through rc-select's context, phone numbers read as two fields, Personal Information's own form and Update, employment and education records added, saved, edited and deleted through their forms, uploads, the Submit step as the review page. Built from one saved step and the portal's own scripts ([sites](components/sites.md#dayforce-sitesdayforce)) |
| SAP SuccessFactors | SuccessFactors Recruiting's career site (`career<n>.sapsf.com` and the like, every employer of a data centre on one host): a definition on the engine for its one-page application, with its own paginated picklist driver (through its framework's component registry) and attachment driver (through the upload popup, telling a same-named replacement by the field's tick and a page re-render by the field leaving it), a radio group driver for its questions, a shared UI5 Web Components date picker driver, rows of lists added and removed, documents uploaded, replaced and removed, Apply as the submit. Built from one saved application and the page's own scripts, and corrected after a live run ([sites](components/sites.md#sap-successfactors-sitessuccessfactors)) |
| Audit and status | `form-log.jsonl` (with `matchedBy`), automatic status credited only to the posting a tab may belong to: its job, the tab's binding, its tenant or its title ([which posting](mcp-tools.md#forms)); postings captured off the form sites tied to their application by the captured page's link or an embedded board's job, else bound to the tab on the first change; tab choice by the best match, duplicate lookup by company, resume after interruption |
| Firefox | Separate build, origin support, event-page keepalive, site-access handling |
| Agent guidance | Lean `EZAPPLY.md` with prompt-injection, application-requirement and context rules; kept in context by the `CLAUDE.md` import, backed by the MCP instructions and the `agent_file` check; call shapes in the skills (no schema errors in about 110 ezapply calls over five sessions); the form tools' descriptions and the apply skill name no site: what a site does differently is in its notes, given once per chat session as `siteNotes` ([site notes](mcp-tools.md#site-notes)) |
| Context and usage | `ezapply chat` starts a fresh Claude session when another posting is captured (never during a tool call); one `fill_fields` per step with bare results for clean successes, `list_options` for several fields in one call; every claim read at the first request (`claims_list`); form calls on a tab one at a time |
| Opening things | Pages and PDFs open in the browser the extension runs in (reported in `hello`; its program found per OS), else the system default |
| Keeping the workspace current | `workspace_changes` at the start of every session: repos pushed since indexing (`ls-remote`, once per chat, in the background), knowledge from deselected repos, templates whose source folder changed, a template imported from a scratchpad copy, a LaTeX document in `library/` that no template came from, the resume template edited since the profile was updated (with its diff), the profile's contact changed under the cover fields; brought current through `ezapply-onboard` with the user's agreement ([companion](components/companion.md#keeping-the-workspace-current-workspace_changes)) |
| Setup | `npm run setup` + onboarding on a page (`./ezapply chat`, "set me up": the steps in the browser, what needs judgment done by Claude as tasks, [ui](components/ui.md#the-onboarding-page-onboard)), Claude Code's auto memory off in the workspace, code-less pairing, install hints for TeX and git that work without a restart |
| Browser pages | The UI package ([ui](components/ui.md)): the review page in pdf.js with comments on passages and what changed since the last review (`reviewed.json`, the same word diff for the page and `pdf_text { sinceReviewed }`), and the onboarding page; the token traded for a cookie on the page's path, POSTs from the companion's origin only, no inline script, nothing loaded from elsewhere; the companion's own pages in the same style |

## Not yet verified for real
- **Workday and Oracle on the engine** (2026-10-03). Their fillers and readers moved unchanged, the golden
  schemas of every fixture state and live snapshot are equal, and every behaviour test and the companion's e2e
  tests pass. This is an adapter change made before the next live runs, against the plan
  ("One adapter change per live run" in [development](development.md)). If a run is slower or fails where the
  last ones didn't, compare its debug records with the runs before the move, and suspect the engine's fill loop
  (its waits after each field are the same calls as before). **Workday ran live twice** (debug mode on;
  [the first run](#the-first-workday-run-on-the-engine)). It wasn't slower: a 20-field My Experience fill took 13.4 s in
  the page. Oracle
  ran on it once (2026-10-06): its address and school lists failed, fixed since, below.
- **Greenhouse, Lever and Ashby with the extension** (2026-10-03). Checked live through their built bundles in
  headless Edge. One real application so far, on Ashby: capture, text fields, the location,
  Yes/No buttons and the resume upload worked; every radio and checkbox group was missed, because the definition
  found questions by a class those groups don't have. Fixed (they're found by `data-field-path`), checked on the
  live page and covered by a saved copy of it, not yet used in a real application
  ([sites](components/sites.md#ashby-sitesashby)). Not tried: uploads on Lever, the confirmation pages, a real
  application on Lever.
- **Searches and multi-selects after two Workday runs and one Oracle run** (2026-10-06, debug mode on). Fixed and
  covered by fixture tests that fail on the old logic, not yet run live: on Workday, multi-selects with checkboxes
  (skills, a citizenship) unticked the option Workday had ticked itself on Enter, and a hierarchical prompt's
  category menu was read as a search's results ([typeahead](components/workday-adapter.md#typeahead-searches-and-lists));
  on Oracle, the address lists' late server search was missed and then never ran again for the same text, and a
  school list that didn't show within the open waits failed without searching
  ([searching a list](components/oracle-adapter.md#searching-a-list)). A search whose results don't hold the
  query as typed now waits its full length before they're read (Workday about 6 s, Oracle about 9 s); how often
  that happens on real lists is for the next runs' traces. Also seen, not investigated: a Workday failure screenshot
  with several language-level dropdown lists still open on screen.
- **A real Greenhouse application** (2026-10-06, filled, not submitted): text fields, the static lists, the phone's
  country and the uploads worked. Three things didn't, all fixed and covered by tests, not yet run live again: the
  form couldn't be read at all with a multi-select on it (its id ends in `[]`, put into a selector unescaped); the
  lists that load as you type (Location (City), School, Discipline) never searched, each fill waiting 4 s for
  nothing ([react-select](components/adapters.md#react-select-through-its-props)).
- **Telling sites by their pages, with access to every site** (2026-10-04): the signatures match every saved page
  of their own site and no other's, and on real captured pages they told every Workday, Oracle, Ashby and Phenom
  page and matched none of the rest (job boards, other ATSs, employers' own pages). Not yet run in
  a browser: an extension reloaded with `<all_urls>` (Chrome may ask to accept the new permission; Firefox may
  withhold it until granted), `browser_status` reading every open tab (how long it takes with many tabs), Set
  posting's request for every site when already granted, the access window asking for every site, a capture
  sending its `site`, and a Phenom apply flow under `/global/en/` filled through the form tools.
- **Phenom** (2026-10-04): built from saved steps 1 to 3 of a live flow and tested on them in jsdom; its drivers'
  behaviour (the month picker, the late selects) was seen live but is tested on minimal models of it. The
  definition hasn't run on a live page. Check in one real application, with debug mode on: the job and apply
  pages listed `phenom` in `browser_status`, the resume uploaded first and the parsed fields corrected, the month picker and the
  school typeahead, adding and removing a row, Next taking up to 30 s, and steps 4 to 6 (additional questions,
  terms, review), whose markup isn't known: save each of them if anything there is missed.
- **Dayforce** (2026-10-05): built from one saved page (the Candidate Info step as it first shows, Personal
  Information open and no records) and, for the rest, from the portal's own scripts saved with it; tested in jsdom
  only. Nothing has run live. Check in one real application, with debug mode on: the posting and application
  listed `dayforce` in `browser_status`; a list chosen through rc-select's context (the riskiest part: it's
  rc-select's internals) and read back, the province list after the country, a dialling code by its country; the
  resume uploaded (to Resume Upload) and the parsed fields corrected; Personal Information's Update; whether Next
  goes on while a form is still open (if not, the definition should refuse it with a reason, as Phenom's step 1
  does); a record added, filled (its dates `YYYY-MM-DD`), saved, edited and deleted (deleting takes it off the
  candidate's Dayforce profile: use a record made for the test); the questionnaire's pages and their step key; the
  Submit step read as the review page. Save the questionnaire, a record open and saved, the Submit step and the
  posting page (`ezapply debug export`) as fixtures.
- **SAP SuccessFactors** (2026-10-06): built from one saved application (a signed-in candidate's, the profile, two
  lists and the documents filled from an earlier one) and, for the rest, from the page's own scripts saved with it;
  tested in jsdom with its components modelled, then verified against a live tenant
  ([what was verified](components/sites.md#what-was-verified-and-how)). That run found three gaps, fixed since (2026-10-08)
  and tested in jsdom only: question radio groups weren't read, a required document replaced under the same name was
  reported as failed, and an upload during which the page re-rendered waited out `uploadMs` on the old field.
  Check in one real application, with debug mode on: a question's radio answered through `fill_fields` and read back
  (and a follow-up question it shows read on the next `get_form`); the resume replaced under the same name and
  reported `ok`; if the page re-renders during an upload, the result says so at once. What sets the re-render off
  is unknown: record the calls around it if it recurs. Also still to see: the province list loaded after a country
  in the same call, a row added and removed, and Apply's errors. Never press Apply. Save a page with a question's
  radios and Apply's errors (`ezapply debug export`) as fixtures.
- **The hand-off checklist** (`checklist`, `handoff`, 2026-10-01): tested on the fixtures. Not yet seen on live
  Workday and Oracle sections, where the title matching and row counting are guesses until then.
- **Telling postings apart by requisition** (2026-10-01): tested on URLs and over MCP. Workday's application URL
  kept the job path (`…/Title_Req100010/apply/applyManually`) on every step of both Workday runs on the engine;
  the sign-in page itself wasn't seen (the user was signed in). If a step drops it, the check falls
  back to the tenant. Those runs never compared anything, though: both postings were captured on the
  employer's own careers site, with no tenant, so any application tab would have been credited to the active one.
  Most of the workspace's postings were captured off the form sites like that.
- **Tying postings to their applications** (2026-10-04): tested on URLs, saved-page link
  shapes, the matching table and over MCP. Run over the user's postings, it ties about two in five: two by their
  careers page's Apply link, one by an embedded Greenhouse board's `gh_jid`, and the rest by their own URL. The
  others (a school's job board, employers' own career sites, iCIMS, SuccessFactors) are bound to their tab on the
  first fill. SuccessFactors' career site joined the registry later; whether an employer's careers page in front of it
  links to it wasn't checked. Not yet seen live: the first-fill
  binding and its `postingBound` notice, title matching against real postings' roles (the title is read on every
  site's saved pages, including Workday's sign-in page), and whether the binding lost at a restart matters.
- **Debug mode, the companion's part** (`ezapply debug on`, 2026-10-01): tested over MCP on the
  Workday fixture and with a timed-out call, then used on live runs; the first one's records
  ruled out the waits in the slowdown below.
- **Debug mode, the adapter trace, markup and export** (2026-10-05;
  [adapters](components/adapters.md#debug-mode-the-adapter-trace)): tested on the Workday behavioural
  fixture, over MCP in the companion's e2e tests, and the export on a filled fixture page. A six-field fill took the
  same time with debug on and off on the fixture. Not yet run in a browser: the hooks on a real page (a site that
  replaces `fetch` or `console.error` itself keeps its own, unrecorded), the size of a real step's trace and
  markup through `executeScript` and the bridge, the failure screenshot, and the export on a real saved step. It's
  an adapter change ("One adapter change per live run" in [development](development.md)): the next Workday run
  goes with debug off first, and its timings must match the earlier runs' before the trace is trusted.
- **Fills twice as slow per field in debug mode's first live run, cause unknown.** Dropdowns took about 3.5–4 s
  each when filled (a 38-field step in 93 s, 11 dropdowns in 45 s), against about 1.8 s in an earlier run on the
  same tenant. Ruled out:
  - **The waits:** the debug records show every call received the same values as before (the six dropdown
    waits at 200 ms). Commented-out lines take the defaults, which are now those values.
  - **The fill code:** unchanged since d739492, used by both runs.
  - **The tab:** never hidden.
  - **Debug mode:** its first part records only in the companion.
  - **The page in general:** `list_options` opened the same tenant's dropdowns as fast as before (2.6 s for 3).

  So the extra time is in selecting and settling, not opening. Debug mode's adapter trace times every wait and
  its report lists those that ran to their maximum, so the next run with debug on shows which grew. One guess:
  the settle after each field (`afterFieldMaxMs`, 1.5 s) running to its maximum on a page that never goes quiet.
- **Parts of filling a signed-in Workday application.** The first real application
  was filled through to the review page. It found the stale-dropdown bug (fixed, with a fixture test that
  reproduces it; the fix itself not yet re-run live) and dates that needed a second entry (now automatic;
  cause unknown, not yet re-run live). The second reached the review page too and found
  more adapter bugs. The fixes the next two live runs (same posting) showed working were kept: split dates
  typed digit by digit (four `MM/YYYY` and two `YYYY` dates taken, the step advanced), typeahead entries
  matched one by one with bare names (12 of 15 skills under Workday's own names, the misses not stopping the
  rest), `go_next` noticing a move when every step is titled "Application", upload notices out of `errors`,
  add buttons named by section, and the Resume/CV field id taken from its label. The other fixes in that
  change (dismissing a listbox left open after a miss, `ok: false` while a field shows an error, `decline`
  matching, education dates with a day, the student seed questions, documents written before the form) were
  reverted: they were unverified, and fills had become several times slower (see Known issues). Not
  exercised yet: the remove controls for skill pills and attached files (`DELETE_charm`, `delete-file`; both
  hooks are on the saved My Experience step, but neither was pressed live). Repeatable rows' Delete was a guess
  that matched nothing live; it's now found from a saved step (`test/fixtures/live/my-experience.html`,
  employer details and the user's values replaced), but not yet pressed live. The Back button worked
  live in two runs on one tenant whose steps are all titled "Application".
- **Parts of filling an Oracle application.** The first live application (an employer's own domain, single page,
  in Chrome) was filled to Submit: text, pills, radios, dates, lists,
  uploads, and education and work entries through the inline form and Save worked. Its failures (list
  read-backs, a re-rendered city input, the postal-code search, a reformatted phone number, stale errors,
  "Saved" as an error, languages and a certification never added) are fixed and reproduced in the fixture,
  not yet re-run live. Still unseen live: language and license tiles, deletes, the multi-page flow (Next,
  Previous), the confirmation page, the permission prompt in Firefox, the options page's Grant access, and
  why the Cover Letter field was missing ([details](components/oracle-adapter.md#what-was-verified-and-how)).
- **Bringing the application tab to the front** (`tab.show`, 2026-09-30): tested against a fake `ext.tabs`
  and through the companion with a fake extension. Not yet seen live: Chrome switching tabs from the
  background, the page reporting visible within the 500 ms the extension polls, a minimized window reported
  hidden, and a step after a review page taking about as long as the steps before it. Check it in one run with
  no other change, opening a review page in the middle of the application.
- **Embedded applications** (2026-10-04): tested against a stubbed `webNavigation` and `scripting`, and
  through the companion with a fake extension whose careers-page tab holds a Greenhouse frame (the saved
  Greenhouse application). Not yet seen live: Chrome and Firefox injecting into a cross-origin frame by
  `frameIds` while the page around it is out of reach, `webNavigation`'s frame ids matching `scripting`'s, the
  second Set posting click asking for the frame's origin (and Firefox accepting it), Greenhouse's embed filled
  inside a careers page with its own submit guard, and how often embeds move to a new frame between steps.
- **Asking for a site's access from a form call** (2026-10-04): tested against a stubbed WebExtensions API.
  Not yet seen live: the window opening over the user's terminal, Chrome's and Firefox's own prompts after Allow
  access (Firefox's within the click), the call going on once granted, and the window closing itself.
- **Bringing the browser window to the front** (`forms.focusBrowser`, 2026-10-04): tested against a fake
  `ext.windows` and through the companion with a fake extension. Not yet seen live: whether Windows lets the
  extension bring the window in front of the terminal or only flashes its taskbar button (`windowFocused`
  true with `focused` false in the debug records), a minimized window restored, and whether focus is the cause of
  Workday's untaken dates. For that, two runs with debug mode on: one with the option off and the terminal in
  front, one with it on, comparing the dates and `shown.focused` in the records.
- **Keeping the workspace current** (2026-10-04): tested with real git against a local remote, on temporary
  templates and profiles, and over MCP. Not yet seen: `ls-remote` against GitHub with the app's token, the
  agent calling `workspace_changes` at a session's start and following the skill (asking first, re-importing a
  template from a resume dropped into `library/`, updating the
  profile from a diff without dropping what the resume never held), and how often a push that changes nothing
  indexed comes up.
- **Guidance from five live sessions** (`.tex` edited with the Edit tool only, the answer bank read
  before asking, resolved answers saved into the existing entry with `sensitive: false`): not yet seen in a
  session.
- **Capturing from embedded job boards** in a real browser: whether `allFrames` quietly skips frames the
  click's `activeTab` grant doesn't cover (as expected) in both Chrome and Firefox, and the board opening in
  its own tab when it can't be read. Tested with the frame-choice logic only.
- **The review and onboarding pages in a real browser:** checked in headless Edge with generated PDFs and a
  stand-in agent: the viewer, zoom, comments (whole words, kept on their words at another zoom), the changes since
  the last review marked on the page, sending; and onboarding's resume import and build with its preview, a
  drafted profile shown in the form and saved, the screening questions and preferences, and the narrow layout.
  Not yet seen: either page in Firefox; the tab closing after Send on this page (the browser refused in the
  headless check, as expected for a tab the test opened); a real agent working through the tasks in a chat; the
  extension, GitHub, repositories, cover letter and library steps against the real things; the OS's folder
  dialog (its PowerShell script parses; no dialog was opened); pdf.js on a large or image-heavy PDF.
- **The first LaTeX build from the onboarding page** once stalled for minutes in the headless check (the next
  run built at once), likely MiKTeX fetching packages on its first use; not seen again.
- **The reconnect alarm after a browser restart** in a real Chrome and Firefox (tested by loading the
  background against a stubbed API).
- **CI's `tex` and `firefox` jobs** haven't run on GitHub yet; locally, the TeX tests pass with MiKTeX with
  `EZAPPLY_REQUIRE_TEX=1`, and `web-ext lint` reports no errors or warnings.
- **A real GitHub login** (tested only against a mock GitHub), including connecting an existing app: adding a
  callback URL and generating a second client secret on GitHub's settings page.
- **Firefox in a real browser:** pairing, capture, the keepalive over several minutes, `tab.screenshot`.
  The first real load found the connection upgraded to `wss://` by Firefox's default CSP; fixed with an
  explicit CSP, awaiting a re-test.
- **Reconnecting a real browser after `ezapply chat` starts:** reconnecting within the grace period and
  delivering a capture queued while no chat was open are tested against a fake extension; `ezapply chat` ending
  with Claude, and nothing reaching the terminal, are verified with the real CLI and a stand-in `claude`.
  Not yet seen with a real Claude Code: its screen staying clean through a capture, a document build and a
  PDF render, and an earlier build's daemon being stopped on the first run after the update.
- **Opening in the user's browser for real:** browser detection and finding the program are tested with
  stubs. Not yet seen: each browser's program opening a new tab in the running window (Firefox with a
  `file://` PDF in particular), Opera's Windows install path, and a Chrome user with several profiles (the
  tab opens in the profile last used, which may not be the one with the extension).
- **The saving from turning auto memory off:** compare the token usage in the next session's transcript.
- **A full onboarding in Claude Code**, including installing MiKTeX through a tool hint.
- **`ezapply chat` with a real Claude Code:** tested with a stub `claude`. Not yet seen: Claude Code passing
  `EZAPPLY_CHAT_SESSION` on to its MCP relay (without it the session reads as unused and never restarts,
  which fails safe), the terminal state after ending Claude in Windows Terminal, PowerShell and macOS
  Terminal, and an npm-installed `claude.cmd` launched through the shell.

## The first Workday run on the engine
Workday, five steps, debug mode on, reached the review page. The first live run of the engine, with deterministic
autofill then in place ([removed](#deterministic-autofill-removed) since). The user stepped in twice. Calls: 42,
171 s in calls, 73 s of that with the tab hidden (step 1's first call, 72 s, ran while the review page was in front).
- **Multi-part dates failed again**: four `MM/YYYY` work dates and an `MM/DD/YYYY` graduation date read back
  right while Workday said they were required, and the user retyped them all. Cause unknown
  ([dates](components/workday-adapter.md#dates-typed-into-workdays-split-widget)). The fill result said
  `ok: true` with "Filled, but the page reports", so the agent retried twice, though the skill says not to
  retry a date.
- **No row could be removed.** Following the skill, the agent added a Certifications row for the profile's
  certificate, found the list (professional licences) didn't have it, and `remove_repeatable` said "No
  removable row". The empty row's required Certification blocked My Experience until the user deleted it.
  It isn't the new row alone: no row on the step was marked removable (two work, one education, three
  language, two website rows), so the row delete hooks (`rowDelete`: `panel-set-delete-button`,
  `deleteButton`, a button labelled "Delete…"), which come from knowledge, not a live page, match nothing
  on this tenant. Fixed from a saved copy of the step: the live button is a plain "Delete" with a trash icon
  ([removable rows](components/workday-adapter.md)). Not yet pressed live.
- **`screenshot` fails in Chrome**: "Either the '<all_urls>' or 'activeTab' permission is required." The
  extension then held only its sites' host permissions, which aren't enough for `tabs.captureVisibleTab`. It
  holds `<all_urls>` now; not yet re-run.
- **"How Did You Hear About Us?" is a nested list.** `list_options` returned nothing and `search_options` took
  6.5 s and returned the ten top-level categories whatever the query. Filling a path (`Job Boards > …`) listed
  the second level in the failure. The agent then picked the employer's own careers site as its own judgment, a factual
  answer about the user it couldn't know, and flagged it at the hand-off.
- **`go_next` on a step the user had already advanced.** The user pressed Save and Continue themselves, and the
  agent's `go_next` pressed it again on the fresh Application Questions step, which showed every field there as
  required.

## The second Workday run on the engine
Another posting at the same employer, the same evening, debug mode on, the browser kept in front (`focused: true` on all
19 calls). It reached the Terms and Conditions box on step 4 with no help from the user: every date was taken
the first time, and each step advanced on the first Save and Continue. 102 s in calls.
- **The agent's own fills:** "how did you hear" cost five calls and 16 s ("Job Boards" missed, two
  `search_options` of 6.5 s each returning the top level whatever the query, then "Job Boards > Other" on its
  own judgment). One `fill_fields` of 26.7 s held 14 skills (10 found, 3 more on a second try), the first role
  description rewritten for the posting, and the language: it picked one of the regional variants itself (the
  user had chosen it in the first run; it wasn't saved).
- **Its saved My Experience step** gave the live row Delete button and date markup (above). On it that language
  row's three levels read "Select One", although `get_form` read "Intermediate" for each just before Save and
  Continue. Unexplained: when the page was saved, and whether changing the language cleared its levels, aren't
  known.

## Known issues
- The TeX tests, including the default cover letter compiling to one page, pass with MiKTeX (latexmk) on
  Windows. Once, the default cover test failed while the other TeX tests passed. It didn't reproduce in
  four later runs, and the error wasn't captured. Possibly a MiKTeX first-use package download. If it
  recurs, capture the compile result's `hint` and diagnostics.
- **Slow fills on a live tenant.** In the third and fourth live runs a step with many
  dropdowns and a long skills list ran past the companion's 120 s `form.fill` timeout, and nine dropdowns
  took over 110 s. Suspected causes, none measured yet: the adapter's fixed waits per field (settling after
  each field, dropdown open and close waits, the typeahead's waits for its own results), the Workday tab
  hidden behind the review page (browsers slow hidden tabs), and a throttled laptop. A timed-out fill keeps
  running in the page and isn't logged. The unverified dropdown changes were reverted; the typeahead's
  waits were kept because its fix worked. The fifth run (after the revert) reached the review page with
  fills of about 2.5–3 s per dropdown; every wait is now tunable in `autofill-timing.yaml`
  ([waits](components/workday-adapter.md#waits-autofill-timingyaml)). The user's own file, with six dropdown
  waits at 200 ms, ran four live applications in one day with no dropdown failing to open; those values are
  now the defaults. Per-field timings are in debug mode's adapter trace now, not yet seen on a live run.
- **"Could not open the dropdown"** cost the fifth run 9 failed fields (about 5.5 s of waiting each) and 4
  extra calls. A listbox closed without a choice is now closed with a press on its own button when Escape
  doesn't do it, which covers 6 of the 9. Two runs on one tenant (with that press) still failed 12
  fields, each a dropdown whose own list had been read without a choice (`list_options` or a miss), and the
  agent's next call filled every one. The adapter now tries such an open a second time itself; why the first
  fails isn't known ([details](components/workday-adapter.md#finding-a-dropdowns-listbox)). The first live
  run with the retry (four steps) had no dropdown fail to open, and listed none before
  filling; nothing records whether the retry ran.
- **Reading a step before it rendered.** In those two runs `get_form` straight after `go_next` read an empty
  step four times. `go_next` and `go_back` now wait for the new step's fields (`stepFieldsMs`), and `go_back`
  sees a move when every step is titled "Application" (it waited out 12 s and said `moved: false` on all five
  Backs). In the run with the retry both `go_next`s returned in 1–3 s and the `get_form` right after read the new step
  each time. `go_back` not yet tried live.
- **Fill speed in the run with the retry** (Workday, the first live run of the changes in d739492): 9
  fields in 3 s; a step of two work rows, an education row, two websites and a nine-entry skills list (about
  20 fields) in 22 s; 4 questions in 3 s. No call timed out.
- **The cover letter left out.** Both of those two runs uploaded only the resume into Workday's single Resume/CV
  field (`multiple: true`), and the user had to ask for the cover letter. `upload_file`, `go_next` and
  `get_form` now report approved documents not attached (`notAttached`), and the apply skill says both go
  into that field. Seen working live: on a later Workday form the agent uploaded the cover
  letter into Resume/CV after the hint. Two flaws seen on Oracle (twice): the agent sent both uploads
  in parallel, so the resume's result listed the cover letter, whose upload was queued right behind it; and
  the hint names Workday's Resume/CV on an Oracle form.
- **A Workday field of study that searches nothing.** On one tenant's form, `search_options` on the multi-select
  "Field of Study" returned only its two top-level entries ("Partial List (First 500 Entries)", "All") for
  the stored field and for its first four letters, and the field failed with "No option matches" in the step's
  fill but was taken when filled alone a few seconds later. Not explained.
- **Language rows emptied.** In the first of those two runs two language rows, filled with
  `ok: true` before Save and Continue, were empty when the agent came back to the step. Not explained; the
  skill already re-checks steps when coming forward.
- **Review answers nobody waited for.** The first `review_wait` ran past 120 s, Claude
  Code moved it to the background, and the answer came back as a task notification. After that the agent
  called `review_open` three times without `review_wait`, and once told the user to reload the open page to
  see a rebuild (the page serves the bytes read at `review_open`). The user's change requests waited in the
  companion until they asked why they'd been dropped; `review_wait` then returned at once. Nothing tells the
  agent that an answer arrived with no wait attached. Now one tool, `review_documents`, opens
  the page and waits ([why](components/documents.md#review-before-attaching)); not yet seen live.

## Deferred
**More of the most common providers.** iCIMS, SmartRecruiters, Taleo and BrassRing couldn't be
built from public pages: their applications sit behind candidate accounts, block headless browsers, or show
a bot challenge, which ezapply doesn't work around. Each needs pages saved from a real application
([sites](components/sites.md#why-these-three)); SuccessFactors was built that way. None is planned yet.

**Removing the upgrade shims.** Two pieces exist only for installs from before the background daemon went:
moving `~/.ezapply/daemon.json` to `config.json` (and `init` deleting `daemon-state.json`), and `ezapply chat`
shutting down an earlier build's daemon found on its port. Both can go once no such install is left.

**Posting extraction's own Workday code.** `extractWorkday` in `postings/extract.ts`, with the
`WORKDAY_POSTING` hooks, predates the site registry. Moving it behind a registry hook would make posting
extraction modular as the form adapters are. Small, and nothing needs it yet.

**DecisionProvider (e.g. Jev).** Config has `decisions.provider: "none"`, and no decision tools are
registered. The design, kept from the original plan:

```ts
interface DecisionProvider {
  id: string;                                         // "none" | "jev" | ...
  available(): Promise<boolean>;
  decide(req: {
    state: string | object;
    questions: Record<string,
      | { type: "yesno";  instructions: string | object; criteria?: { yes?: string; no?: string } }
      | { type: "choice"; instructions: string | object; options: Record<string, string | null> }
      | { type: "score";  instructions: string | object; levels: string[] }>;
  }): Promise<Record<string,
      | { type: "yesno";  p: number }
      | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
      | { type: "score";  score: number; probabilities: Record<string, number>; confidence: number }>>;
}
```

- **Adding a model** is one new file and one config change, with no changes to tools or skills. With
  `none`, `available()` is false and the skills use Claude's own judgment. They'd be written as "if
  `suggest_answers` is available, call it first and treat its output as advice".
- **A `jev` implementation** over TypeSafe's `POST /v1/systemone` (yes/no, `choice`, `score`) through
  `@typesafe-ai/sdk`. Notes from research:
  - Choice takes up to 255 options and score up to 10 levels, with calibrated `probabilities` and
    `confidence`. Questions in one request run in parallel, so batch one request per form step.
  - The limit is 32k tokens for the state plus the longest question: send only the question and the
    profile slice it needs.
  - It reads literally and is weak on negation, numbers, dates and counting, so keep polarity as its own
    question and do arithmetic in code.
  - It isn't hardened against manipulative text: never put posting text into its state.
  - Pin the model version once thresholds are tuned, and log which model answered.
- **Where it plugs in:** `suggest_answers` (matching to the answer bank, the polarity check, picking the
  option, with confidence-based routing to auto, Claude's review, or asking the user), then claim
  verification in indexing, bullet checks in tailoring, and requirement × claim coverage.
- **Before enabling it:** build a labelled set of about 150 real screening questions from
  `form-log.jsonl` and tune the thresholds on it.

## Open questions
1. **Resume page size:** Letter or A4 (sets the default for bundle normalization). *Assumed: Letter.*
2. **Contributions to other people's public repos:** *assumed yes*, added by URL, with claims limited to the
   user's own commits.

To answer from the next live runs:

3. **Binding an `unconfirmed` tab trusts the first tab that changes.** The safeguard is the one-time
   `postingBound` notice with the page's title ([which posting](mcp-tools.md#forms)). Is a notice enough, or
   should the first change on an unconfirmed tab be refused until `posting_activate { tabId }`? *Built: the
   notice.*
4. **Bindings live in memory,** so a restart of `ezapply chat` loses them. The stored `application` still matches
   tabs on its tenant and job, and a tenant-only one by tenant. Enough?
5. **Title matching on real roles.** Compare the roles the agent records with the titles the pages show (every
   debug record of a read holds `FormSchema.job`), and tune `compareTitles` if real pairs come out `unsure` or,
   worse, `other`.
6. **Postings captured from one job-board results URL** (several from a single search page) can't be told
    apart by URL. That's a capture problem, outside the matching.

## Removed
### Deterministic autofill (removed)
`autofill_step` filled, without the model, what the profile and the answer bank settled on a step: hinted profile
fields, work, education, language and link rows (adding them), Oracle's and Dayforce's item forms, and questions
worded as an answer-bank entry. It was removed on 2026-10-07 with its MCP tool, its `forms.autofill` setting, the
hand-off's `automatic` and `replaced` lists, its part of the debug record (`notes.autofill`, the index's counts)
and of `ezapply debug report`; each step starts with `get_form` again. The code and its reference page are in git
history before that change.

*Why:* in the debugged live runs it filled about 45% of the fields (59% on Workday, about 27% on the
hosted boards), but the agent still made at least one `fill_fields` call per step for the rest, so it saved
values, not turns, and every turn re-sends the conversation. Its token saving was never measured. Its mistakes were
the costly kind: rows and levels were placed by label patterns, so a SuccessFactors language level, a text field
labelled with a 1–10 scale, got a word ("Native"); the read-back matched, so it passed as a clean fill, and the
agent left it. Reading labels is what the model does well, and every new site brought
wordings the patterns misread. Strict option matching in the adapters (`strict` fills, `protocol/src/match.ts`), built only for it, went with it.
What stayed: the profile hints on fields,
which the agent uses.

## Where the build departs from the original plan
The original design plan (`plan.md`) was removed on 2026-09-27 and is in git history. This table keeps
what changed from it, and each linked page gives the reason.

| Plan | Built |
|---|---|
| GitHub device flow; user registers the app by hand | App Manifest flow (one click) + OAuth web flow with callbacks on the companion ([github-and-repos](components/github-and-repos.md#github-app-githubservice)) |
| SQLite application log, `app_status` / `app_search` tools | Per-posting `meta.json` + `form-log.jsonl`; `postings_list` with a company filter ([postings](components/postings.md#no-database)) |
| Long-running daemon started by hand or at login | No daemon: the companion runs inside `ezapply chat` (after a stage where `ezapply mcp` started it on demand and it stopped when idle) ([architecture](architecture.md#processes-and-lifecycle)) |
| `ezapply init` then a manual daemon start, a pairing code, `claude` | `npm run setup`, then Claude onboards; pairing without a code |
| Content script declared for Workday hosts | Adapter injected into the MAIN world on demand ([workday-adapter](components/workday-adapter.md)) |
| A Workday adapter | One adapter engine with a definition per site: Workday, Oracle Recruiting Cloud, Greenhouse, Lever, Ashby, Phenom, Dayforce, SAP SuccessFactors ([adapters](components/adapters.md)) |
| Chrome only | Chrome and Firefox ([extension](components/extension.md#builds-npm-run-build--w-ezapplyextension)) |
| One TeX engine for everything (latexmk + XeLaTeX) | Per file: `% !TEX program`, else `tex.engine` (default `auto`) ([documents](components/documents.md#tex-engines-texenginests)) |
| Playwright tests of the extension with React harnesses | jsdom tests against a behavioural fixture and live snapshots; no Playwright (the recon scripts that used it were for the first adapter builds and are gone) |
| Changesets, per-package READMEs, `ezapply migrate` | Not used; migrations run in `ezapply init`; documentation lives here |
| Cover letter template generated in onboarding | A shipped default, the user's LaTeX, or rebuilt from an example letter |
| The user runs `claude` in the workspace | `ezapply chat` (the workspace launcher), which starts Claude and gives it a fresh session when another posting is captured, so finished work isn't re-sent every turn ([cli](components/cli.md#chat-chatts)) |
| `docs/adr/` decision records | None: `references/` records the current design with its reasons |
