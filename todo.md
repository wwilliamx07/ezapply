# ezapply: todo

Proposals, as of 2026-10-03. Finished work is described in `references/` (what still needs a live run, and
what the live runs found, is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | Modular adapters: live runs left | High | S | — |
| 2 | Embedded application forms | High | M | — |
| 3 | Deterministic autofill: live runs left | High | S | — |
| 4 | Tie each application to its posting | High | M | — |
| 5 | The companion runs the hand-off checklist | High | M | — |
| 6 | Autofill debug mode | High | L | — |
| 7 | More application sites, and Oracle follow-ups | High | M per site | pages saved from real applications (2 for embedded sites) |
| 8 | Show what changed in a document | Medium | M | — |
| 9 | Application tracker | Medium | S–M | — |
| 10 | A skill for building adapters | Medium | M | 6 |
| 11 | Login manager | Medium | L | — |

Suggested order:
1. ~~Autofill phase 1~~ (built 2026-10-01).
2. ~~Debug mode's companion part~~ (built 2026-10-01).
3. ~~Items 4 and 5~~ (built 2026-10-01).
4. ~~A live run with debug mode on~~ (Hooli, 2026-10-01): autofill phase 1, posting matching and the
   checklist; its fixes are in.
5. ~~Autofill phases 2 and 3~~ (built 2026-10-02).
6. ~~Modular adapters~~ (item 1, built 2026-10-03): the engine, Workday and Oracle on it, and Greenhouse, Lever
   and Ashby.
7. **Next:** the live runs (items 1 and 3) whenever the user next applies on Workday or Oracle, with debug mode
   on. They test `strict` and the engine together.
8. Embedded forms (item 2), so Greenhouse and the other boards work inside employers' career pages.
9. The rest of debug mode (item 6): the adapter trace, in the engine, then markup.

Item 10 comes after a site or two more are built by hand from saved pages (item 7).

---

## 1. Modular adapters: a site is a definition (High, L)

**Status:** built on 2026-10-03. What's built is described in `references/components/adapters.md` (the engine,
definitions, shared drivers, waits owned by each site), `sites.md` (Greenhouse, Lever, Ashby) and the protocol's
site registry (`references/components/protocol.md`).
- The registry, the schema facts (`addButtons[].kind`, `Section.saved`, `lastPage`) and per-site waits.
- One engine; Workday and Oracle moved onto it with their fillers unchanged and golden schemas equal.
- Shared drivers, and three new sites chosen by market share among those with public application pages:
  Greenhouse, Lever and Ashby, each checked live with fake values and never submitted.
- No generic definition: a site's page kinds and Submit test come from its own pages, never guesses. Building a
  definition is item 10's skill.

**Left:**
1. **The live runs of Workday and Oracle on the engine.** The move is an adapter change that went in before
   item 3's live runs, so those runs now test `strict` and the move together. Run them with debug mode on and
   compare with the 2026-09-30 runs (`references/status.md`).
2. **A real application on Greenhouse, Lever or Ashby** through the extension, with debug mode on: uploads on
   Lever and Ashby (never tried: they send the file to the provider on attaching), the confirmation page, and
   Set posting on their pages.
3. **Item 6's adapter trace** belongs in the engine: every driver call and wait goes through it now.

## 2. Embedded application forms (High, M)

**Why.** Company career pages often embed their ATS. In the user's postings, Duff's careers page holds an iCIMS
application (`careers.example.com/…?icims=1`), and Initrode's (`careers.example.org/…?gh_jid=…`) holds
Greenhouse's. The form tools act on a whole tab, chosen by the tab's URL (`resolveTab` in
`background/forms.ts`), so a form inside a frame is never found. Capture already handles this for postings:
`capture/frames.ts` picks the frame that holds the posting, and `meta.json` keeps its `frameUrl`.

**How.**
- **Find form frames.** The background asks each frame of the tab for its URL (`scripting.executeScript` with
  `allFrames`; only frames on hosts the extension may access answer) and runs the registry's `isUrl` (item 1)
  on each. `browser.status` lists, per tab, `frames: [{ frameId, url, site }]` for the frames on a form site.
- **Target a frame.** Form methods take a `frameId` next to the `tabId`, and `callAdapter` injects into
  `{ tabId, frameIds: [frameId] }`. `FormSchema` gains `frameId`. Each frame gets its own adapter instance and
  submit guard.
