# ezapply: todo

Proposals, as of 2026-10-01. Finished work is described in `references/` (what still needs a live run, and
what the live runs found, is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | Deterministic autofill | High | L (three M phases) | — (4 helps phases 2–3) |
| 2 | Tie each application to its posting | High | M | — |
| 3 | The companion runs the hand-off checklist | High | M | — |
| 4 | Autofill debug mode | High | L | — |
| 5 | More application sites, and Oracle follow-ups | High | L per site | 4, 7 help |
| 6 | Show what changed in a document | Medium | M | — |
| 7 | More modular adapters | Medium | L | 4 |
| 8 | Application tracker | Medium | S–M | — |
| 9 | A skill for building adapters | Medium | M | 4, 7 |
| 10 | Login manager | Medium | L | — |

Suggested order:
1. ~~Autofill phase 1~~ (built 2026-10-01).
2. ~~Debug mode's companion part~~ (built 2026-10-01).
3. ~~Items 2 and 3~~ (built 2026-10-01).
4. **Next: a live run** with debug mode on (`ezapply debug on`). It checks autofill, posting matching and the
   checklist together; none of them changed the adapter, so a slowdown still points at the adapter's own
   suspects. Read it with `ezapply debug report`.
5. The rest of debug mode (the adapter trace, then markup), one adapter change per live run.
6. Autofill phases 2 and 3, each adapter change in its own live run. The companion-only parts (Workday rows,
   computed answers, language rows) can land before them, but after step 4, so any wrong fill from the first
   run is traced to one feature.

Items 5, 7 and 9 come after debug mode.

---

## 1. Deterministic autofill (High, L in three phases)

**Status:** phase 1 built on 2026-10-01 (`references/components/autofill.md`), and waiting for its live
run. Building it added one rule not planned here: a saved variant phrased the other way round ("I do NOT
require…" under "Do you require…?") is never filled (`reversed-wording`), because only the model flips yes
and no. What's below is the plan; phases 2 and 3 are still to do.

**Why.** In the four applications of 2026-09-30 and 2026-10-01 (Tyrell, Hooli, two Umbrella), the agent made 128
fills:

| Source | Fills |
|--------|-------|
| `profile` | 87 |
| `judgment` | 17 |
| `user` | 15 |
| `answer-bank` | 7 |
| `computed` | 2 |

So about three in four fills copied a value the companion already has. About 50 of the 87 profile fills were
on fields the extractors already hint (`hint.profileKey`, including Oracle's EEO codes). The rest were:
- education years (`firstYearAttended`, `lastYearAttended`);
- website rows (`siteLink-2`);
- language rows (language, native, and proficiencies under hashed ids);
- the skills list;
- screening questions the agent answered from the profile.

Each step today puts the whole schema into the conversation, and the model writes every value back out in
`fill_fields`. Every turn re-sends the conversation, so this costs tokens on every later turn too. A
deterministic pass costs fewer tokens and turns, gives the same answer every time, and leaves the model's
attention for the fields that need it.

**What changes for the agent.** A new form tool, `autofill_step { tabId? }`, replaces the step's first
`get_form`:
1. It reads the step (`form.get`).
2. On Workday, it adds rows until the page's work and education rows match the profile (see **Rows**).
3. It plans fills from the rules below and sends them in one `form.fill`.
4. It reads the step once more, for fields that appeared because of a fill (a province list after the country,
   the end date after unticking "I currently work here"), then plans and fills those.
5. It returns:
   - `filled`: `{ fieldId, label, value, rule }` per field, kept short;
   - `replaced`: pre-filled values it overwrote, `{ fieldId, was, now }`;
   - `failed`: fill results that didn't take, with `error` and `availableOptions`, or `inexact` with what got
     selected;
   - `left`: the step as `get_form` would show it, but only the fields it didn't fill, each with a `reason`
     (`no-rule`, `sensitive`, `eeo-unset`, `multi-select`, `file`, `no-strict-match`, `extra-row`), plus
     sections, add buttons, errors and `nextLabel`;
   - `posting`, `tabHidden` and the other notices, as on every form call.

The `ezapply-apply` step becomes: `autofill_step` → glance over `filled` → decide `left` as now (answer bank by
meaning, ask the user, judgment) → fix `failed` → one `fill_fields` → `go_next`. The model stays the
reviewer: it sees every value that went in, without having to write each one.

**The planner** (`companion/src/forms/autofill.ts`) is a pure function,
`planStep(form, profile, answers, posting) → { fills, left, rows }`. It has no DOM and no adapter calls, so it
is unit-tested on its own and can run on schemas extracted from saved live pages (item 4). For each field, the
first rule that applies decides:

1. **Never automatic** (the field goes to `left`):
   - `password` and `file` fields;
   - a `typeahead` with `multiple` (which skills to list is judgment);
   - a field in a row the planner didn't map to a profile entry;
   - an answer-bank entry with `sensitive: true` or `answer: null` (`salary_expectation` is both).
2. **Profile hint** (`hint.profileKey`), only where the field's section fits the key:
   - `work[]` only in `work-experience-N` rows, and `education[]` only in `education-N` rows;
   - `contact.*` not in sections about references or emergency contacts.

   Values, formatted for the widget:

   | Key | Value |
   |-----|-------|
   | `identity.*`, `contact.email`, address lines, city, postal code, `links.*` | as stored |
   | `contact.address.country`, `contact.address.region` | as stored, matched strictly (see below) |
   | `contact.phone.countryCode` | the option naming the profile's country ("Canada (+1)"), never by "+1" alone (Canada and the US share it) |
   | `contact.phone.type` | `mobile` → "Mobile" |
   | `work[].start`, `work[].end`, `education[].start`, `education[].end` | `YYYY-MM`, or `YYYY` when the field's `dateParts` has only a year |
   | `work[].end` = null | "I currently work here" ticked; the end date left empty |
   | `work[].highlights` | the bullets joined by line breaks |
   | `education[].school`, `degree`, `field` | matched strictly; a miss goes to `left` with the options seen |
   | `eeo.*` | only when set in the profile; otherwise `left`, and the skill asks |
   | `answers.<id>` | that answer-bank entry, as in rule 3 |
3. **Answer bank by wording.** The field's label equals an entry's `canonical` or one of its `variants`, both
   normalised: lowercase, Unicode NFKC, spaces collapsed, punctuation and a trailing "*" or "(required)" taken
   off.
   - Equality only, nothing fuzzy, so "I do NOT require sponsorship" can't match "Do you require
     sponsorship?".
   - The value is `byCompany[<posting company>]`, else `default`, else `answer`.
   - Entries with `source: profile.…` (sponsorship, relocation, start date) are resolved from the profile in
     phase 2.
4. **Already right:** the field's `currentValue` equals the planned value. It's skipped, and counted as kept.
5. Anything else goes to `left` with `no-rule`.

**Options must match strictly.** The adapters' `matchOption` falls back to a prefix or substring match, so
"Yes" picks "Yes, I will require sponsorship" when that is the only option starting with "Yes". That is fine
for the model, which reads the read-back. It isn't fine for a pass nobody checks field by field.
- Radio and checkbox-group options are in the schema. The planner matches them strictly (the exact text, or
  the label without its parenthetical, or the parenthetical alone) and sends the exact option, or leaves the
  field.
- Dropdowns and typeaheads list their options only when opened. In phase 1 the planner sends the value and
  checks the read-back strictly. A read-back that isn't a strict match goes to `failed` as `inexact`, with what
  got selected. The field holds that wrong value until it's fixed, so the skill says to fix every `failed`
  entry before `go_next`.
- In phase 2, `form.fill` takes `strict: true` per fill, and the adapter refuses instead of picking a near
  match. That is an adapter change, so it gets its own live run.

**Rows (Workday).** Work and education rows are sections named `work-experience-N` and `education-N`.
- Rows are matched to profile entries in two passes. First, rows whose company or school already equals an
  entry, as on a form pre-filled from the last application. Then the remaining rows, in profile order.
- With fewer rows than entries, the planner presses the section's add button (`add.work-experience`) and reads
  the step again after each press, until the counts match.
- With more rows than entries, nothing is removed. The extra rows go to `left` as `extra-row`, and the model
  decides with `remove_repeatable { sectionId, reason }`. Removing a row is destructive, and the user may want
  an older job on the form.
- Oracle's inline add-and-save item forms come in phase 3.

**Values carried over from a previous application.** Text, dropdown, radio and date fields are overwritten
with the profile's value and listed in `replaced`, so the hand-off can name them. Multi-selects and files are
never touched (they go to `left`), because filling only adds to them; clearing them stays the model's job, as
now.

**Logging.** Fill events in `form-log.jsonl` keep `source: profile` or `answer-bank` and `answerId`, and add
`auto: true` and `rule`, such as `hint:contact.email`, `answer:how_heard` or `row:work[1].title`. The hand-off
lists answers from the user and from judgment as now. The checklist (item 3) adds the automatic fills by
section.

**Config.** `forms.autofill` in `ezapply.config.json`, `"on"` (the default) or `"off"`. When it's off, `autofill_step` fills nothing and returns the whole step in `left`, so a
run can be compared with and without it.

**Phases.**
1. **(M) Profile facts and literal answers, no adapter change.** The planner with rules 1, 2 (without rows),
   3 (answers that are plain values only) and 4; `autofill_step`; the strict read-back check; the skill
   change. It uses `form.get` and `form.fill` as they are. Then one live run, compared with the Tyrell and Hooli
   runs on turns per step, tokens (from the session transcripts), fill time and wrong values.
2. **(M) Rows, strict matching, computed answers.** Workday rows; `strict: true` in the adapter (its own live
   run); answer entries with `source: profile.…`.
3. **(M) Wider coverage, from the logs.** Hints for education years (`firstYearAttended`,
   `lastYearAttended`) and website rows (`siteLink-N`). Language rows matched by label within a languages
   section, because their proficiency fields have hashed ids. Oracle's item forms.

**Tests.**
- Planner, table-driven:
  - each formatting rule;
  - a reversed-polarity variant doesn't match its opposite;
  - `byCompany` beats `default`;
  - `sensitive` and `null` answers are left;
  - a value that's already right is kept;
  - a `city` field in a references section is left;
  - rows are mapped by company before order;
  - the province list is filled on the second pass after the country.
- Companion end-to-end, with the Workday behavioural fixture: `autofill_step` fills the name-and-address step,
  logs `auto` events, and leaves only the screening questions in `left`.
- With debug mode (item 4): planner tests over steps exported from live runs.

**Challenges and open questions.**
- **A wrong hint now fills silently.** The safeguards are the section-fit check, `filled` in the result, and
  the automatic fills listed at the hand-off. Is a glance at `filled` on each step enough, or should the user
  see them only at the hand-off?
- **Country and province names.** The profile may hold "ON" where the list says "Ontario", or "United States"
  where it says "United States of America". Add a small alias table, or leave every strict miss to the model?
  Start with the strict miss going to `left`; the debug report (item 4) shows which aliases come up.
- **Role descriptions.** Copy the profile's highlights as they are, or tailor them to the posting as the
  resume is? Default: copy as they are.
- **Size of one fill.** A step with three work rows is about 25 fields. The Tyrell step of about 20 fields
  took 22 s, well under the 120 s fill timeout, but split the fill by section if a step plans more than about
  40 fields.
- **`authorizedIn` needs the posting's country**, and `meta.json`'s `location` is free text. This is for
  phase 2.
- **How compact `filled` must be.** The model needs the label to notice a wrong value, but every label costs
  tokens. Measure on the first live run.

## 2. Tie each application to its posting (High, M)

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
  how often `unknown` happens; debug mode (4) would show it.

## 3. The companion runs the hand-off checklist (High, M)

**Status:** built on 2026-10-01 (`references/mcp-tools.md`, "The hand-off checklist"). The warnings are given
during the step too, on `get_form` and `autofill_step`, so most are fixed before `go_next` instead of after a
`go_back`. Required fields still empty aren't checked: Workday reports those itself on `go_next`. Left: a live
run.

**Why.** The hand-off list in `ezapply-apply` (documents attached, every add-button section filled, files left
from a previous application removed, answers from the user or from judgment flagged) is kept by the model from
memory over many steps. Live runs missed parts of it: the cover letter twice (now caught by `notAttached`),
and sections that start empty are easy to miss. With autofill (item 1) it also lists what was filled
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

## 4. Autofill debug mode (High, L)

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

**For `autofill_step` (item 1), the plan as well.** The planner runs in the companion, so its record needs no
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

- *Adapter* (`extension/src/adapters/common/trace.ts`): a `trace` object every adapter calls at the points
  listed above. It's a no-op unless debug is on. The extension sets it with `setDebug(options)` next to
  `setTiming`, in the same `executeScript` (`extension/src/background/forms.ts`, `callAdapter`). The adapter
  returns `{ __ok, __debug }`. The companion strips `__debug` before anything reaches the agent.
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
     section. These are candidates for new hints: the roughly 37 unhinted profile fills above are what phase 3
     of item 1 works from;
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
- Without debug mode, autofill phase 1 has only the `rule` on each `form-log.jsonl` event to go on. That's
  enough to count wrong and missing rules, but not to see the page that caused them.

## 5. More application sites, and Oracle follow-ups (High, L per site)

**Greenhouse, Lever, Ashby.** Plain HTML forms, common for software jobs, same adapter API, site detection in
`protocol/src/browser.ts`; "Add a job site" in `references/development.md`. They submit from a single page,
so the submit guard matters more.

**Oracle follow-ups** (`references/components/oracle-adapter.md`): re-run a live application to confirm the
fixes from the first one and add languages and certifications; find out why the Cover Letter field was missing
live (save the page); move the posting to `filled` when an Oracle form is complete (it has no review page);
the multi-select dropdown (preferred locations) and JET comboboxes, now left to the user; button texts in other
languages.

**Challenges and open questions.**
- Each site needs a real application step saved. Debug mode (4) makes the first live run produce it.
- Greenhouse and Lever are often embedded in the employer's page in an iframe, so detection and the tenant
  come from the frame, not the tab.
- A single-page form puts Submit next to every field. The guard must block it for keyboard (Enter in a text
  field) as well as clicks.
- Which site first? Count the sites behind the user's captured postings (`meta.json` `url`) before choosing.

## 6. Show what changed in a document (Medium, M)

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

## 7. More modular adapters (Medium, L)

**Now.** `adapters/common/` has `dom.ts`, `guard.ts` and `timing.ts`. Each site's `extract.ts` and `fill.ts`
(about 500–670 lines each) carry their own widget code: dropdowns, typeaheads, dates, files, repeatable rows.

**How.**
- Pull widget drivers into `adapters/common/widgets/`: native input and select, ARIA combobox and listbox,
  typeahead, radio and checkbox groups, date, file, repeatable section, and the option matcher (exact,
  parenthetical, bare name). Each takes its selectors and timing from the site.
- A site adapter becomes page-kind detection, field discovery (mapping each field to a widget kind), its
  selectors and navigation. A plain-HTML site (5) should then be mostly configuration.

**Challenges and open questions.**
- Moving Workday's fillers is exactly the kind of change that broke autofill in e390fef. Do it after debug mode
  (4), one widget per live run, with the behavioural fixtures as the safety net.
- Workday's listbox and Oracle's JET widgets may share little. The payoff is mostly for the next sites, so
  build the common widgets with the first new site instead of refactoring the two existing adapters first.

## 8. Application tracker (Medium, S–M)

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

## 9. A skill for building adapters (Medium, M)

**What.** A skill in this repo (`.claude/skills/`, for Claude working on ezapply, not the workspace) that walks
through adding a site: saving the site's pages, writing `selectors.ts` and the extractor against the saved
markup, the behavioural fixture, fill tests, routing and permissions, a first live run with debug mode on,
reading its report, and the component page.

**How.** The steps are "Add a job site" in `references/development.md`. The skill links to that and adds the
procedure around it: what to save, in what order to build, which tests to write first, and the checklist for
the live run. It should not copy development.md's list, or the two will drift.

**Challenges and open questions.**
- The hard part is getting real markup of application steps, which needs an account and an application in
  progress. The user has to drive that; debug mode (4) makes one run enough.
- Its worth depends on how many sites get added. With one or two more, `development.md` may be enough.

## 10. Login manager (Medium, L)

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
  application after 1–4.
