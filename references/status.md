# Status

As of 2026-09-30.

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
| Workday write path | All fillers (a dropdown reads its own listbox even while the previous one is still on screen; dates typed digit by digit and read from what the widget holds; typeahead entries matched one by one once their search results are in), removing carried-over selections, attachments and rows (`remove_repeatable`), repeatables, next and back, page actions, screenshot, submit guard, `ezapply-apply` skill; lean `get_form` with filters; tested against a behavioural fixture, which the companion's e2e tests also drive through the real adapter |
| Oracle Recruiting Cloud | A second adapter with the Workday API ([oracle-adapter](components/oracle-adapter.md)): detection by path on Oracle Cloud hosts and employers' domains, tenant as host and site number, per-origin site access asked for at Set posting; extraction of every widget (text, cx-select lists, pills, radios, dates, phone, attachments, agreements, saved items), fillers, uploads and removals, inline item forms with Save, deletes, single-page and multi-page flows, submit guard. Job page and email step verified live (headless, public pages); the single-page application read from a page the user saved; filling tested against a behavioural fixture built from that page and the Candidate Experience's own templates, also driven by the companion's e2e tests |
| Audit and status | `form-log.jsonl`, automatic status credited only to the posting on the tab's tenant, tab choice by that tenant, duplicate lookup by company, resume after interruption |
| Firefox | Separate build, origin support, event-page keepalive, site-access handling |
| Agent guidance | Lean `EZAPPLY.md` with prompt-injection, application-requirement and context rules; kept in context by the `CLAUDE.md` import, backed by the MCP instructions and the `agent_file` check; call shapes in the skills (no schema errors in about 110 ezapply calls over five sessions on 2026-09-30) |
| Context and usage | `ezapply chat` starts a fresh Claude session when another posting is captured (never during a tool call); one `fill_fields` per step with bare results for clean successes, `list_options` for several fields in one call; every claim read at the first request (`claims_list`); form calls on a tab one at a time; `npm run usage:report` to measure |
| Opening things | Pages and PDFs open in the browser the extension runs in (reported in `hello`; its program found per OS), else the system default |
| Setup | `npm run setup` + agent-led onboarding (`./ezapply chat`), Claude Code's auto memory off in the workspace, code-less pairing, install hints for TeX and git that work without a restart |

## Not yet verified for real
- **Parts of filling a signed-in Workday application.** The first real application (2026-09-27, Soylent)
  was filled through to the review page. It found the stale-dropdown bug (fixed, with a fixture test that
  reproduces it; the fix itself not yet re-run live) and dates that needed a second entry (now automatic;
  cause unknown, not yet re-run live). The second (2026-09-28, Monarch) reached the review page too and found
  more adapter bugs. The fixes the next two live runs (same posting) showed working were kept: split dates
  typed digit by digit (four `MM/YYYY` and two `YYYY` dates taken, the step advanced), typeahead entries
  matched one by one with bare names (12 of 15 skills under Workday's own names, the misses not stopping the
  rest), `go_next` noticing a move when every step is titled "Application", upload notices out of `errors`,
  add buttons named by section, and the Resume/CV field id taken from its label. The other fixes in that
  change (dismissing a listbox left open after a miss, `ok: false` while a field shows an error, `decline`
  matching, education dates with a day, the student seed questions, documents written before the form) were
  reverted: they were unverified, and fills had become several times slower (see Known issues). Not
  exercised yet: the remove controls for skill pills and attached
  files (`DELETE_charm`, `delete-file`), and repeatable rows (`panel-set-delete-button`), which come from
  knowledge of Workday's markup, not a live page. On the first real application: a saved
  snapshot of a step with a removable pill, file and row, turned into a live fixture. The Back button worked
  live in the two Oscorp runs (2026-09-29).
- **Parts of filling an Oracle application.** The first live application (2026-09-29, Umbrella, single page,
  in Chrome, with site access granted at Set posting) was filled to Submit: text, pills, radios, dates, lists,
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
- **Guidance from the 2026-09-30 sessions** (`.tex` edited with the Edit tool only, the answer bank read
  before asking, resolved answers saved into the existing entry with `sensitive: false`): not yet seen in a
  session.
- **Capturing from embedded job boards** in a real browser: whether `allFrames` quietly skips frames the
  click's `activeTab` grant doesn't cover (as expected) in both Chrome and Firefox, and the board opening in
  its own tab when it can't be read. Tested with the frame-choice logic only.
- **The review page in real browsers:** PDFs shown in an iframe by Chrome's and Firefox's viewers under the
  page's CSP (tested over HTTP only).
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
- **The saving from turning auto memory off:** measure with `npm run usage:report` on the next session.
- **A full onboarding in Claude Code**, including installing MiKTeX through a tool hint.
- **`ezapply chat` with a real Claude Code:** tested with a stub `claude`. Not yet seen: Claude Code passing
  `EZAPPLY_CHAT_SESSION` on to its MCP relay (without it the session reads as unused and never restarts,
  which fails safe), the terminal state after ending Claude in Windows Terminal, PowerShell and macOS
  Terminal, and an npm-installed `claude.cmd` launched through the shell.

