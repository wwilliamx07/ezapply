# Development

## Repo layout

```
ezapply/
  CLAUDE.md                 rules for working on this repo (keep references/ current, todo.md lean)
  references/               this reference (source of truth)
  README.md                 quick start
  todo.md                   work not yet built, ranked (references/ describes what's built, even in part)
  package.json              npm workspaces, scripts
  tsconfig.base.json, tsconfig.tests.json, biome.json, vitest.config.ts, .gitattributes
  .github/workflows/ci.yml
  packages/
    protocol/               shared schemas            → components/protocol.md
    companion/              MCP server, bridge, services (runs inside `ezapply chat`) → components/companion.md
    cli/                    the ezapply command, workspace templates, skills → components/cli.md
    extension/              the browser extension     → components/extension.md
    ui/                     the review and setup pages (React) → components/ui.md
```
Each package has `src/`, `test/`, and builds to `dist/` (the extension also to `dist-firefox/`).

## Tooling
- **Node** ≥ 22.12 (CI uses 24). npm workspaces; no other package manager. npm was chosen over pnpm because it
  ships with Node, so setup installs nothing extra; switching later would be cheap.
- **TypeScript 7**, strict, project references: `tsc -b packages/protocol packages/companion packages/cli`.
  If type errors look stale after a `tsconfig` change, delete `packages/*/tsconfig.tsbuildinfo`.
