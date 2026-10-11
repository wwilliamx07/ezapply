# Status

As of 2026-10-11. A lean log: the decisions that shape the build and aren't obvious from the code, what still
needs a live run, and open questions. What is built, and how, is on the component pages; older history is in git.

## Decisions
Each gives the choice and the reason in a line or two; the linked page has the detail.

- **No daemon.** The companion lives inside `./ezapply` or `ezapply chat` and ends with it. Nothing runs in the
  background, so there is nothing to start, stop or keep secure while the user isn't applying
  ([architecture](architecture.md#processes-and-lifecycle)).
- **Pairing without a code.** The extension pairs during a 15-minute window opened from the setup page or by
  `extension_pair`, and is pinned by its id; typing the code was no safer, since it sits in the same
  `config.json` that opening a window needs ([pairing](flows.md#2-pairing-the-extension)).
- **Everything in the browser.** The side panel drives a headless Claude Code, one process per conversation;
  `ezapply chat` stays for the terminal ([agent](components/agent.md)).
- **One adapter engine, a definition per site.** Sites differ in markup, not in the API, so the API, fill loop and
  guard are shared and a site is a registry entry plus a definition ([adapters](components/adapters.md)).
- **The extension holds every site** (`<all_urls>`) so it can tell a page's site by its body, wherever the
  employer hosts it ([access](components/extension.md#access-to-websites)).
- **One adapter change per live run,** so a slowdown or failure points at one change; live filling once got several
  times slower after a batch of unverified changes ([development](development.md)).
- **Build sites from what was seen.** Every selector comes from a saved page or the site's own scripts; iCIMS,
  SmartRecruiters, Taleo and BrassRing wait for pages saved from a real application, since ezapply doesn't work
  around bot checks ([sites](components/sites.md#why-these-three)).
- **Nothing is filled without the model.** See [deterministic autofill removed](#deterministic-autofill-removed).
- **Documents are approved one by one** before they're attached (by default, enforced by `upload_file`), each by a
  press of its own: what's attached goes to an employer ([documents](components/documents.md#review-before-attaching)).
- **No database.** Per-posting `meta.json` and `form-log.jsonl` ([postings](components/postings.md#no-database)).
- **A fresh Claude session per posting,** so finished work isn't re-sent every turn ([cli](components/cli.md#chat-chatts)).
- **Binding an unconfirmed tab trusts the first tab that changes,** with a one-time `postingBound` notice naming the
  page's title, rather than refusing until `posting_activate` ([which posting](mcp-tools.md#forms)).
- **Defaults assumed:** resume page size Letter (bundle normalization); contributions to other people's public
  repos are added by URL, with claims limited to the user's own commits.

### Deterministic autofill removed
`autofill_step` (removed 2026-10-07, with its tool, setting, hand-off lists, debug fields and the adapters'
`strict` matching) filled from the profile and answer bank without the model. It filled about 45% of fields in
debugged live runs, but every step still took a `fill_fields` call for the rest, so it saved values, not turns. Its
mistakes passed as clean fills: rows and levels placed by label patterns put a word into a 1–10 scale field and
read back as matching. Reading labels is what the model does well. What stayed: the profile hints on fields.

### Where the build departs from the original plan
The plan (`plan.md`) is in git history before 2026-09-27.

| Plan | Built |
|---|---|
| GitHub device flow; app registered by hand | App Manifest flow and OAuth web flow ([github-and-repos](components/github-and-repos.md#github-app-githubservice)) |
| SQLite log, `app_status` / `app_search` | `meta.json`, `form-log.jsonl`, `postings_list` |
| A daemon started by hand or at login | None (above) |
| `init`, a daemon start, a pairing code, `claude` | `npm run setup` and the onboarding page; pairing without a code |
| A content script declared for Workday | Adapters injected into the MAIN world on demand |
| A Workday adapter, Chrome only | Eight sites on one engine; Chrome and Firefox |
| One TeX engine (latexmk + XeLaTeX) | Per file: `% !TEX program`, else `tex.engine` ([documents](components/documents.md#tex-engines-texenginests)) |
| Playwright tests with React harnesses | jsdom tests against behavioural fixtures and live snapshots |
| Changesets, per-package READMEs, `ezapply migrate`, `docs/adr/` | Migrations in `ezapply init`; this folder |
| A cover template generated in onboarding | A shipped default, the user's LaTeX, or one rebuilt from an example letter |

## Not yet verified for real
What's built but hasn't run live, and what to check first. Each site's page lists its own details.

- **The side panel:** Chrome's panel and Firefox's sidebar opened by the toolbar button, Capture asking Firefox for
  access in the click, and a whole application from it with the real Claude Code (setup, a review, question and
  approval cards, Stop, Reset, long waits).
- **The review page's per-document approval** in a real browser.
- **Workday and Oracle on the engine:** Workday ran on it twice at the earlier speed. Fixed since and not re-run:
  the row Delete (found on a saved step), multi-selects that unticked Workday's own tick, a hierarchical prompt's
  category menu read as search results, `tab.screenshot` with `<all_urls>`, and on Oracle the address and school
  lists' late search ([workday](components/workday-adapter.md), [oracle](components/oracle-adapter.md#what-was-verified-and-how)).
  Run once with debug mode off: its timings must match the earlier runs' before the adapter trace is trusted.
- **Workday's and Oracle's drivers on the shared ones** (2026-10-11): equal golden schemas and behaviour tests.
  What changed is small: the shared text driver's reformatted-phone and read-only checks on Workday, a checkbox
  group's `multiple` and `remove_items` there, an uploaded file's name matched regardless of case, and Oracle's
  native checkbox groups, which couldn't be filled before ([adapters](components/adapters.md#a-sites-own-drivers)).
- **Multi-part Workday dates:** focus is the suspect. Compare a run with `forms.focusBrowser` off and the terminal
  in front against one with it on ([dates](components/workday-adapter.md#dates-typed-into-workdays-split-widget)).
- **Fills slower in debug mode's first live run** (dropdowns about 3.5–4 s against 1.8 s), cause unknown: the
  adapter trace will show which waits ran to their maximum; one guess is `afterFieldMaxMs`.
- **Greenhouse, Lever, Ashby:** fixes after one real Greenhouse and one Ashby application (multi-select ids, lists
  that load as you type, radio and checkbox groups); not tried: Lever uploads, the confirmation pages
  ([sites](components/sites.md#what-was-verified-and-how)).
- **Phenom:** one run stopped on step 1; question groups, the tab and capture matching are fixed but not re-run;
  steps 4 to 6 unseen ([phenom](components/sites.md#phenom-sitesphenom)).
- **Dayforce:** nothing has run live; rc-select's context is the riskiest part ([dayforce](components/sites.md#dayforce-sitesdayforce)).
- **SAP SuccessFactors:** question radios, a same-named replacement and a re-render during upload fixed after a
  live run, not re-run ([successfactors](components/sites.md#sap-successfactors-sitessuccessfactors)).
- **Matching tabs to postings:** the first-fill binding and its notice, title matching on real roles, and the
  hand-off checklist on live sections.
- **The extension in a real browser:** reloaded with `<all_urls>`, `browser_status` with many tabs, embedded
  applications in cross-origin frames, the access window, bringing the window to the front on Windows, the
  reconnect alarm after a browser restart, Firefox pairing and keepalive (after the explicit CSP fix).
- **Debug mode's adapter trace** on a real page: its size through the bridge, the failure screenshot, the export.
- **Keeping the workspace current:** `ls-remote` against GitHub with the app's token, and the agent following
  `workspace_changes` (including putting a repo off for a set time).
- **Setup end to end:** a real GitHub login (and connecting an existing app), onboarding's steps against the real
  things, the OS folder dialog, a full onboarding in Claude Code with MiKTeX installed from a hint, and CI's `tex`
  and `firefox` jobs on GitHub.
- **`ezapply chat` with a real Claude Code:** `EZAPPLY_CHAT_SESSION` reaching the relay, the terminal clean through
  captures and builds, and the terminal state after exit on Windows Terminal, PowerShell and macOS.
- **Opening in the user's browser:** a new tab in the running window, Firefox with a `file://` PDF, a Chrome user
  with several profiles.

## Known issues
- **"Could not open the dropdown"** on Workday after its own list was read without a choice; the adapter retries
  once, and nothing records whether the retry ran ([details](components/workday-adapter.md#finding-a-dropdowns-listbox)).
- **Unexplained on Workday:** a "Field of Study" search returning only its top level in a step's fill but taken
  when filled alone; language rows (and their levels) empty on coming back to a step.
- **A `go_next` after the user advanced the step themselves** presses the next step's button.
- **The default cover letter test** failed once with MiKTeX and didn't reproduce; capture its `hint` if it recurs.

## Open questions
1. **Bindings live in memory,** so a restart of `ezapply chat` loses them; the stored `application` still matches
   by tenant and job. Enough?
2. **Title matching on real roles:** compare recorded roles with the pages' titles (`FormSchema.job` in debug
   records) and tune `compareTitles` if real pairs come out `unsure` or `other`.
3. **Postings captured from one job-board results URL** can't be told apart by URL (a capture problem).