- **Choose the frame.** `FormsService.target` picks the tab, then the frame on the posting's tenant (by the
  frame's URL), then any form frame. When the top frame is the form itself, nothing changes. For a posting
  captured from an embedded board, its tenant and job come from `frameUrl`.
- **Forms rendered straight into the company's page** (no frame): recognised by a DOM signature in the site's
  definition (a `form` posting to `greenhouse.io`, Greenhouse's embed container), on origins the user grants at
  Set posting, as Oracle's are.
- **Permissions.** Each embedded provider's hosts (Greenhouse, iCIMS, Lever, Ashby…) are optional host
  permissions. They're asked for once, at Set posting on a page that embeds one (the click is the user gesture
  Chrome needs), and listed in the options page, as Oracle's origins are.
- **What stays per tab:** `tab.show`, `screenshot` (the whole tab) and the hidden-tab check.

**Tests.**
- Background: a tab's form frames listed with their sites, and injection aimed at one frame.
- e2e: a fake tab whose page holds a form frame. `get_form` reads the frame, the posting is credited by the
  frame's tenant, and the submit guard runs in the frame.

**Challenges and open questions.**
- A frame's id changes when it reloads. The companion resolves the frame again on every call, never caching it.
- Some embeds move to a new frame on each step. A frame that disappears mid-call fails the call, as a closed tab
  does.
- Greenhouse, the most common embedded board, is built (item 1); iCIMS isn't yet (item 7).

## 3. Deterministic autofill (High, L in three phases)

**Status:** all three phases built (phase 1 on 2026-10-01, phases 2 and 3 on 2026-10-02). What's built is
described in `references/components/autofill.md`. Phase 1 ran live once (Hooli); phases 2 and 3 were replayed on
that run's recorded pages, not yet run live.

**Left: the live runs.** In order, so a problem points at one change. Workday and Oracle now run on item 1's
engine (moved 2026-10-03, before these runs), so each also tests that move:
1. A Workday run with debug mode on (`ezapply debug on`, then `ezapply debug report`). It checks rows (adding them,
   mapping them, the language levels), computed answers and the chunked fills, and two adapter changes: `strict`
   and the move onto the engine. If it's slower than the 2026-09-30 runs, compare the debug records' timings with
   those runs and suspect the engine's fill loop, then `strict`, then the suspects in "One adapter change per
   live run" (`references/development.md`).
2. An Oracle run: the link fields, and the work, education and language entries added through their inline forms.
   The work and education forms have never been seen, so their dates are matched by label on trust, and the
   language levels by the wordings the fixture models.

**Open questions, to answer from those runs:**
- **A wrong fill now happens silently.** The safeguards are the section-fit check, `filled` in the result, and
  the automatic fills listed at the hand-off. Is a glance at `filled` on each step enough?
- **Country and province names.** The profile may hold "ON" where the list says "Ontario". A strict miss goes to
  the model; the debug report's loose-match section shows which aliases come up.
- **Role descriptions** are the profile's highlights as stored, not tailored to the posting as the resume is. The
  replay showed the agent reword one. Keep as stored?
- **Language levels** are one level per language for every skill (reading, writing, speaking). The agent rated
  one language's reading and writing a step lower. Keep one level, or add per-skill levels to the profile?
- **How compact `filled` must be.** The model needs the label to notice a wrong value, but every label costs
  tokens. Measure on the next live run.
- **Workday's certification rows and Oracle's licenses** aren't filled: no live run has shown their fields.

## 4. Tie each application to its posting (High, M)

**Status:** built on 2026-10-01: requisition matching from the URLs, and refusing calls that change the page
(`references/mcp-tools.md`, "Which posting"). Left: the live check on the sign-in redirect, and the job-title
fallback and the evidence in results, both left out until a live run shows they're needed.

Also covers "stronger application form identification".

**Now.** The form tools pick a tab on the posting's tenant (`siteTenant`), and a tab on another tenant gets
`postingMismatch`. Its fills still run; only the log and the status are skipped.

**How.**
- Match by requisition too: two postings at one company share a tenant. `meta.json` already has `reqId`,
  from the posting's JSON-LD or Workday's posting data. Read the job from the application tab's URL: Workday's
  apply URL keeps the job path (`/job/<location>/<title>_<reqId>/apply/…`, or `/details/<title>_<reqId>/apply`
  on some tenants), and Oracle's has `/job/<id>/apply/…` (`oracleJobPath`). Fall back to the job title the page shows.