- **esbuild** bundles the extension (`packages/extension/build.mjs`) and the UI package's pages
  (`packages/ui/build.mjs`; React 19, pdf.js, [ui](components/ui.md#the-build-npm-run-build--w-ezapplyui)).
- **Biome** lints and formats (2-space indent, 120 columns, double quotes, organized imports). It skips
  `dist`, `dist-firefox`, the live HTML snapshots in `test/fixtures/live/` (third-party markup), the golden
  schemas in `extension/test/golden/` (written by the test), and `ui/src/review/textlayer.css` (pdf.js's rules,
  kept as they came).
- **Line endings:** `.gitattributes` pins LF everywhere (Biome rejects CRLF). On Windows, after a fresh
  clone with the old settings, renormalize with `git rm --cached -r . && git reset --hard` (on a clean tree).
- **Vitest** runs every `packages/*/test/**/*.test.{ts,tsx}` (20 s default timeout). A test that needs a DOM says
  so in its first line (`// @vitest-environment jsdom`); the UI's component tests use Testing Library.

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | `npm install`, build, `ezapply init` |
| `npm run build` | tsc build of protocol, companion, cli; then the extension bundles and the UI package's pages |
| `npm test` | build, then vitest |
| `npm run typecheck` | all packages (the extension and UI with their own `tsconfig.json`) and `tsconfig.tests.json` (tests) |
| `npm run lint` / `npm run format` | Biome check / write |
| `npm run ezapply -- <cmd>` | run the CLI |

## Tests

| File | Covers |
|---|---|
| `protocol/test/rpc.test.ts` | RPC round trips, validation, errors, timeouts, a debug trace beside a result or error reaching only the caller that asked |
| `protocol/test/workday.test.ts` | Which hosts count as Workday (not the marketing site or employee tenants), tenants from myworkdayjobs hosts and myworkdaysite paths |
| `protocol/test/oracle.test.ts` | Which pages count as Oracle (Oracle Cloud hosts and employers' domains, by path; not other "sites" pages or http), tenants as host and site number, `siteTenant` for both sites, a job's path without language or application pages |
| `protocol/test/sites.test.ts` | The registry names exactly the form sites `SiteId` knows; the extension holds every site (`<all_urls>`); every site has a signature, in registry order; Greenhouse's boards (old, new, EU, the embed; not greenhouse.io's own site or a careers page with `gh_jid`), its board and job from the path or the embed's parameters; Lever's and Ashby's company and job, and canonical paths without the application page; Phenom's apply pages on any host by their last path segment and `jobSeqNo`, whatever comes before (`/ca/en/`, `/global/en/`, none; not its job pages, a bare apply path, http, or another path), the host as tenant and `jobSeqNo` as job, `hvhapply` as `apply`, and on a job page the host as tenant and no job; Dayforce's postings and applications by path on `*.dayforcehcm.com`, with or without a locale (a client namespace as short as a language code included; not the search page, a non-numeric id, http, the older CandidatePortal or another host), the client as tenant and the posting id as job, the canonical path from the client to the id, and the search page's client; SuccessFactors' career pages on any data centre's `career<n>` host (the older `sfcareer` and a signed-in `portalcareer` included; not the employer's careers site, http, SuccessFactors' other apps, the upload popup's page or a look-alike host), `company` as tenant and the requisition as job, and neither on a signed-in page |
| `companion/test/e2e.test.ts` | A real companion on a free port: HTTP guards, `workspace_changes` and `workspace_change_mark` over MCP, `/health` with `mode: "chat"`, no control routes (404), bridge handshake, pinning, Firefox origins, the browser reported in `hello` (in `browser_status`, "connected in Edge" in `workspace_check`, kept after a disconnect), the pairing window opened by `extension_pair`, `extension_pair`/`replace`, `posting_active` waiting for a queued capture after a start and giving up after the grace period with the reconnecting hint, the `ChatHost` change events from a capture and `posting_activate`, pairing written into `config.json` without undoing edits made meanwhile, `github_login` with a stub opener (opened, naming the browser, and not; `app: "existing"` returning the callback URL), capture → MCP, invalid posting ids, the review page (the UI package's page and script with its CSP and no inline script, the token traded for a cookie on the review's path, its state and PDFs and a download read with the cookie, nothing without it, an answer from another origin or without one refused, a body that isn't JSON refused, events on answering, an answer with a request and comments returned to the agent without the comments' places and an empty comment dropped, the answered state with the places, a second answer refused with 409, `reviewed.json` written; then with real PDFs: the checks and no history at first, `pdf_text { sinceReviewed }` reporting a first review, the same bytes reported unchanged, then changes word by word to the agent and the old text to the page, and the last answer kept as approved; waiting, a replaced or answered review) and the approval gate on `upload_file` (refused before approval, allowed after, refused again for a rebuilt file, never for `library/`), `notAttached` naming an approved cover letter after only the resume was uploaded and again on reaching review, and gone once it's uploaded, `attach_mode_set` keeping the rest of the config, and the form tools driving the **real Workday adapter on the shared jsdom fixture** behind a fake extension: `list_options` for several fields (one unknown), lean fill results (a clean success bare, a matched option's full text kept), fill, clear an old attachment, upload, add and remove a row, next and refusal, back from review and forward again, the log and status; lean `get_form` with its filters; tab choice by the active posting's tenant and `postingMismatch` with nothing logged; the **real Oracle adapter on its fixture**: an Oracle posting (site, tenant; a capture on its application pages is the same posting) choosing its Oracle tab over a Workday tab in front, a fill credited and logged, `go_next` refusing Submit, and the Workday tab then reported as another tenant; debug records of a read and a fill (the adapter's trace of each bridge call, the page before the first, a failed dropdown's trace and its saved section and list, none of it in a tool result, and the report's trace sections); a fill on another posting's tab refused like `go_next`; `tab.show` before each call: the tab switched to (logged once), not during a review, `tabHidden` for a minimized window with `forms.focusBrowser` off, an extension built before `tab.show`; `focusWindow` sent only on calls that change the page, from the config (on by default, off, a bad value as on), never during a review, `windowFocused` and `windowInBackground` in the log, and `browserBehind` with the option off and when the system kept the window behind; an application embedded in a careers page (the **real Greenhouse adapter on the saved application**, in a frame): chosen over another employer's Workday tab, credited by the job its `gh_jid` names, every call and `tab.show` naming the frame, `go_next` refused at Submit, found again under a new frame id after a reload, and `posting_activate { tabId }` binding the embedded application; a site's notes given on the first `get_form` of a chat session, not on later reads in it, and again in a new session |
| `companion/test/onboarding.test.ts` | A real companion and the onboarding page: the page opened by `onboarding` and its cookie on `/onboard`, nothing without the cookie or from another origin, the eleven steps, an unknown task refused; tasks handed to the waiting call in order with their `how`, a report waiting for the next in the same call and its note on the page, a task never reported given again, an unknown task id `not_found`, `waiting` when nothing came, `done` when the user finishes and the page reopened by the next call, not opened again while its events are listened to; the link given at once when no browser opened; the profile written in place (its comments, the user's own keys and a list kept, a cleared field removed, a write the schema refuses not made and its errors by path); answers set in place by id with the file's top kept and unknown ids skipped; preferences under their headings with another section kept and the attach mode set; library files saved under their names, never over another, a `.exe` refused, and the PDF route refusing anything outside `templates/`; which repos are suggested |
| `companion/test/match.test.ts` | Finding a posting's application from its capture (`postings/application.ts`): the one job its links lead to (links without a job ignored), the requisition's among several, an embedded board's job from the careers page's URL, a Phenom job page tied to its apply flow by the Apply link and the flow's steps matched to it by `jobSeqNo`, nothing for a page leading to no form site, a posting on a form site as its own application, a title refused as a requisition; which posting a tab belongs to (`forms/match.ts`): the site the extension found on the page used where the URL names none (a Phenom job page matched by its tenant, its apply page by `jobSeqNo`), job first, another site refused, a binding held while the tab stays on its employer, then the page's requisition and the tenant, the title only where no job id is known, titles compared by significant words, the posting's job from its application, its URL or a requisition that looks like one |
| `companion/test/checklist.test.ts` | `stepWarnings`: rows against the profile's lists both ways, Oracle's saved items and link fields, Add Experience and Add Education under one section told apart, an open form's Save skipped, files this application didn't upload; `handoff` from a log |
| `companion/test/extract.test.ts` | Posting extraction and metadata; company from ATS, LinkedIn and Indeed URLs; Workday locale dropped from canonical URLs; an Oracle job's language and application pages dropped; myworkdaysite tenants and embedded frames; an Oracle posting's tenant, and its company from the title rather than an Oracle Cloud host (nor a SuccessFactors career host); a SuccessFactors requisition kept with its employer in the canonical URL; the site the extension found on the page taken over the URL's (and the tenant read as that site does), a `generic` one leaving it to the URL |
| `companion/test/documents.test.ts` | Page-range parsing; PDF merge (ranges, bookmarks, metadata, normalizing, and a resized page keeping its link with its rectangle moved), render with preview, text, images → PDF, compression, encrypted or broken input, `open_file` through the opener, path guards; `% !TEX program` parsing (both spellings, 20-line window, unknown values), pdfTeX-only detection, engine resolution order and no-fallback errors (engines mocked); TeX compile, page limit with the `overflow` text, snapshots, errors with lines, no shell escape, the default cover template building under auto, and a pdfTeX-only resume building with pdflatex over `tex.engine: xelatex` (real-TeX parts skipped without an engine or without pdflatex, unless `EZAPPLY_REQUIRE_TEX=1`) |
| `companion/test/texlog.test.ts` | TeX log parsing |
| `companion/test/profile.test.ts` | Answer seed, profile and answers validation |
| `companion/test/templates.test.ts` | Template import (incl. content files, adding `% !TEX program = pdflatex` to a pdfTeX-only main file and keeping an existing comment; workspace sources outside `library/` refused; a Claude scratchpad refused, and `inScratchpad` on Windows and POSIX paths; a single `.tex` file from `library/`, its edits seen and the folder's other files ignored; a single file that `\input`s others refused), cover default and examples, finding content files through `\input`/`\include`/`\subfile`, `template_set_main` recording them and refusing paths outside the template |
| `companion/test/github.test.ts` | Against a mock GitHub with single-use refresh tokens: app manifest → install → OAuth login, connecting an existing app through the companion's form (state required, nothing stored before login, app identified from its installations), wrong credentials leaving the current app intact, reading an app name from a pasted address, paginated repo listing, callbacks without an issued state rejected, token refresh, one refresh for parallel callers, an unreadable stored token, the port mismatch |
| `companion/test/repos.test.ts` | With real git: read-only clone, first sync = index everything, changes since the last index, contributions, claims check, evidence hashes stamped (comments kept) and a changed line range flagged, `claims_list` text (repo headings, impact only when set, a folded claim on one line, an unparsable file named, a folder without claims left out), concurrent syncs, the token in git's environment and never its arguments (`run` spied), malformed repo names |
| `companion/test/freshness.test.ts` | The workspace check with real git and a local remote: nothing while indexed repos are at their head; a push reported without fetching, `done` refused, `later` hiding it until the chat ends and a newer push showing again; unreachable and logged-out repos under `notChecked`; a deselected repo's knowledge reported and deleted on `done`; `sourceHash` at import, a build in the source folder ignored, an edit reported and `done` taking it as current; a re-import raising `resume-edited` with only the changed lines in its diff, and `done` refreshing `templates/.synced/`; a template from before `sourceHash` recorded silently despite its added `% !TEX program` line, and reported once it differs; a moved source folder under `notChecked`; the profile's contact (not its work history) raising `profile-identity`; a template imported from a scratchpad copy raising `template-untracked`, a newer resume in `library/` raising `library-template` with its path, and importing it ending both and raising `resume-edited`; a scratchpad import naming the library file with its text and dropping `importedFrom` on `done`; a library document that isn't a template quiet after `done` until it changes; a stale id refused; `unifiedDiff` |
| `companion/test/forms.test.ts` | `FormsService` against a slow stub bridge: parallel calls on one tab run one at a time and in order, each reading its own field, while another tab isn't held up; a failed call doesn't stop the next (fails without the per-tab queue); `autofill-timing.yaml`: defaults without it and from the template, its waits scaled and sent with every call with its fill timeout, re-read per call, mistakes falling back and listed in `get_form`; debug mode: a call that timed out still recorded, nothing when it's off, `debug/` kept under its size, an upload's contents dropped, each adapter call asked for its trace and the markup `debug.markup` says (an older extension's missing trace noted), and markup and screenshots taken out of the record into files of their own |
| `companion/test/util.test.ts` | `KeyedQueue` order and independence, log rotation, which URLs the opener accepts, `findBrowser` per OS (App Paths with variables, install folders, Chromium not taking Chrome's key, `.app` bundles, PATH) and `reg query` parsing, the desktop opener (pages and PDFs as `file://` URLs in the reported browser; the system opener without a browser, for an unknown one, when its program is missing or won't start, and for `.html`; non-loopback URLs refused), `updateAppConfig`, an earlier build's `daemon.json` moved to `config.json` without its idle timeout, `forms.focusBrowser` on by default and a bad value falling back to on |
| `companion/test/version.test.ts` | `COMPANION_VERSION` equals the package version |
| `protocol/test/textdiff.test.ts` | Words and their places in the text, a hyphenated word across a line break joined (not a capitalised one), ligatures, quotes, dashes and soft hyphens normalised; the word diff (none for equal lists, a replacement, separate hunks, one side empty, repeated words, two documents sharing nothing as one change); reflowed text as no change, changes described with their page and the words before them on that page |
| `ui/test/review.test.tsx` | (jsdom) The page text joined as `pdf_text` does and a stretch of it mapped to the items' parts; the changes marked per page with what they replaced, a removal placed before the next word or after the last; a selection's boxes merged per line and widened to whole words; the answer (approved without a request or comment, the others with theirs); the panel: the page-limit and text-layer checks, an unreadable file, unchanged since approved, the list of changes showing each one's place when pressed, a comment edited and removed, and a request for the whole document |
| `cli/test/workspace-init.test.ts` | `.mcp.json` stdio entry without a token, `EZAPPLY.md` command paths and sections, skills installed under `ezapply-` names with matching `name:`, a one-line `description` and the frontmatter closed on its own line (a reflow once broke all but one), old bare-named ezapply skills removed while a user's own is kept, `autoMemoryEnabled: false` added unless the user set it (other settings kept), `EZAPPLY.md` without start/stop/restart commands and with `claims_list` at the first request, the `CLAUDE.md` import and `agentFileStatus`, default cover template install and no-overwrite, `autofill-timing.yaml` written once with every wait commented out and the user's edits kept, the launcher (POSIX and Windows forms) |
| `cli/test/skill-calls.test.ts` | The call shapes in the skills and `EZAPPLY.md` (`tool { parameter, optional? }`) against the tools' registered schemas (names, required and optional, nested lists, enum values), and a shape in every file that mentions a tool with required parameters; the shape parser and checker on their own |
| `cli/test/mcp-relay.test.ts` | With a real companion, the relay relays requests and notifications and tags them with the chat session, which counts only tool calls, per session; with nothing listening, every request answers `NOT_RUNNING` (nothing is started); a request the companion received is never re-sent when the connection breaks; a slow response is waited out |
| `cli/test/chat.test.ts` | `runChat` with a stub `claude` (`claude-stub.mjs`) and a fake `ChatHost` whose changes fire events: restart with a fresh session and no arguments once another posting is active, right after a running call ends; no restart for an untouched session, the same posting, or `restartOnCapture: false`. `hostChat` with the real companion: MCP answers while Claude runs, a capture restarts Claude at once, the port closes when Claude exits; a second instance refused without starting Claude; an earlier build's background daemon shut down and its port taken; another program on the port reported. `findClaude` on Windows and elsewhere, and `EZAPPLY_CLAUDE` |
| `cli/test/quiet.test.ts` | A child process set up like `ezapply chat` (`quiet-child.mjs`: `guardProcess`, `quietProcess`, a companion capturing a page with unparseable CSS, a throwing timer and a rejected promise) writes nothing to stdout or stderr, keeps running, and has it all in the log |
| `companion/test/chat.test.ts` | `ChatSessions` counts (used, in flight, ending twice counts once), call-end listeners, `tools/call` counting in batches, accepted session ids |
| `cli/test/debug.test.ts` | `ezapply debug`: on and off keeping the rest of `ezapply.config.json`, the report of the newest session (or none), `clean`, `export` of the newest session's page, and the workspace agent denied reads of `debug/` |
| `companion/test/debug-export.test.ts` | `ezapply debug export` on a filled Workday fixture's saved page: no values, profile strings or tenant left, and extraction from it gives the same fields and ids; a missing page; which profile strings are replaced |
| `cli/test/cli.test.ts` | The built CLI: a bad `--port` and a damaged `config.json` give one line and what to do, no stack; `start`, `stop`, `restart`, `daemon`, `pair` are unknown commands; `status` says ezapply isn't running outside a chat |
| `extension/test/workday.test.ts` | Adapter extraction (add buttons named by section, upload notices kept out of errors), every filler, two dropdowns in a row each reading its own options (the previous listbox lingering, no `aria-controls`; fails on the old logic), dropdowns that behave as live ones (`liveDropdowns`: the next one opening after a miss and after `list_options`, no list reopened after a choice; with `dismissedIgnoresNextPress`, the same dropdown filled after `list_options` and after a miss, through the second open), dates typed into a split widget that takes digits only in keydown and an honest failure when it ignores them (`dateWidget`), a skills list filled entry by entry against a delayed search with nested option hooks (bare names, acronyms, `unmatched` with suggestions), `search_options` waiting for its own results, skills prompts as live variants (`skillsPrompt`: a list with checkboxes that ticks a search's only result on Enter, kept rather than unticked; a category menu shown before the results, waited past; both fail on the old logic), `answersQuery` (a category menu or an unfiltered list is not a search's results), `matchOption` (parentheticals, a prefix or substring that singles out one option, repeated labels, no guess between two "Yes" options), `next()` advancing when every step is titled "Application", `next()` returning once a step whose fields render late shows them (`questionsStepRenderMs`), `back()` seeing a move with same-titled steps without waiting out the timeout, a date entered again while the field shows an error and once otherwise, removing pills (charm and keyboard) and attachments (with a confirmation dialog), removable rows and removing one (with a confirmation dialog, later rows renumbered), going back from review with entries kept (and refusing on the first step), uploads not fooled by a same-named leftover file, next/refusals, submit guard, the waits the companion sends taking effect (a shorter no-results wait returns sooner) and `null` restoring the defaults, against the behavioural fixture (jsdom) |
| `extension/test/trace.test.ts` | Debug mode's adapter trace on the Workday fixture ([adapters](components/adapters.md#tests)): nothing installed without it, every hook off after it, a dropdown's events and named waits, failure markup, branches, the page's errors and requests |
| `extension/test/workday-live.test.ts` | Page detection on live snapshots (posting, start-choice, sign-in) |
| `extension/test/oracle.test.ts` | The Oracle adapter against its behavioural fixture (`oracle-fixture.ts`, jsdom): extraction (the phone's two fields, pills as radio or checkbox-group, date parts, add buttons, a timeline entry as a removable section, Welcome Back as start-choice), text, pills (a pressed one not pressed again), radios, textarea and checkbox fills, the read-only email refused, lists filled in page order so a city list loads for the country chosen first (its input re-rendered on opening, its option labelled "Kanata, Ontario" but shown as "Kanata", a "required" error lingering after the choice: all ok), a postal code found by searching the part before the comma, a list that searches late and only when its text changes (`liveSearch`: the unfiltered list typing shows first waited past, a text the widget kept from a dropped search cleared and typed again, and a list that didn't show within the open waits searched anyway; all fail on the old logic), a phone number the page reformats, a miss returning the options and leaving the old choice (Escape never sent to a closed list), listing and searching, a date through three lists, uploads (a profile's resume removed first), several additional documents and removing one, unselecting pills, an inline Language form with Save (refused while incomplete; "Saved" a notice, not an error) and deleting its tile, a timeline delete through its hover button, another link row, `next` refusing a single page's Submit, the multi-page flow (validation error, Next, Previous, Submit refused), the submit guard, Use My Profile |
| `extension/test/oracle-live.test.ts` | Snapshots: a live job page (posting, Apply, tenant), the live email step (auth; email and terms, never the honeypot), and a saved single-page application (every field's kind, id, hints, options; Submit the only button; no false errors) |
| `extension/test/golden.test.ts` | Golden schemas (`test/golden/*.json`): `getForm()` of every Workday and Oracle fixture state (a step as built and with each fixture option, after an add, a refused Next, review; the single page, each section of the multi-page flow, Welcome Back, a resume on file, a language form open and saved) and every live snapshot, equal to the JSON written before the adapters moved onto the engine. `UPDATE_GOLDEN=1` rewrites them after an intended change |
| `extension/test/sites.test.ts` | Conformance, for every registry site on a page of it (the Workday and Oracle fixtures, the saved Greenhouse, Lever and Ashby applications, Phenom's step 2, Dayforce's Candidate Info, SuccessFactors' application), each in a jsdom window of its own: a definition, a bundle entry and a test page exist; every wait is set; every field has a prompt and a kind; ids equal on two reads; the guard blocks a synthetic click and Enter on its Submit, and `next` never presses it; signatures: every saved live page of every site (`SAVED`) matches its own site's signature and no other's, and a careers page that only links to boards, loads their embed scripts, frames them or has a form of its own matches none |
| `extension/test/sites-live.test.ts` | Extraction from the saved live Greenhouse, Lever and Ashby applications: the one page with Submit as the way on, tenant and job from the URL, each kind of field with its prompt, ids and hints (Greenhouse's own fields and its custom questions; Lever's cards, survey questions, location search, a consent checkbox; Ashby's paths, Yes/No buttons, the texting consent apart), never the phone flag picker's search box; a second Ashby page (`ashby-groups.html`) whose radio and checkbox groups lack the field-entry class: all 22 questions read, a radio and a checkbox group filled and read back; Phenom's saved steps: step 1 (the resume above the form, hinted contact fields, the step and the job from the header, Next not taken for Submit), step 2's rows as removable sections with their add buttons, month dates, the school typeahead, language levels and the skills label, a refused Next's errors on the page and on fields, step 3's questionnaire keyed by prompt, `next` refusing step 1 without a resume (nothing pressed), and Submit told by its words; Dayforce's Candidate Info (`dayforce-candidate-info.html`): the step bar's place and title, the job and requisition from the header, Personal Information's fields keyed by their form paths and hinted, the account's email read-only and unhinted, lists not read-only, each phone as its dialling code and number, the documents under their headings without Import Resume, the Add buttons as forms and Update as a save, Submit by hook and words (never an Update or Next), the posting and confirmation told by the page's text and not its scripts'; and records built from the portal's markup inside it: an open one as a hinted section with its Update and its fields' errors, a saved one as a saved item deleted through its dialog; SuccessFactors' application (`successfactors-application.html`): the one page with Apply as the way on (`lastPage`), the job and requisition from the heading and hidden field, no tenant from a signed-in URL, the profile's fields keyed and hinted by name, the account's username left out, lists as dropdowns with lazy options keyed by prompt, each list's rows as numbered removable sections without hints, dates with their parts, a collapsed section still read, the Add buttons as rows, the documents (Additional Documents taking several), Job-Specific Information by name with the typed signature unhinted, Apply told by hook and words and never Save, the welcome's thanks not taken for a confirmation; and, with juic's registry, picklists, the upload popup and the delete dialog modelled from its scripts: a list listed, searched (on the server first) and chosen through its component and hinted by its field name, a miss with the options and a disabled list refused, a row removed without a dialog, documents uploaded beside others and replacing the resume, an optional cover letter refused until removed, then removed after its dialog, the required resume only replaceable; the resume replaced under the same name, told by its tick; an upload during which the whole application re-renders found again by its label and reported (`ok` with an error when the new field shows the file, a failure when it does not); a question's juic radio group (`rcmFormQuestionLabel`, `span[role=radio]`) read with its label, options and required mark, chosen through its click and read back, a miss naming the options |
| `extension/test/widgets.test.ts` | The shared drivers on minimal markup: text past a value tracker, a reformatted phone, read-only refused; select placeholder, a prefix taken and a miss; radio, checkbox and checkbox group with removal; date and month inputs; passwords never filled; react-select listed, chosen and read through a stale stored fiber, multi-select add and remove, a list that loads only while the page-held menu is open (opened, searched, chosen, then closed and cleared; a miss ending with the load), and a list with no options until you type whose page confirms a choice later; toggle buttons; a search field that searches on keyup (a miss lists suggestions); a file field uploaded and removed; a select that puts the old value back first and settles a moment later; a month picker that ignores typing, driven through its calendar (the year from its list, the month pressed), refusing a year outside its list with the years on offer, a disabled month, and a date without a month; Ant Design's Select through a model of rc-select's context (options whose labels are React elements, a country chosen past its flag and dialling code, through a stale stored fiber; a miss listing the options; a disabled list refused); a UI5 date picker under a scoped tag: its date and parts read from attributes, set in its own format and heard through its change event with `{ value, valid }`, a month without a day, a read-only picker and a pattern with month names refused |
| `extension/test/manifest.test.ts` | The built Firefox manifest: CSP without `upgrade-insecure-requests` and loopback-only `connect-src`, event-page background, gecko id; both builds' host permissions are `<all_urls>` (`HOST_PERMISSIONS`), with no optional ones |
| `extension/test/background.test.ts` | The background loaded with a stubbed WebExtensions API: the reconnect alarm exists without any install event, and an existing one is left alone; Set posting asks for every site synchronously in the click, and nothing on a page not on the web; telling a page's site: `pageSite` matching the registry's signatures in a jsdom page (the first in registry order, an unparsable selector skipped, none on a plain page), a tab known by its page on a URL that names no site, the URL deciding when the page shows none, can't be read, is discarded (not asked) or doesn't answer within 1.5 s, a form call filling with the adapter of the site its page shows, a tab whose page and URL name none refused, and a capture sent with the site its page shows; `tab.show`: a background tab switched to and polled until the page notices, one in front left alone, `activate: false` only reporting, a page without focus and a minimized window reported, not forced; with `focusWindow`, the window raised (restored when minimized) and polled until the page has focus, a window already in front left alone, one the system kept behind reported, never with `activate: false`, and the tab still switched to when the raise fails; embedded applications: a tab's form frames listed by their pages else their URLs (never the top frame, nothing for a tab that can't be listed), the site check, the adapter and the call all in the frame alone after checking the frame's origin, access to websites asked for naming the frame's host when it isn't granted, a frame that's gone failing as `not_found`, `tab.show` reading the frame with the window's focus, and a board the capture couldn't read (access withheld) opened in its own tab; asking for access from a form call: a window naming the host asking for every site, the call going on once the grant arrives, nothing read or injected before, a hint to call again after the wait and a retry bringing the same window forward, and the window taking only `<all_urls>` or host patterns from its URL |
| `extension/test/browser-id.test.ts` | `detectBrowser`: Edge and Brave named before the Chrome/Chromium brands they also list, plain Chromium, none, and Firefox through `getBrowserInfo` |
| `extension/test/frames.test.ts` | Choosing the frame that holds a posting, passing over one that isn't rendered; spotting an embedded job board that couldn't be read |

Tests that need TeX are skipped when no engine is installed (CI's `tex` job sets `EZAPPLY_REQUIRE_TEX=1`,
which turns a missing engine into a failure); everything else runs without external tools (git is required
for `repos.test.ts`).

### Live snapshots are scrubbed
The pages in `extension/test/fixtures/live/` were captured from real career sites, some during the user's own
applications. Nothing in them, or in the tests, goldens and pages written about them, may say which employers the
user looked at or applied to, or anything about the user (`CLAUDE.md`, "Never expose sensitive information"). So
each employer is a fictional one, used consistently across the page, its tests and its golden schema:

| Snapshots | Employer | Site |
|---|---|---|
| `posting`, `start-choice`, `auth` | Initech (`initech.wd5.myworkdayjobs.com`) | Workday |
| `my-experience` | Cyberdyne | Workday |
| `oracle-posting`, `oracle-email`, `oracle-apply` | Umbrella (`jobs.umbrella.example`) | Oracle |
| `greenhouse-apply` | Vandelay | Greenhouse |
| `lever-apply` | Wonka | Lever |
| `ashby-apply` | Stark | Ashby |
| `ashby-groups` | Wayne | Ashby |
| `phenom-step1`, `phenom-step2`, `phenom-step2-errors`, `phenom-step3` | Globex (`jobs.globex.example`) | Phenom |
| `dayforce-candidate-info` | Hooli (client `hooli` on `jobs.dayforcehcm.com`) | Dayforce |
| `successfactors-application` | Soylent (company `soylent` on `career17.sapsf.com`, `careers.soylent.example`) | SAP SuccessFactors |

Employer domains become `.example`, and requisition and posting ids, uuids, job titles and the job slugs in links
become fake ones. So do addresses, pay, dates and brand colours. Descriptions, privacy notices and other prose
outside the form become placeholder text. The user's own values become made-up ones: names, contact details,
dates, languages, field of study, and the browser's timezone in hidden inputs. Form structure, labels and option
lists stay as captured, since that's what the adapters read. A new snapshot gets the same treatment before it's
committed. Then read its visible text and attribute values to check nothing was missed, since names also turn up in
`alt` text, link slugs, hidden JSON and image paths.

## CI
GitHub Actions (`.github/workflows/ci.yml`) on every push and pull request, Node 24:

| Job | Runs on | Does |
|---|---|---|
| `check` | `ubuntu-latest`, `windows-latest` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (TeX tests skip: no engine) |
| `tex` | `ubuntu-latest` | Installs TeX Live (`latexmk`, XeLaTeX, pdfLaTeX, recommended and extra packages, Latin Modern), builds, and runs the documents and template tests with `EZAPPLY_REQUIRE_TEX=1` |
| `firefox` | `ubuntu-latest` | Builds and runs Mozilla's `web-ext lint` over `dist-firefox/` (via `npx`, so it isn't an install-time dependency of the repo). Firefox itself isn't run |

## Conventions
- **Keep `references/` current** in the same change (see `CLAUDE.md`).
- **Thin tools, fat services.** An MCP tool validates, calls a service, returns JSON. Logic lives in
  services, which are wired explicitly in `main.ts`.
- **Errors carry a fix.** Throw `EzError(code, message, hint)`; the hint says what Claude should do (call a
  tool, ask the user, install something with the exact command). Never let a raw exception reach a tool
  result.
- **Validate at every boundary** with zod: tool inputs, bridge params and results, files read from disk.
- **Paths from Claude** go through `Workspace.resolveAllowed` with the narrowest folder list; ids that become
  folder names are checked too.
- **Write atomically** (`writeFileAtomic` for text or bytes, `writeJsonAtomic`, in `companion/src/util/fs.ts`).
- **Shared helpers live in `companion/src/util/`** (`fs.ts`, `keyed-queue.ts`, `wait.ts`, `open.ts`, `proc.ts`,
  `install-hints.ts`) and are exported for the CLI; don't redefine `exists` or a polling loop locally. The
  adapters' own `waitFor` in `adapters/engine/dom.ts` is different on purpose: it runs in the page and polls a synchronous
  DOM condition.
- **External programs** through `run()` (no shell, timeouts, tree kill) and `which()`; programs that should
  outlive the call (a viewer, a browser) through the `Opener`.
- **Site strings** only in each site's folder (`adapters/sites/<site>/`: `selectors.ts` for Workday and Oracle,
  `site.ts` for the others), plus the site's URL module in `protocol/src/` (`workday.ts`, `oracle.ts`,
  `greenhouse.ts`…) for what the companion and background need too (hosts or paths, tenant and job parsing, the
  posting-page hooks). Both sides import those from there instead of repeating them. Nothing outside the
  registry and a site's folder names a site: the companion reads the schema's facts (`kind`, `saved`, `lastPage`).
- **Adapter bundles stay free of zod:** in-page code imports the protocol only through its import-free
  subpaths (`@ezapply/protocol/workday`, `/oracle`, `/sites`, `/timing`) or as types.
- **No personal assumptions in code**: everything user-specific lives in the profile and config.
- **One adapter change per live run.** Commit fdd1d59 changed about ten things in the Workday
  adapter at once, and live filling got several times slower (a step's `fill_fields` past the companion's
  120 s timeout, nine dropdowns past 110 s). 870d07f reverted what the live runs hadn't shown working, and
  which change caused it was never found. The fixtures can't catch this: they're built from what the adapter
  expects. So land adapter changes one per live run, so a slowdown points at one change, and don't bundle
  them. d739492 brought two of the reverted ideas back (`openListboxRetrying`, and `back()` seeing a move by
  step index): if a live run is slower than the runs after d739492 ([status](status.md)), suspect those first.
  `autofill-timing.yaml` can shorten a wait without a rebuild.
  Moving Workday and Oracle onto the adapter engine is one too, and it went in before that live
  run, when the whole modular-adapters plan was built at once: the golden schemas and every behaviour test
  hold, and the next Workday and Oracle runs test the move ([status](status.md)).
  Two adapter changes went in after that run: the Workday row Delete found by its trash icon (from a saved step),
  and every site's `page.job` (reading the job title; extraction only, no filler touched; Lever's title
  selector fixed with it). The Delete is the one change the next Workday run checks; `page.job` adds no wait
  and runs only on reads, so a slower run doesn't point at it. Debug mode's adapter trace went in before that run
  as well, and it is an adapter change of its own: the helpers every filler goes through report to it, and the
  fillers name their branches ([adapters](components/adapters.md#debug-mode-the-adapter-trace)). Without
  debug those calls return at once and nothing is installed, and on the behavioural fixture a step took the same
  time with debug on and off. So the next live run goes with debug **off** first, and its timings must match the
  earlier runs' before the trace is trusted; a run slower than them points at the trace's calls before the
  Delete. Only then a run with debug on.

## Debugging a live run (debug mode)
`ezapply debug on` before the run (in the user's workspace), `ezapply debug report` after it, then open the
`NNNN-<tool>.json` records it points to ([format](data-formats.md#debugdate-postingid-companionsrcformsdebugts)).
A record holds every request to the extension with the adapter's full answer, the tab's state and the timings.
The report counts the calls made with the tab hidden and with the browser window behind another app (no focus
events reach the page then).

Inside the page, each adapter call's `trace` shows what the adapter did and what the page did back
([adapters](components/adapters.md#debug-mode-the-adapter-trace)), and the report sums it up: the slowest
fields and waits, waits that ran to their maximum (a settle the page never let go quiet, a condition that never
came), the slow paths taken, and the page's own errors and failed requests. `debug.markup` (default `failures`)
saves the page before each call and at every failed field, with a screenshot when the tab was on screen.

**The loop**, for Claude in this repo after a live run with debug on:
1. Read the report. For a failure, read its call's trace and its `NNNN-fail-<fieldId>.html`, and find where the
   adapter's picture of the page and the real page diverged: the listbox it read, the options it saw, the wait
   that ran out, the DOM change it didn't expect.
2. Export the page (`ezapply debug export <session> <NNNN> [before|after|fail-<fieldId>]`,
   [cli](components/cli.md#debug-export)). The user looks at the fixture candidate before it goes into
   `extension/test/fixtures/live/`; scrub what's left by hand ([live snapshots](#live-snapshots-are-scrubbed)),
   then add an extraction test (`workday-live.test.ts`, `oracle-live.test.ts`).
3. Correct the behavioural fixture to the real markup and the events the trace shows, and write the filler
   test there: jsdom doesn't run the site's scripts, so a saved page can't test a fill.
4. Fix, run live again (one adapter change per run), and compare the reports.

Compare a debugged run's timings with other debugged runs only. Turn it off (`ezapply debug off`) and
`ezapply debug clean` when done: the records hold the user's data.

## How to…
- **Add an MCP tool:** service method → register in the right `mcp/tools/*.ts` with a precise, short
  description (Claude reads it, and every description stays in context) → test in `e2e.test.ts` or the
  service's test → add it to skills that should use it, and to [mcp-tools.md](mcp-tools.md). Name it
  `<noun>_<verb>`, except in the form group, whose tools read as commands (see
  [mcp-tools](mcp-tools.md)). Don't list it in `EZAPPLY.md`: the MCP server already gives Claude the tool
  list.
- **Add a bridge method:** schema in `protocol/src/forms.ts` (or `bridge.ts`) → add to `ExtensionApi` /
  `CompanionApi` → implement the handler on the serving side (type errors until you do; for a form method
  that's `extension/src/background/forms.ts` and the handler map in `companion/test/e2e.test.ts`) → decide
  whether it's additive or needs a `PROTOCOL_VERSION` bump. A changed adapter needs no version bump of its
  own: the build stamps `ADAPTER_VERSION` with a hash of the bundle.
- **Change a stored format:** bump its `schemaVersion`, add a migration run by `ezapply init`, update
  [data-formats.md](data-formats.md).
- **Change a skill or `EZAPPLY.md`:** edit `packages/cli/templates/`; users get it with `ezapply init`.
  A new skill is named `ezapply-<name>` (folder and `name:`), never a bare word, so it can't shadow a
  Claude Code command or be overridden by a user's skill. Renaming one means adding the old name to
  `LEGACY_SKILLS` in `workspace-init.ts` so `init` removes the old copy.
  `EZAPPLY.md` is in every session's context: keep it near 100 lines, add only rules that apply to every
  task, and put procedures in skills. Rules that must hold even without it (Explore/Plan subagents) also go
  in the MCP server instructions (`mcp/server.ts`).
- **Add a job site:** follow [building adapters](building-adapters.md): the process from saving the site's pages
  to its first real application, what goes in the registry, the definition, the site's notes and the tests, and
  the rule that tool descriptions and skills never name a site.