## Known issues
- The TeX tests, including the default cover letter compiling to one page, pass with MiKTeX (latexmk) on
  Windows. Once, the default cover test failed while the other TeX tests passed. It didn't reproduce in
  four later runs, and the error wasn't captured. Possibly a MiKTeX first-use package download. If it
  recurs, capture the compile result's `hint` and diagnostics.
- **Slow fills on a live tenant.** In the third and fourth live runs (2026-09-28) a step with many
  dropdowns and a long skills list ran past the companion's 120 s `form.fill` timeout, and nine dropdowns
  took over 110 s. Suspected causes, none measured yet: the adapter's fixed waits per field (settling after
  each field, dropdown open and close waits, the typeahead's waits for its own results), the Workday tab
  hidden behind the review page (browsers slow hidden tabs), and a throttled laptop. A timed-out fill keeps
  running in the page and isn't logged. The unverified dropdown changes were reverted; the typeahead's
  waits were kept because its fix worked. The fifth run (after the revert) reached the review page with
  fills of about 2.5–3 s per dropdown; every wait is now tunable in `autofill-timing.yaml`
  ([waits](components/workday-adapter.md#waits-autofill-timingyaml)), not yet tried live. Next: per-field
  timings in fill results.
- **"Could not open the dropdown"** cost the fifth run 9 failed fields (about 5.5 s of waiting each) and 4
  extra calls. A listbox closed without a choice is now closed with a press on its own button when Escape
  doesn't do it, which covers 6 of the 9. The two Oscorp runs (2026-09-29, with that press) still failed 12
  fields, each a dropdown whose own list had been read without a choice (`list_options` or a miss), and the
  agent's next call filled every one. The adapter now tries such an open a second time itself; why the first
  fails isn't known ([details](components/workday-adapter.md#finding-a-dropdowns-listbox)). The first live
  run with the retry (Tyrell, 2026-09-30, four steps) had no dropdown fail to open, and listed none before
  filling; nothing records whether the retry ran.
- **Reading a step before it rendered.** In the Oscorp runs `get_form` straight after `go_next` read an empty
  step four times. `go_next` and `go_back` now wait for the new step's fields (`stepFieldsMs`), and `go_back`
  sees a move when every step is titled "Application" (it waited out 12 s and said `moved: false` on all five
  Backs). In the Tyrell run both `go_next`s returned in 1–3 s and the `get_form` right after read the new step
  each time. `go_back` not yet tried live.
- **Fill speed in the Tyrell run** (Workday, 2026-09-30, the first live run of the changes in b5ba545): 9
  fields in 3 s; a step of two work rows, an education row, two websites and a nine-entry skills list (about
  20 fields) in 22 s; 4 questions in 3 s. No call timed out.
- **The cover letter left out.** Both Oscorp runs uploaded only the resume into Workday's single Resume/CV
  field (`multiple: true`), and the user had to ask for the cover letter. `upload_file`, `go_next` and
  `get_form` now report approved documents not attached (`notAttached`), and the apply skill says both go
  into that field. Seen working live on 2026-09-30: on Tyrell's Workday form the agent uploaded the cover
  letter into Resume/CV after the hint. Two flaws seen on Oracle (Umbrella, twice): the agent sent both uploads
  in parallel, so the resume's result listed the cover letter, whose upload was queued right behind it; and
  the hint names Workday's Resume/CV on an Oracle form.
- **A Workday field of study that searches nothing.** On Tyrell's form, `search_options` on the multi-select
  "Field of Study" returned only its two top-level entries ("Partial List (First 500 Entries)", "All") for
  "Physics" and for "Comp", and "Physics" failed with "No option matches" in the step's
  fill but was taken when filled alone a few seconds later. Not explained.
- **Language rows emptied.** In the first Oscorp run the French and German language rows, filled with
  `ok: true` before Save and Continue, were empty when the agent came back to the step. Not explained; the
  skill already re-checks steps when coming forward.

## Deferred
**Removing the upgrade shims.** Two pieces exist only for installs from before the background daemon went:
moving `~/.ezapply/daemon.json` to `config.json` (and `init` deleting `daemon-state.json`), and `ezapply chat`
shutting down an earlier build's daemon found on its port. Both can go once no such install is left.

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
| Chrome only | Chrome and Firefox ([extension](components/extension.md#builds-npm-run-build--w-ezapplyextension)) |
| One TeX engine for everything (latexmk + XeLaTeX) | Per file: `% !TEX program`, else `tex.engine` (default `auto`) ([documents](components/documents.md#tex-engines-texenginests)) |
| Playwright tests of the extension with React harnesses | jsdom tests against a behavioural fixture and live snapshots; Playwright only in the recon script |
| Changesets, per-package READMEs, `ezapply migrate` | Not used; migrations run in `ezapply init`; documentation lives here |
| Cover letter template generated in onboarding | A shipped default, the user's LaTeX, or rebuilt from an example letter |
| The user runs `claude` in the workspace | `ezapply chat` (the workspace launcher), which starts Claude and gives it a fresh session when another posting is captured, so finished work isn't re-sent every turn ([cli](components/cli.md#chat-chatts)) |
| `docs/adr/` decision records | None: `references/` records the current design with its reasons |