- On a mismatch, stop: the fill tools refuse with `posting_mismatch`, and the hint says to activate the right
  posting or switch tabs. `get_form` still reads, so the agent can see where it is.
- Results carry `posting` with the evidence used (tenant, requisition, title), so the agent and the log show
  why a tab was picked.

**Challenges and open questions.**
- Does the job path survive Workday's sign-in redirect and every step? It needs one live check. If it doesn't,
  remember the requisition per tab when the posting page's Apply is pressed (`page_action apply`).
- A posting captured from a job board (no tenant, no requisition) can't be matched. Keep allowing it with a
  warning, or ask the user once per tab?
- "Form identification" could also mean recognising page kinds better (fewer `unknown`). There's no data on
  how often `unknown` happens; debug mode (6) would show it.

## 5. The companion runs the hand-off checklist (High, M)

**Status:** built on 2026-10-01 (`references/mcp-tools.md`, "The hand-off checklist"). The warnings are given
during the step too, on `get_form` and `autofill_step`, so most are fixed before `go_next` instead of after a
`go_back`. Required fields still empty aren't checked: Workday reports those itself on `go_next`. Left: a live
run.

**Why.** The hand-off list in `ezapply-apply` (documents attached, every add-button section filled, files left
from a previous application removed, answers from the user or from judgment flagged) is kept by the model from
memory over many steps. Live runs missed parts of it: the cover letter twice (now caught by `notAttached`),
and sections that start empty are easy to miss. With autofill (item 3) it also lists what was filled
automatically, by section. The companion already has most of the facts: `form-log.jsonl`,
`approvals.json`, `profile.yaml` and every `get_form` it served.

**How.**
- The companion keeps per-application state as steps go by: sections seen with their row counts, add buttons
  and which profile list each maps to (work, education, languages, certifications, links), required fields
  still empty at `go_next`, uploads and removals.
- `go_next` adds `checklist` warnings for the step it leaves, such as "profile has 3 work entries, the page has
  2" or "Languages section left empty, profile has 2".
