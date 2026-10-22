# Status

A lean log: the decisions that shape the build and aren't obvious from the code, what still needs a live run, and
open questions. What is built, and how, is on the component pages; history is in git.

## Decisions
Each gives the choice and the reason in a line or two; the linked page has the detail.

- **Setup and repos have no skill.** The setup page does each step as a form, and a task it hands the agent
  carries its own instructions; `onboarding { step }` opens a step for a change asked in chat, instead of a skill
  repeating the step a turn of chat at a time ([workspace](components/workspace.md#skills-claudeskills)).
- **The setup page installs TeX and fills the cover's name and contact itself.** Both are the same every time,
  with nothing to judge, so an agent turn added only a wait; the system asks for permission to install
  ([ui](components/ui.md#installing-tex)).
- **Keeping the workspace current is a card, not a skill.** The user's press on the Workspace changes card is
  the consent, so nothing is updated without it and the agent can't mark a change done the user never saw; code
  does the mechanical updates, and the agent gets only what needs judgement, as a task. No call at the start of
  every session ([companion](components/companion.md#acting-on-a-change-workspaceupdates)).
- **The extension watches for Submit; the user can mark it.** The user presses Submit, so no form call sees the
  confirmation page; watching the tab from the hand-off records it without an agent, and **Mark submitted** in the
  panel covers what the watch misses ([extension](components/extension.md#watching-for-the-users-submit-submit-watchts)).
- **The setup page has no chat.** Questions and changes no button covers go to the panel's general conversation,
  which already is one; the page's previews follow the PDF's build time, so the agent's work there shows on the page
  ([ui](components/ui.md#what-each-step-does)).
- **No daemon.** The companion lives inside `./ezapply` and ends with it. Nothing runs in the
  background, so there is nothing to start, stop or keep secure while the user isn't applying
  ([architecture](architecture.md#processes-and-lifecycle)).
- **A failed rename is retried before it's called a lock.** Windows refuses a rename while any handle is open on
  the target, which readers and scanners hold for a moment; reporting the first failure sent the agent to ask the
  user to close files they didn't have open ([architecture](architecture.md#cross-cutting-concerns)).
- **At launch, paired is enough.** `ezapply`'s start-up readiness check counts a paired extension as set up, since
  it can't have reconnected in the instant after the start; requiring the connection opened the setup page on
  every launch ([companion](components/companion.md#readiness-checklist-workspace_check)).
- **Pairing without a code.** The extension pairs during a 15-minute window opened from the setup page or by
  `extension_pair`, and is pinned by its id; typing the code was no safer, since it sits in the same
  `config.json` that opening a window needs ([pairing](flows.md#2-pairing-the-extension),
  [why](security.md#accepted-limits)).
- **A light entry for the CLI.** `ezapply` imports each command's code when it runs, and the relay only the
  companion's config and endpoints, since the relay starts with every panel conversation and loading the whole
  companion took about 1.5 s of it ([cli](components/cli.md#commands)).
- **The coding agent's own CLI, run headless,** not the Agent SDK, an agent loop of ezapply's own, or channels: the
  CLI keeps the user's login, skills and permissions, and channels don't work under `-p`
  ([agent](components/agent.md#the-process-processts)).
- **Call shapes in the skills,** not a step that loads the tools' schemas: Claude Code defers MCP tools and the
  agent guessed parameter names, a turn each ([workspace](components/workspace.md#call-shapes)).
- **Everything in the browser.** The side panel drives a headless Claude Code, one process per conversation; there's
  no Claude Code in the terminal, so there's one way to run ezapply ([cli](components/cli.md#commands)).
- **Applications side by side, with no cap.** Each panel conversation has its own agent process and works on its
  own posting, resolved from its session; a tab is bound to one application, and shared files are written one at a
  time. The user decides how many to start
  ([agent](components/agent.md#conversations-servicets)).
- **No active posting.** A call's posting is the one it names, else its conversation's; the general conversation and
  a terminal chat name it, and form calls without one credit nothing ([which posting](mcp-tools.md#postings)).
- **The agent behind an interface.** The panel's service drives an agent backend, Claude Code's or Antigravity's, so
  each agent reads its own protocol without touching the conversations, cards or history
  ([agent](components/agent.md)).
- **Antigravity without approvals.** Its headless mode can't ask anyone, and on the user's allow rules alone every
  command was denied and ended the turn, so Don't ask runs it with its skip-permissions flag, accepting that a
  prompt injected through a posting isn't checked ([agent](components/agent.md#antigravity-antigravityts)).
- **The user's answers start the agent's next turn.** In the panel, `ask_user` and `review_documents` return at once
  and the answer comes as a message: a call held for the user timed out (Antigravity cuts any MCP call at 3 minutes)
  and left the answer unread ([agent](components/agent.md#results-as-messages)).
- **The extension keeps the agent settings,** each agent's own mode, model and effort, and gives them to the
  companion, which holds them in memory: the panel shows them as it opens instead of after ezapply answers
  ([agent](components/agent.md#permission-mode-model-and-effort)).
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
  returning step's dropdown values, and for the list a prompt loads on a press, run while the page shows nothing
  changing ([workday](components/sites/workday.md)).
- **Nothing is filled without the model.** Every value goes in through the agent's `fill_fields`; fields carry only
  profile hints. Filling from the profile and answer bank without the model saved values, not turns (every step
  still took a `fill_fields` call for the rest), and its mistakes passed as clean fills (a word in a 1–10 scale
  field read back as matching); reading labels is what the model does well ([adapters](components/adapters.md#widget-drivers)).
- **Documents are approved one by one** before they're attached (by default, enforced by `upload_file`), each by a
  press of its own: what's attached goes to an employer ([documents](components/documents.md#review-before-attaching)).
- **Layout is linted, not looked at.** `tex_compile` names layout problems from where the text sits; no tool renders
  a page as an image, which cost more context than the findings on every later turn
  ([documents](components/documents.md#compile-compile)).
- **Tailored documents fill the page.** `tex_compile` reports `freeLines`, a cover letter has a one-page limit, the
  skills aim for 0–2 lines left, and `review_documents` refuses an underfilled resume or letter unless `short`
  gives a reason: agents stopped well short even with the lint, and a shorter letter is sometimes right
  ([documents](components/documents.md#review-before-attaching)). A letter has one evidence paragraph per
  project or role, not a fixed two ([workspace](components/workspace.md#the-agent-file-ezapplymd)).
- **An approved document isn't reviewed again by accident.** `review_documents` refuses one whose current bytes are
  approved unless `again` gives a reason: a fill that read the approvals before the user answered the tailoring's
  review opened a second review of the same bundle ([documents](components/documents.md#review-before-attaching)).
- **Edits are reread, narrowly.** After a round of edits the agent rereads only the changed passages and their
  neighbours: never rereading saved tokens but let edits clash; python is denied in the workspace so `.tex`
  edits go through the Edit tool ([workspace](components/workspace.md#the-agent-file-ezapplymd)).
- **Form tools that change the page return it** (`go_next`, `add_repeatable`, `remove_repeatable`), and long option
  lists go out as a count: each extra read was a turn re-sending the whole conversation
  ([forms](mcp-tools.md#forms)).
- **A miss is the query.** No tool lists a field's options: `fill_fields` returns the 10 closest on a miss, and a
  nested menu's item named alone comes back with its full path; listing first cost a turn each time
  ([forms](mcp-tools.md#forms)).
- **The panel's Claude Code leaves the user's setup out:** only the workspace's MCP servers and settings, the tools
  the panel uses with one shell, no bundled skills. The starting context, re-read on every call, halved, and the
  user's own skills stopped competing with ezapply's ([agent](components/agent.md#the-process-processts)).
- **`EZAPPLY.md` holds only what every call needs;** document editing, the attach mode and the form rules went to
  the skills and tool descriptions that use them ([workspace](components/workspace.md#the-agent-file-ezapplymd)).
- **The preferences are imported by `EZAPPLY.md`,** not read by a skill step, so every session has them whichever
  skill runs ([workspace](components/workspace.md#how-it-stays-in-context)).
- **No database.** Per-posting `meta.json` and `form-log.jsonl` ([postings](components/postings.md#no-database)).
- **A fresh Claude session per posting, and per part of it,** so finished work isn't re-sent every turn: each posting has its own panel conversations, one tailoring its documents and one filling its application, whichever comes first ([agent](components/agent.md#conversations-servicets)).
- **One button on the review page**, under the edits box and stuck to the panel's foot, approves a document (or asks for its changes), moves to the next one to decide, and on the last sends the answer ([ui](components/ui.md#the-review-page-reviewid)).
- **The side panel blocks a send from the press,** not from the state saying Claude works, which arrives only after the companion answers ([ui](components/ui.md#the-side-panel-srcpanel)).
- **The side panel opens on the list of applications,** grouped by what each needs, and an application's conversation is opened from it, so applications in parallel each show their state ([ui](components/ui.md#the-side-panel-srcpanel)).
- **The general conversation is a card pinned above the list,** not one of its rows, since it isn't an application ([ui](components/ui.md#the-side-panel-srcpanel)).
- **A screening question the profile answers isn't asked in the answer bank** (an entry with a `source` and no
  answer): the fact has one home, the profile, and a question like the degree needs the posting anyway
  ([answer bank](components/profile-and-templates.md#answer-bank-profileanswersyaml)).
- **Binding an unconfirmed tab trusts the first tab that changes,** with a one-time `postingBound` notice naming the
  page's title, rather than refusing until `tab_bind` ([which posting](mcp-tools.md#forms)).
- **The reference is written for agents.** A "By task" table says what to read for each kind of change, the
  few hard rules sit in a `CLAUDE.md` beside the code they govern, it doesn't restate the code (no per-test
  lists), and a test checks its links and coverage: the agent reads less and still finds the page that matters
  ([conventions](development.md#conventions)).
- **Defaults assumed:** resume page size Letter (bundle normalization;
  [`resume.pageSize`](data-formats.md#ezapplyconfigjson-companionsrcconfigworkspacets)); contributions to other
  people's public repos are added by URL, with claims limited to the user's own commits
  ([contributions](components/github-and-repos.md#contributions-repo_contributions)).

## Not yet verified for real
What's built but hasn't run live, and what to check first. Each site's page lists its own details.

- **The watch for the user's Submit** ([extension](components/extension.md#watching-for-the-users-submit-submit-watchts)),
  tested with stubs. Check on each site: the confirmation page is recognised by `pageKind` and lands on the
  application's host (an embedded form's frame included); the background keeps polling while the tab sits on the
  review page; a report made while `ezapply` was closed arrives on the next start.

- **Antigravity behind the panel** with ezapply itself ([agent](components/agent.md#antigravity-antigravityts)).
  `agy`'s stream, MCP calls, rules, includes, Stop and resume were run live with a stand-in MCP server, not through
  the panel. Check: a posting tailored and a form filled from the panel, how many turns the skills lose to reading each tool's schema, whether `--dangerously-skip-permissions`
  still honours the `repo-cache` deny `init` writes, and whether the
  skills' Claude Code wording (the Edit tool, subagents) trips it. Also that no console window flashes when it
  starts (its auto-updater turned off, verified with `agy` alone), and that switching agents in the panel shows at
  once with the next message starting the new one.
- **Answers delivered as messages** ([agent](components/agent.md#results-as-messages)), tested with the Claude Code
  stub. Check, under both agents: after `review_documents` or `ask_user` returns `pending` the agent ends its turn
  rather than checking again or going on with the step; a review left open past 10 minutes and answered then
  starts the next turn, which reads the `<ezapply-result>` block and acts on it; the panel shows the note, not the
  block; the turn-end notification says the documents are ready to review.
- **A stopped setup task** ([ui](components/ui.md#the-agents-side-tasks)), tested with the Claude Code stub. Check:
  Stop on a setup task in the panel's general conversation turns its line on the setup page to "Stopped before it
  finished" under both agents, and the page names Antigravity when it's the one in use, as the review page does
  (its button reads "Send to Antigravity").
- **Turn-end notifications** ([extension](components/extension.md#notifications-notifyts)), tested with stubs of
  Chrome's API. Check: a notification when a turn ends or a card opens with the browser in the background or the
  panel closed, none for a turn's end while the panel is in view, a question's even then (gone once it's
  answered), and that clicking one brings the window forward and opens the
  panel (Chrome may not count the click as a gesture for `sidePanel.open`).
- **The extension's one-socket connection** ([extension](components/extension.md#connection-companionconnection)),
  tested with a stand-in socket. Check: with the panel open for a long session, the panel's dot stays green and
  `companion.log` shows no run of `bridge: previous connection replaced`.
- **"This tab" on an application in a frame or on its posting's page** ([agent](components/agent.md#the-panels-side-panelts)), tested over the
  bridge only. Check: on a careers page showing a Greenhouse frame, the panel calls the tab an application and
  offers Fill form, before and after `get_form` binds it; and on a Greenhouse board's posting page (the
  posting and the form one page) the same, with the tab's site found as `greenhouse`.

- **The agent settings kept by the extension** ([agent](components/agent.md#permission-mode-model-and-effort)):
  that they show as the panel opens and come back with their agent, that a reconnection (ezapply restarted) gives
  them before the next message starts a process, and that an Antigravity model chosen from the list runs
  (`--model`; the list's format was checked against `agy models` itself).

- **The form-filling fixes,** from live Workday records: Back on the review page (refused as Submit
  before), a returning step's dropdowns read once their values' requests are back (read as empty and refilled
  before), and the agent ticking every attestation. Check that a move to a new step costs no more than before (the
  request wait should end at once there), and `remove_items` clearing a text field. Two Workday changes in one run,
  against the rule: if moves get slower, suspect the request wait ([workday](components/sites/workday.md)).

- **The sites package:** the bundles were compared and hold the same code, and every test passes. Not
  yet seen live: the extension's `hello` with its site ids accepted by the companion (and a stale extension refused
  with "Site mismatch"); a posting's company on a provider's host (now from the registry's `providerHosts` and
  `company`: a Dayforce posting's company now comes from its title or JSON-LD, not the host); and an embedded
  board's frame recognised by the same hosts when access to websites is withheld.

- **The token cuts:** one live Workday application used `go_next`'s and `add_repeatable`'s `form`
  (one `get_form` in four steps). Not yet checked: `remove_repeatable`'s `form`, the `optionCount` cap on a long
  list, and the lint's findings against the PDF. Since then, and not yet run in the panel: the narrowed Claude Code
  (skills, the permission cards, approvals saved in `settings.local.json` and the subscription login all still
  work; PowerShell where Git Bash is missing), a miss's closest options retried without listing first, the cut
  `EZAPPLY.md` and `ezapply-apply` still followed (its supporting files read when they apply), and each round's
  edits and compile in one message. Then compare with the runs before them: a tailoring took 23 API calls and
  read 1.25M tokens of context, a tailoring then an application 36 calls and 2.48M, about 29.7k of it the
  starting context on every call. The Workday nested-menu paths are an adapter change of their own: check them in
  a run with no other Workday change ([workday](components/sites/workday.md#workdays-prompt-searches-and-lists)).

- **Workday's drifted date parts:** a Month/Day/Year date whose page rewrote the month as the first day digit
  landed now enters the drifted parts once more and reads back right in the fixture. Check in a live run with no
  other Workday change: such a date is `ok`, and the trace shows `date parts drifted` only where the page rewrote
  a part ([dates](components/sites/workday.md#dates-typed-into-workdays-split-widget)).

- **Workday's prompt waiting for the list its press loads:** a field of study that fetches its list on the press
  now searches once that request is back, and the fixture's prompt that does the same fills. Check in a live run
  with no other Workday change: a field of study fills by search (the trace shows `typeahead list loading` before
  its query), and skills cost no more than before ([workday](components/sites/workday.md#workdays-prompt-searches-and-lists)).

- **The rename retry:** a run on Windows with the panel open should no longer show "locked by another program"
  for a posting's `meta.json` ([architecture](architecture.md#cross-cutting-concerns)).

- **The preferences in context:** checked that Claude Code loads `profile/preferences.md` through `EZAPPLY.md`'s
  import with the panel's `--setting-sources project,local`, and skips it quietly when missing. Not yet run: a
  tailoring and an application that follow a tone and a "never mention" entry without reading the file
  ([workspace](components/workspace.md#how-it-stays-in-context)).

- **Tailoring edits:** in a live tailoring, check that the agent rereads only the passages it changed (not whole
  files), that a cover letter comes back near a full page (`freeLines` 0–2) without a second page, that the
  python deny sends `.tex` edits to the Edit tool, and that `freeLines` matches the page as rendered. Then that
  an underfilled first draft is refused at review and filled rather than excused, that `short` is used only
  with a real reason, and that the letter's paragraphs follow the evidence rather than the template's two.

- **An approved document in a fill:** with Fill pressed while the tailoring's review is still open, check that
  the fill uploads the document once it's approved rather than reviewing it again, and that `again` is used only
  when the user asked to see or change an approved document.

- **The side panel:** opened by the toolbar button, and a whole application from it with the real Claude Code (setup, a review, question and
  approval cards, Stop, Reset, long waits).
- **Screening questions answered from the profile:** in a live application, the agent computes a sourced question
  (sponsorship, the degree) from the profile without asking, asks when the profile holds nothing there, and offers
  to save that reply into the profile rather than the bank.
- **The review page's per-document approval** in a real browser, with its one button: on to the next document, and
  the send on the last one; and a real resume's links (from `hyperref`) drawn where the text is and opening.
- **Applications side by side:** two postings' Fill form at once, each filling its own tab (both under focus
  emulation), Tailor documents on a third meanwhile, each row's Stop stopping only its own; that each agent's
  `posting_get` is its own posting; and what two agents editing the answer bank at once do (Claude Code's Edit
  refuses a file changed since its read; Antigravity's edits weren't checked)
  ([agent](components/agent.md#conversations-servicets)).
- **Without an active posting** in a real browser: **+ Capture** opens the new posting; the general conversation's
  Reset button (in place of the posting popover) asks, then starts a new session; the This tab line follows the
  posting shown; and the general conversation's agent asks for or looks up a posting's id instead of guessing
  ([which posting](mcp-tools.md#postings)).
- **The panel's list of applications** in a real browser: it opens on the list, a card or a working agent moves an
  application to the top groups, the needs-you line opens the waiting one, and the list reads at 320 px; the pinned
  general card stays put as the list scrolls, its pills and amber state read in both themes, and it fits at 320 px.
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
- **Workday's and Oracle's drivers on the shared ones:** equal golden schemas and behaviour tests.
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
- **Keeping the workspace current:** `ls-remote` against GitHub with the app's token; the Workspace changes card
  in the panel with an edited resume and a pushed repo, through the agent's `update-profile` and `index-repos`
  tasks in the general conversation; a template re-imported from its source; the system's file dialog for a
  template imported from a copy; putting a repo off for a set time; the Tailor documents gate.
- **Setup end to end:** a real GitHub login (and connecting an existing app), adding a public repo by its address
  (anonymous `ls-remote` against GitHub), the agent opening the page at a step while it is open, onboarding's steps against the real
  things, the OS folder dialog, a full onboarding in Claude Code, **Install it** for TeX on each system (MiKTeX by
  winget, Terminal on a Mac, polkit on Linux), and CI's `tex`
  job on GitHub.
- **Opening in the user's browser:** a new tab in the running window, a Chrome user
  with several profiles.

## Known issues
- **"Could not open the dropdown"** on Workday after its own list was read without a choice; the adapter retries
  once, and nothing records whether the retry ran ([details](components/sites/workday.md#workdays-dropdown-finding-its-listbox)).
- **A `go_next` after the user advanced the step themselves** presses the next step's button.
- **The default cover letter test** failed once with MiKTeX and didn't reproduce; capture its `hint` if it recurs.

## Open questions
1. **Bindings live in memory,** so a restart of `ezapply` loses them; the stored `application` still matches
   by tenant and job. Enough?
2. **Title matching on real roles:** compare recorded roles with the pages' titles (`FormSchema.job` in debug
   records) and tune `compareTitles` if real pairs come out `unsure` or `other`.
3. **Postings captured from one job-board results URL** can't be told apart by URL (a capture problem).
