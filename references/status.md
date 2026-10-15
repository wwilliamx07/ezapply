# Status

As of 2026-10-11. A lean log: the decisions that shape the build and aren't obvious from the code, what still
needs a live run, and open questions. What is built, and how, is on the component pages; older history is in git.

## Decisions
Each gives the choice and the reason in a line or two; the linked page has the detail.

- **No daemon.** The companion lives inside `./ezapply` and ends with it. Nothing runs in the
  background, so there is nothing to start, stop or keep secure while the user isn't applying
  ([architecture](architecture.md#processes-and-lifecycle)).
- **Pairing without a code.** The extension pairs during a 15-minute window opened from the setup page or by
  `extension_pair`, and is pinned by its id; typing the code was no safer, since it sits in the same
  `config.json` that opening a window needs ([pairing](flows.md#2-pairing-the-extension)).
- **Everything in the browser.** The side panel drives a headless Claude Code, one process per conversation.
  `ezapply chat` (Claude Code in the terminal) was removed once the panel did all it did, so there's one way to
  run ezapply ([cli](components/cli.md#commands)).
- **One adapter engine, a definition per site.** Sites differ in markup, not in the API, so the API, fill loop and
  guard are shared and a site is a registry entry plus a definition ([adapters](components/adapters.md)).
- **Everything about a site in one directory** (`packages/sites/src/<site>/`), with a list per side (registry,
  definitions, notes, readers) so a bundle, the companion and the tests each import only what they need; no other
  package names a site, which a test scans for. A site's change touches one directory, and the engine (its own
  package) stays generic ([sites](components/sites.md#the-package)).
- **A new site needs no protocol bump.** `SiteId` is a string and `hello` carries the extension's site ids; the
  companion refuses a different list, so two sides built apart still fail at the handshake rather than mid-fill
  ([protocol](components/protocol.md#changing-the-protocol)).
- **The extension holds every site** (`<all_urls>`) so it can tell a page's site by its body, wherever the
  employer hosts it ([access](components/extension.md#access-to-websites)).
- **One adapter change per live run,** so a slowdown or failure points at one change; live filling once got several
  times slower after a batch of unverified changes ([development](development.md)).
- **Build sites from what was seen.** Every selector comes from a saved page or the site's own scripts; iCIMS,
  SmartRecruiters, Taleo and BrassRing wait for pages saved from a real application, since ezapply doesn't work
  around bot checks ([sites](components/sites.md#why-these-three)).
- **A step's late values are waited for by its requests,** not by a longer quiet: Workday's requests for a
  returning step's dropdown values run while the page shows nothing changing ([workday](components/sites/workday.md)).
- **Nothing is filled without the model.** See [deterministic autofill removed](#deterministic-autofill-removed).
- **Documents are approved one by one** before they're attached (by default, enforced by `upload_file`), each by a
  press of its own: what's attached goes to an employer ([documents](components/documents.md#review-before-attaching)).
- **Layout is linted, not looked at.** `tex_compile` names layout problems from where the text sits; no tool renders
  a page as an image, which cost more context than the findings on every later turn
  ([documents](components/documents.md#compile-compile)).
- **Form tools that change the page return it** (`go_next`, `add_repeatable`, `remove_repeatable`), and long option
  lists go out as a count: each extra read was a turn re-sending the whole conversation
  ([forms](mcp-tools.md#forms)).
- **No database.** Per-posting `meta.json` and `form-log.jsonl` ([postings](components/postings.md#no-database)).
- **A fresh Claude session per posting, and per part of it,** so finished work isn't re-sent every turn: each posting has its own panel conversations, one tailoring its documents and one filling its application, whichever comes first ([agent](components/agent.md#conversations-servicets)).
- **One button on the review page**, under the edits box and stuck to the panel's foot, approves a document (or asks for its changes), moves to the next one to decide, and on the last sends the answer ([ui](components/ui.md#the-review-page-reviewid)).
- **The side panel blocks a send from the press,** not from the state saying Claude works, which arrives only after the companion answers ([ui](components/ui.md#the-side-panel-srcpanel)).
- **A screening question the profile answers isn't asked in the answer bank** (an entry with a `source` and no
  answer): the fact has one home, the profile, and a question like the degree needs the posting anyway
  ([answer bank](components/profile-and-templates.md#answer-bank-profileanswersyaml)).
- **Binding an unconfirmed tab trusts the first tab that changes,** with a one-time `postingBound` notice naming the
  page's title, rather than refusing until `posting_activate` ([which posting](mcp-tools.md#forms)).
- **The reference is written for agents.** A "By task" table says what to read for each kind of change, the
  few hard rules sit in a `CLAUDE.md` beside the code they govern, it doesn't restate the code (no per-test
  lists), and a test checks its links and coverage: the agent reads less and still finds the page that matters
  ([conventions](development.md#conventions)).
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
| A Workday adapter, Chrome only | Eight sites on one engine; Chrome and other Chromium browsers (Firefox was built, then dropped for focus emulation) |
| One TeX engine (latexmk + XeLaTeX) | Per file: `% !TEX program`, else `tex.engine` ([documents](components/documents.md#tex-engines-texenginests)) |
| Playwright tests with React harnesses | jsdom tests against behavioural fixtures and live snapshots |
| Changesets, per-package READMEs, `ezapply migrate`, `docs/adr/` | Migrations in `ezapply init`; this folder |
| A cover template generated in onboarding | A shipped default, the user's LaTeX, or one rebuilt from an example letter |

## Not yet verified for real
What's built but hasn't run live, and what to check first. Each site's page lists its own details.

- **The form-filling fixes** (2026-10-15), from live Workday records: Back on the review page (refused as Submit
  before), a returning step's dropdowns read once their values' requests are back (read as empty and refilled
  before), and the agent ticking every attestation. Check that a move to a new step costs no more than before (the
  request wait should end at once there), and `remove_items` clearing a text field. Two Workday changes in one run,
  against the rule: if moves get slower, suspect the request wait ([workday](components/sites/workday.md)).

- **The sites package** (2026-10-15): the bundles were compared and hold the same code, and every test passes. Not
  yet seen live: the extension's `hello` with its site ids accepted by the companion (and a stale extension refused
  with "Site mismatch"); a posting's company on a provider's host (now from the registry's `providerHosts` and
  `company`: a Dayforce posting's company now comes from its title or JSON-LD, not the host); and an embedded
  board's frame recognised by the same hosts when access to websites is withheld.

- **The token cuts** (2026-10-12): one live Workday application used `go_next`'s and `add_repeatable`'s `form`
  (one `get_form` in four steps), but still called `list_options` before filling three steps' dropdowns. Not yet
  checked: `remove_repeatable`'s `form`, the `optionCount` cap on a long list, and the lint's findings against the
  PDF. What the runs cost, and what to cut next, is in the todo item "Cut the tokens a panel conversation spends".

- **The side panel:** opened by the toolbar button, and a whole application from it with the real Claude Code (setup, a review, question and
  approval cards, Stop, Reset, long waits).
- **Screening questions answered from the profile:** in a live application, the agent computes a sourced question
  (sponsorship, the degree) from the profile without asking, asks when the profile holds nothing there, and offers
  to save that reply into the profile rather than the bank.
- **The review page's per-document approval** in a real browser, with its one button: on to the next document, and
  the send on the last one; and a real resume's links (from `hyperref`) drawn where the text is and opening.
- **The panel and review-page fixes** in a real browser: a double click on Tailor or Fill, or a second Enter, sends
  one message; the review page's button stuck to the panel's foot under the edits box; and adding a comment (near
  the view's bottom, and on a window under 900 px) leaves the page where it was.
- **A posting's two conversations** with the real Claude Code: the tailoring one leaves forms alone and the filling
  one leaves the documents' writing to the other, each sending the user to the other's button; and an older
  workspace's conversation showing under Documents.
- **Workday and Oracle on the engine:** Workday ran on it twice at the earlier speed. Fixed since and not re-run:
  the row Delete (found on a saved step), multi-selects that unticked Workday's own tick, a hierarchical prompt's
  category menu read as search results, `tab.screenshot` with `<all_urls>`, and on Oracle the address and school
  lists' late search ([workday](components/sites/workday.md), [oracle](components/sites/oracle.md#oracle-what-was-verified)).
  Run once with debug mode off: its timings must match the earlier runs' before the adapter trace is trusted. If
  it's slower, suspect first the adapter trace's calls, then two retries brought back after a revert
  (`openListboxRetrying`, and `back()` seeing a move by step index), then the row Delete; every site's `page.job`
  adds no wait and runs only on reads.
- **Workday's and Oracle's drivers on the shared ones** (2026-10-11): equal golden schemas and behaviour tests.
  What changed is small: the shared text driver's reformatted-phone and read-only checks on Workday, a checkbox
  group's `multiple` and `remove_items` there, an uploaded file's name matched regardless of case, and Oracle's
  native checkbox groups, which couldn't be filled before ([adapters](components/adapters.md#a-sites-own-drivers)).
- **Focus emulation** (`chrome.debugger`): tested against a stubbed API only. Check in a real Chrome on Windows,
  with the application window minimized, covered, and behind the terminal: the page reports visible and focused
  (`shown.emulated` and `focused` in debug records), a step fills about as fast as with the tab in front, Workday's
  multi-part dates are taken (focus was the suspect for the run where they weren't), the debugging bar shows
  during the fill and goes 5 minutes after it (or when ezapply stops), Cancel on the bar comes back on the next
  call, a screenshot of a minimized tab, and whether a step that loads a new document keeps it
  ([extension](components/extension.md#focus-emulation-emulationts),
  [dates](components/sites/workday.md#dates-typed-into-workdays-split-widget)).
- **Fills slower in debug mode's first live run** (dropdowns about 3.5–4 s against 1.8 s), cause unknown: the
  adapter trace will show which waits ran to their maximum; one guess is `afterFieldMaxMs`.
- **Greenhouse, Lever, Ashby:** fixes after one real Greenhouse and one Ashby application (multi-select ids, lists
  that load as you type, radio and checkbox groups); not tried: Lever uploads, the confirmation pages
  ([sites](components/sites.md#what-was-verified-and-how)).
- **Phenom:** one run stopped on step 1; the resume's name (read from the download link, not its text), question
  groups as one field, the tab and capture matching are fixed but not re-run;
  steps 4 to 6 unseen ([phenom](components/sites/phenom.md)).
- **Dayforce:** nothing has run live; rc-select's context is the riskiest part ([dayforce](components/sites/dayforce.md)).
- **SAP SuccessFactors:** question radios, a same-named replacement and a re-render during upload fixed after a
  live run, not re-run ([successfactors](components/sites/successfactors.md)).
- **Matching tabs to postings:** the first-fill binding and its notice, title matching on real roles, and the
  hand-off checklist on live sections.
- **The extension in a real browser:** reloaded with `<all_urls>`, `browser_status` with many tabs, embedded
  applications in cross-origin frames, the access window, the
  reconnect alarm after a browser restart, the extension pages' CSP (connecting to the companion).
- **Debug mode's adapter trace** on a real page: its size through the bridge, the failure screenshot, the export.
- **Keeping the workspace current:** `ls-remote` against GitHub with the app's token, and the agent following
  `workspace_changes` (including putting a repo off for a set time).
- **Setup end to end:** a real GitHub login (and connecting an existing app), onboarding's steps against the real
  things, the OS folder dialog, a full onboarding in Claude Code with MiKTeX installed from a hint, and CI's `tex`
  job on GitHub.
- **Opening in the user's browser:** a new tab in the running window, a Chrome user
  with several profiles.

## Known issues
- **"Could not open the dropdown"** on Workday after its own list was read without a choice; the adapter retries
  once, and nothing records whether the retry ran ([details](components/sites/workday.md#workdays-dropdown-finding-its-listbox)).
- **Unexplained on Workday:** a "Field of Study" search returning only its top level in a step's fill but taken
  when filled alone.
- **A `go_next` after the user advanced the step themselves** presses the next step's button.
- **The default cover letter test** failed once with MiKTeX and didn't reproduce; capture its `hint` if it recurs.

## Open questions
1. **Bindings live in memory,** so a restart of `ezapply` loses them; the stored `application` still matches
   by tenant and job. Enough?
2. **Title matching on real roles:** compare recorded roles with the pages' titles (`FormSchema.job` in debug
   records) and tune `compareTitles` if real pairs come out `unsure` or `other`.
3. **Postings captured from one job-board results URL** can't be told apart by URL (a capture problem).