- On the review page (or Oracle's Submit-only page), `get_form` returns the whole checklist: each item with
  `ok` and detail, plus every `user` and `judgment` answer from the log. The skill tells the agent to pass it on
  and fix the failures, not to rebuild the list itself.

**Challenges and open questions.**
- Mapping a section to a profile list is a heuristic on section ids and titles (`add.work-experience`). A wrong
  map gives a false warning, so word warnings as things to check, not errors.
- A row count can be right on purpose (the user left out an old job). The agent may override an item with a
  stated reason.
- Oracle's one-page forms and saved inline items count differently from Workday's rows.
- Should the checklist block anything? Proposal: no. It informs; the user still presses Submit.

## 6. Autofill debug mode (High, L)

A config flag that makes every form call dump everything needed to debug it.

**Why it's needed.** Almost none of the adapters' markup knowledge comes from a real application step.
`extension/test/fixtures/live/` holds Workday's posting, start-choice and sign-in pages, and Oracle's job page,
email step and one single-page application the user saved by hand. No Workday application step has ever been
saved, and those are the pages where every filler runs. The behavioural fixtures (`workday-fixture.ts`,
`oracle-fixture.ts`) are built from what the adapter expects. A test passing against them shows the adapter
agrees with itself, not that it agrees with Workday.

A live run leaves almost nothing behind. The agent gets a one-line result ("Could not open the dropdown", "No
removable row"), `form-log.jsonl` records the value and `ok`, and the page that produced the failure is gone
once the agent retries or moves on. The Oscorp runs left several failures that can't be explained from that:
- 12 dropdowns that didn't open on the first try
- language rows that filled `ok: true` and were empty after Save and Continue
- Back landing on step 1 once and step 5 another time
- `upload_file` saying "Unknown field" after the review page
- dates needing a second entry
- `remove_repeatable languages-3` finding "No removable row"

The remove controls (`DELETE_charm`, `delete-file`, `panel-set-delete-button`) have never been seen live at
all. The 2026-09-28 slowdown was never traced, because nothing records where a fill's time goes. Every fix for
these has been a guess, and guesses bundled together are how e390fef broke autofill (see "One adapter change
per live run" in `references/development.md`). With debug mode on, one live run records what the page looked
like, what the adapter did to it, what changed in response, and how long each wait took. Claude, working in
this repo, can then read that record, find the cause, and turn it into a test that fails before the fix.

A flag, not a tool the agent calls: the agent doesn't know a call went wrong until after it has happened, and
by the time it would call a snapshot tool the page has moved on. The flag records every call from the start,
including the first failure, and none of it enters the conversation. `screenshot` is no substitute. An image
shows what the user sees, not the automation ids, roles, `aria-*` attributes and nesting the selectors
depend on, and it can't be replayed in a test.

**The flag.** `ezapply.config.json` gets
`debug: { autofill: false, markup: "failures", maxMB: 500 }`.
- `autofill` turns debug mode on.
- `markup` says when to save page markup: `"failures"` (default: before each call, and at every failed
  field), `"always"` (also after every call), or `"none"`.
- `maxMB` caps `debug/`: the oldest sessions are deleted past it.

Like `autofill-timing.yaml`, the config is read on every form call, so turning the flag on mid-application
takes effect on the next call without a restart. `ezapply debug on|off` sets it from the command line.
While it's on, `get_form` results carry `debug: true`, so the user doesn't leave it on without knowing.

**What gets dumped, for every form call** (`autofill_step`, `get_form`, `list_options`, `search_options`,
`fill_fields`, `upload_file`, `remove_items`, `add_repeatable`, `remove_repeatable`, `go_next`, `go_back`, `page_action`):
- **The call.** Tool, parameters, the full result before the companion slims it for the agent, and any
  error. Also the timing config in effect, the extension version, the browser, the site, tenant and step,
  and the companion's own timings (time queued behind other calls on the tab, bridge round trip).
- **An adapter trace.** An ordered event list from inside the adapter:
  - every selector query and how many elements matched
  - every click, key and input event dispatched, and on which element (automation id, role, label)
  - every wait: its kind, the planned and actual time, and whether it ended by the condition, by quiet or by
    timeout
  - every branch taken: the dropdown re-open (`openListboxRetrying`), the `onClick` fallback, the date's
    second entry, a typeahead's search attempts
  - for dropdowns: the listboxes found, which one was read, the options seen, and how the value matched
    (exact, parenthetical, no match)
  - per field: start, end, `ok`

  This covers per-field timings: the trace shows which fields and which waits took the time.
- **Page state around the call.** URL, step title and index, `document.visibilityState`,
  `document.hasFocus()`, whether the tab was active, and its window's state. This is how a slow call gets
  matched to a hidden tab (`tab.show` only says whether the page was hidden at the start of a call).
- **DOM changes during the call.** A `MutationObserver` on the form, summarised rather than raw: nodes added
  and removed (tag, automation id, role), and changes to `aria-expanded`, `aria-selected`, `aria-invalid`,
  `value`, `disabled` and `hidden`. This shows a listbox opening and closing, or Workday re-rendering a
  section and dropping rows the adapter had filled (the language rows).
- **Page errors and requests.** In the page's MAIN world, while the call runs:
  - `window.onerror`, unhandled rejections and `console.error`
  - `fetch` and XHR calls: method, path, status and duration, never bodies

  A step whose save request failed, or a widget throwing, shows up here and nowhere else.
- **Markup** (per the `markup` setting). The body with scripts, styles, SVG contents and inline handlers
  removed, as the Oracle snapshot was cleaned by hand. Saved before the call, and at the moment a field
  fails: that field's section plus any open popup or listbox, while they're still on screen. Values are kept,
  because debugging needs them (a field that should hold a value and doesn't).
- **A screenshot at each failure**, when the tab is on screen. It goes to disk, never into the conversation.

**For `autofill_step` (item 3), the plan as well.** The planner runs in the companion, so its record needs no
adapter change. Per field it holds:
- the rule tried and its outcome: the hint and whether the section fit; the answer entry and which variant
  matched; the value before and after formatting; the strict match and the read-back;
- each skip with its reason;
- the row mapping (which row went to which profile entry, and why), the add presses, and the second pass.

Its dump also holds what the model did next on the same step: the following `fill_fields` and whether it
changed an automatic fill. A wrong rule shows up as a value the planner chose and the model or user
replaced.

**Where it goes.** `debug/<date>-<postingId>/` in the workspace:
- `index.jsonl`: one line per call (sequence number, tool, ok, duration, failed fields, slow paths taken,
  tab hidden or not; for `autofill_step` also how many fields were filled, left, failed and replaced). Reading
  starts here.
- `NNNN-<tool>.json`: the call, the trace, page state, DOM changes, errors and requests, and for
  `autofill_step` the plan.
- `NNNN-before.html`, `NNNN-after.html`, `NNNN-fail-<fieldId>.html`, `NNNN-fail-<fieldId>.png`.

**Implementation, in three parts.** They can land separately, the companion part first, because it changes
nothing in the page. **Part 1 was built on 2026-10-01**: `ezapply debug on|off|report|clean`, the records,
`index.jsonl`, the autofill plan, `maxMB`, and the read deny. See `references/data-formats.md` and
`development.md`, "Debugging a live run". The report is the CLI command `ezapply debug report`. Parts 2 and 3 are still to do.
1. **(S–M) Companion only.** The call, the full result, the companion's timings, and the autofill plan. No
   adapter change, so it can ship with or right after autofill phase 1 and record that feature's first live run.
2. **(M) The adapter trace and page hooks.** An adapter change, with its own live run.
3. **(M) Markup, screenshots and `ezapply debug export`.**

- *Adapter* (`extension/src/adapters/engine/trace.ts`): a `trace` object the engine calls at the points
  listed above: one place, since every driver call and every wait goes through the engine (item 1). It's a no-op unless debug is on. The extension sets it with `setDebug(options)` next to `setTiming`, in
  the same `executeScript` (`extension/src/background/forms.ts`, `callAdapter`). The adapter returns
  `{ __ok, __debug }`. The companion strips `__debug` before anything reaches the agent.
- *Page hooks*: the error, console and request hooks, and the mutation observer, install at the start of a
  debugged call and come off at its end, so a call without debug runs exactly as today.
- *Size*: markup and traces travel back through the bridge (64 MB `maxPayload`). A Workday step's cleaned
  body is well under that, and screenshots are taken in the background script, not sent from the page.
- *Companion* (`companion/src/forms/service.ts`, `onTab`): reads the flag, passes it with the timing, and
  writes the files after the call returns (or times out: then whatever the page had sent, plus the timeout).
  Writing is off the call's critical path.
- *Old extension*: an extension without `setDebug` still fills. The companion notes once in the dump that
  no trace came back.

**It must not change what it measures.** The 2026-09-28 slowdown shows the adapter's timing is sensitive. The
mutation observer and markup serialisation add work to the page while Workday is rendering. Keep the
observer's records small, serialise markup only at the points above, and mark every `index.jsonl` line
with `debug: true`. A debugged run's timings are compared with other debugged runs, not with runs without
debug. Before landing, compare one step's timings with debug on and off on the behavioural fixture.

**Privacy.** The dumps hold the user's personal data: filled values, the page, screenshots.
- They stay in `debug/` in the workspace and are never sent anywhere.
- The flag is off by default.
- The workspace's `.claude/settings.json` denies the in-workspace agent reads of `debug/**`, as it denies
  writes to `repo-cache/`. The dumps are for debugging ezapply, not for the applying agent, and they would
  only cost it context.
- `ezapply debug clean` deletes them.

**Turning a dump into tests.** `ezapply debug export <session> <NNNN>` writes a fixture candidate from a
saved markup file:
- values blanked (inputs, the chosen option shown on a dropdown button, pill labels, file names)
- a second pass replacing every string from `profile/profile.yaml` (names, email, phone, address,
  employers, schools), with the count replaced
- a header comment in the existing style (site, tenant, page kind, step, date, what was removed)

It goes into `extension/test/fixtures/live/` only after the user has looked at it and agreed. It's
third-party markup and could still hold something the scrub missed.

**The loop it enables** (Claude in this repo, after a live run with debug on):
1. `npm run debug:report <dir>` summarises a session: failed fields grouped by error, the slowest fields and
   waits, waits that ran to their maximum, slow paths taken, and time spent with the tab hidden. For autofill
   it adds:
   - automatic fills the model or user later changed, which point to a wrong rule;
   - automatic fills that failed, by rule;
   - fields the model filled with `source: profile` that no rule covered, with automation id, label and
     section. These are candidates for new hints or row labels (phase 3 of item 3 came from the first such
     list: education years, website rows, language rows);
   - strict-match misses with the options seen, which are candidates for an alias.
2. For a failure, read its `NNNN-*.json` trace and the `fail-` markup to find where the adapter's picture of
   the page and the real page diverged.
3. Export the markup, and add an extraction test in `workday-live.test.ts` / `oracle-live.test.ts`. jsdom
   doesn't run Workday's scripts, so a snapshot can't test a filler's behaviour directly: correct the
   behavioural fixture to match the real markup and events the trace shows, and write the filler test there.
4. For autofill: run `extract()` on the exported step to get its real schema, and add the planner's output for
   a test profile as a test. Unlike a filler, the planner never touches the page, so a saved page tests it
   completely.
5. Fix, then re-run live with debug on and compare the two reports.

**Tests.**
- Adapter: with debug off, nothing is traced and no hook is installed. With debug on against the
  behavioural fixture: a filled dropdown's trace lists the open, the listbox read and the match; a failed
  one has its `fail-` markup; waits report planned and actual times.
- Companion: `__debug` never appears in a tool result; files land under `debug/`; `index.jsonl` is written;
  `maxMB` prunes the oldest session; a timed-out call still gets a dump.
- Export: a filled fixture exported has no values and no profile strings, and `extract()` on it gives the
  same fields and ids.
- Autofill: an `autofill_step` dump holds the plan with a reason for every field; the report finds an
  automatic fill that a later `fill_fields` changed.

**References**: `data-formats.md` (the flag, `debug/` layout), `components/workday-adapter.md` and
`components/oracle-adapter.md` (the trace points), `components/extension.md`, `components/companion.md`,
`components/cli.md` (`ezapply debug`), `components/workspace.md` (the read deny), `security.md` (what's
dumped, where, the consent step), `development.md` (`debug:report`, "Add a job site": debug a first live
run).

**Challenges and open questions.**
- The trace calls touch every filler. Landing them is itself an adapter change, so the first live run with
  debug off must match the Tyrell run's timings before the trace is trusted.
- Screenshots need the tab on screen. A failure on a hidden tab gets markup only.
- Without debug mode, autofill has only the `rule` on each `form-log.jsonl` event to go on. That's enough to
  count wrong and missing rules, but not to see the page that caused them.

## 7. More application sites, and Oracle follow-ups (High, M per site)

**Sites.** Each new site is a definition on item 1's engine, chosen by how many employers use it (market-share
counts, `references/components/sites.md`), not by one user's postings. Built: Workday, Oracle, Greenhouse,
Lever, Ashby. Next, the most common left, each needing pages saved from a real application because public
pages can't be used:
1. **iCIMS:** blocks headless browsers; also often embedded in the employer's page (item 2).
2. **SuccessFactors** and **Taleo:** applications behind a candidate account on each employer's site.
3. **SmartRecruiters:** bot protection (DataDome) on its application pages. Never worked around.
4. **BrassRing:** behind a candidate account.

For each: the user starts an application in their own browser and saves each step's page (item 6's markup
export makes one run enough), then the steps in "Add a job site" (`references/development.md`).

**Oracle follow-ups** (`references/components/oracle-adapter.md`): re-run a live application to confirm the
fixes from the first one and add languages and certifications; find out why the Cover Letter field was missing
live (save the page); move the posting to `filled` when an Oracle form is complete (it has no review page);
the multi-select dropdown (preferred locations) and JET comboboxes, now left to the user; button texts in other
languages.

**Challenges and open questions.**
- Each site needs a real application step saved. Debug mode (6) makes the first live run produce it.
- Account-based sites (SuccessFactors, Taleo, BrassRing, iCIMS) start with sign-in or account creation, which
  is the user's (item 11), and often an "upload your resume to prefill" step before the form.

## 8. Show what changed in a document (Medium, M)

**Why.** In the 2026-10-01 session the user asked "wheres the changes" after a revision, and the agent had to
read the PDF's text back to show them. Each review round is a full re-read for the user. `tex_diff` exists, but
compares the template with the tailored file, needs latexdiff, and isn't on the review page.

**How.**
- Keep the text of each reviewed version: when a review opens, store the PDF's text (as `pdf_text` reads it) per
  file in the review session, and the last reviewed text per document in the posting folder.
- The review page shows, beside each PDF, "Changed since you last reviewed it": a word-level diff of the two
  texts, insertions and deletions marked. The first review of a document has no diff.
- The agent's report after a revision can quote the same diff instead of re-describing it.

**Challenges and open questions.**
- Text from a PDF has hyphenation, ligatures and line breaks that make noisy diffs. Normalise them first,
  or diff the `.tex` source with the LaTeX commands stripped instead?
- latexdiff's highlighted PDF is clearer but needs Perl and latexdiff (an extra install on Windows). Keep it
  optional, as `tex_diff` is now.
- Should approvals be per diff ("approve these changes") or stay per version? Per version keeps the
  hash-based guarantee simple; the diff is only a reading aid.

## 9. Application tracker (Medium, S–M)

**What.** "What's in flight?": each posting's status, deadline, date submitted, and postings drafted but not
applied to. `meta.json` has `deadline` and `status`; `form-log.jsonl` has the confirmation step.

**How.**
- `postings_list` gains `deadline`, `submittedAt` (from the log) and a filter for postings not yet submitted,
  sorted by deadline.
- An `ezapply-status` skill formats it, and suggests the next action per posting (tailor, review, fill,
  submit).
- `ezapply status --postings` prints the same table without starting Claude, at no token cost.

**Challenges and open questions.**
- `deadline` is set only when the agent finds one in the posting, so many will be empty.
- Outcomes after submitting (interview, rejected) aren't in the `status` enum. Adding them is a `meta.json`
  format change (`schemaVersion`) and they'd be set by hand. Worth it?
- Reminders: Claude Code's scheduled tasks only run while a session is open. Real reminders need the OS
  scheduler or a calendar, which is more than this needs. Leave out at first.

## 10. A skill for building adapters (Medium, M)

**What.** A skill in this repo (`.claude/skills/`, for Claude working on ezapply, not the workspace) that walks
through adding a site: saving the site's pages, writing its registry entry and definition (item 1) against
the saved markup, the fixture, the conformance test, permissions, a first live run with debug mode on, reading
its report, and the site's reference page.

**How.** The steps are "Add a job site" in `references/development.md`. The skill links to that and adds the
procedure around it: what to save, in what order to build, which tests to write first, and the checklist for
the live run. It should not copy development.md's list, or the two will drift.
- It brings the live-check script used for Greenhouse, Lever and Ashby
  (`references/components/adapters.md#checking-a-site-live`) into the repo, with this machine's paths made
  options: headless Chrome or Edge over the DevTools protocol, the site's built bundle injected into the page's
  main world, the adapter's methods called with fake values, never Submit, no uploads to a third party.

**Challenges and open questions.**
- The hard part is getting real markup of application steps, which needs an account and an application in
  progress. The user has to drive that; debug mode (6) makes one run enough.
- Its worth depends on how many sites get added. With one or two more, `development.md` may be enough.

## 11. Login manager (Medium, L)

**Why.** Workday wants an account per employer, and Oracle sends a code to the email each time. Signing in is
the step where the user does the most typing. The skills now say: never fill passwords or account forms.

**Options.**
- **Lean on the browser's password manager.** No change to ezapply: the skill tells the user to let the browser
  create and save the password on a new Workday account. ezapply could fill the email on the auth page, which
  isn't secret and is in the profile. Small, and no new risk.
- **ezapply keeps the passwords.** Generate a password per tenant, store it in the OS credential store
  (Windows Credential Manager, macOS Keychain, libsecret), and have the extension fill the sign-in form from
  the companion, never through an MCP tool, so the model never sees it. Only on the posting's tenant host, as a
  password manager binds to an origin.

**Challenges and open questions.**
- The second option makes the companion a store of secrets, which `security.md` doesn't cover now: what the
  local HTTP server, the bridge token and the extension could leak.
- Creating an account means accepting the employer's terms. That stays the user's act, so a "manager" can
  sign in but shouldn't sign up.
- Email codes (Oracle, Workday's verification) still need the user, unless ezapply reads their mail, which is
  out of scope.
- Recommendation: the first option now. Revisit the second only if signing in is still the slowest part of an
  application after items 3–6.
