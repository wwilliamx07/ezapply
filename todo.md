# ezapply: todo

What's left, as of 2026-09-30. Finished work is described in `references/` (what still needs a live run is
in `references/status.md`) and in git history. Most important first within each part.

---

## Read first: changing the Workday adapter

Commit e390fef (Part 8, 2026-09-28) changed about ten things in the adapter at once, and live Workday
autofill broke: fills got several times slower, a step's `fill_fields` ran past the companion's 120 s
timeout twice, and 9 dropdowns ran past 110 s. c6aac3e reverted everything the live runs hadn't shown
working. **Which change caused it was never found.** Anything that looks like one of the reverted changes
might be it.

Reverted in c6aac3e, cause not isolated:
- adapter: dismissing a listbox left open (Escape, then a click on the page body) and pressing again to open;
  `ok: false` while a field shows an error; errors already shown ending `go_next`'s wait after 2.5 s;
  `go_back` changes (step index as well as title); `decline` resolving to the form's wording
- companion, skills: education dates with a day; answer-bank seed version 2 (six student questions);
  resume/cover letter written before the form (the review page then opened in front of the form tab; a hidden
  tab's timers run about once a second); skill guidance on year of study, options not seen, template numbers,
  `python`/`sed` and duplicate text

**b5ba545 (2026-09-29) brought some of those back, in one commit.** One live run so far (Tyrell, Workday,
2026-09-30, four steps, no slowdown: about 20 fields in 22 s, no timeout):
- `openListboxRetrying` (`extension/src/adapters/workday/fill.ts`): when a dropdown doesn't open, wait for
  quiet and open it again. Close to the reverted "press again". A dropdown that can't open now costs its
  open waits twice, which is the kind of time Part 9 measured. In the Tyrell run no dropdown failed to open;
  whether the retry ran is unknown.
- `back()` (`workday/api.ts`) sees a move by step index or title. Nearly the same code as the reverted
  `go_back` change. Not yet used live.
- New: `stepFields` after `next()`/`back()` polls `extract()` every 150 ms for up to `stepFieldsMs` (3 s)
  until the new step shows a field. Worked on both of Tyrell's `go_next`s.
- Low risk, outside the adapter: `notAttached` from `upload_file`/`go_next`/`get_form`
  (`companion/src/forms/service.ts`) and the apply skill's text about attaching the cover letter. Worked live.

**If a live run is slower** than the Oscorp and Tyrell runs, the first two are the first suspects.
`autofill-timing.yaml` can shorten a wait without a rebuild. From here on, land adapter changes one per live
run, so a slowdown points at one change. Don't bundle adapter changes again. Once debug mode (C, item 3)
exists, run these live checks with it on, so a slowdown shows which waits grew instead of only that the run
was slower.

---

## A. Live checks waiting on a run

Built and tested on 2026-09-30, not yet seen live. Check them one at a time (see "Read first").

1. **`tab.show`: the application tab brought to the front before each form call** (`references/mcp-tools.md`,
   "The tab in front"). One run with only this change, opening a review page in the middle of the
   application: the step after it should take about as long as the steps before it, and `form-log.jsonl`
   should show `tabActivated` on its first call. Also: minimize the window once and check that `tabHidden`
   reaches the user once, and that the review page isn't taken away while it waits for approval.
2. **Guidance from the 2026-09-30 sessions** (`EZAPPLY.md`, `ezapply-apply`, `ezapply-answers`; no adapter
   change). In the next session's transcript, check:
   - no `python`, `sed` or `-replace` on `.tex` files (all five sessions used `python`; four scripts missed
     their text and one turned `\textbf` into a tab);
   - `profile/answers.yaml` read before any question to the user, also when the documents come first;
   - a resolved miss (Tyrell's how-did-you-hear list) offered for saving under `byCompany` of the existing
     entry, with `sensitive: false` when the user says to save, and no second entry for the same question.

## B. Found in the 2026-09-30 runs

1. **`notAttached` on parallel uploads.** On Oracle (Umbrella, twice) the agent sent the resume and cover
   letter uploads in one turn. The tab's queue runs the resume's first, and its result listed the cover
   letter as not attached while that upload waited behind it. Leave out files whose upload is already queued
   on the tab. The hint also names Workday's Resume/CV on an Oracle form: word it per adapter.
2. **Workday "Field of Study" search.** On Tyrell's form, `search_options` on the multi-select returned only
   "Partial List (First 500 Entries)" and "All" for "Physics" and for "Comp", and "Physics"
   failed "No option matches" in the step's fill but was taken alone seconds later. An adapter change: one
   live run for it alone, ideally with debug mode (C, item 3).
3. **Clean up the user's answer bank.** `profile/answers.yaml` in the workspace has `umbrella_how_heard` beside
   `how_heard`, from before the guidance above. Run `ezapply-answers` with the user to merge them (the user's
   data, so not done from this repo).
4. **`review_open` with a bare file name.** Tyrell's agent passed `resume.pdf` and got `path_not_allowed`,
   costing a turn. Resolve a bare name against the active posting's folder, or say so in the hint.

## C. Proposals

Ranked by how much they help one person apply faster without lowering quality or honesty.

1. **Tie each application to its posting.** The tenant part is done. Left: match by requisition too (two
   postings at one company share a tenant), and stop filling on a mismatch instead of warning.
2. **More application sites: Greenhouse, Lever, Ashby.** Plain HTML forms, common for software jobs, same
   adapter API, site detection in `protocol/src/browser.ts`; "Add a job site" in `references/development.md`.
   They submit from a single page, so the submit guard matters more.
   **Oracle follow-ups** (`references/components/oracle-adapter.md`): re-run a live application to confirm the
   fixes from the first one and add languages and certifications; find out why the Cover Letter field was
   missing live (save the page); move the posting to `filled` when an Oracle form is complete (it has no
   review page); the multi-select dropdown (preferred locations) and JET comboboxes, now left to the user;
   button texts in other languages.
3. **Autofill debug mode: a config flag that makes every form call dump everything needed to debug it.**

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
   all. Part 8's slowdown was never traced, because nothing records where a fill's time goes. Every fix for
   these has been a guess, and guesses bundled together are how e390fef broke autofill (see "Read first").
   With debug mode on, one live run records what the page looked like, what the adapter did to it, what changed
   in response, and how long each wait took. Claude, working in this repo, can then read that record, find the
   cause, and turn it into a test that fails before the fix.

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

   **What gets dumped, for every form call** (`get_form`, `list_options`, `search_options`, `fill_fields`,
   `upload_file`, `remove_items`, `add_repeatable`, `remove_repeatable`, `go_next`, `go_back`, `page_action`):
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

   **Where it goes.** `debug/<date>-<postingId>/` in the workspace:
   - `index.jsonl`: one line per call (sequence number, tool, ok, duration, failed fields, slow paths taken,
     tab hidden or not). Reading starts here.
   - `NNNN-<tool>.json`: the call, the trace, page state, DOM changes, errors and requests.
   - `NNNN-before.html`, `NNNN-after.html`, `NNNN-fail-<fieldId>.html`, `NNNN-fail-<fieldId>.png`.

   **Implementation.**
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

   **It must not change what it measures.** Part 8's slowdown shows the adapter's timing is sensitive. The
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
      waits, waits that ran to their maximum, slow paths taken, and time spent with the tab hidden.
   2. For a failure, read its `NNNN-*.json` trace and the `fail-` markup to find where the adapter's picture of
      the page and the real page diverged.
   3. Export the markup, and add an extraction test in `workday-live.test.ts` / `oracle-live.test.ts`. jsdom
      doesn't run Workday's scripts, so a snapshot can't test a filler's behaviour directly: correct the
      behavioural fixture to match the real markup and events the trace shows, and write the filler test there.
   4. Fix, then re-run live with debug on and compare the two reports.

   **Tests.**
   - Adapter: with debug off, nothing is traced and no hook is installed. With debug on against the
     behavioural fixture: a filled dropdown's trace lists the open, the listbox read and the match; a failed
     one has its `fail-` markup; waits report planned and actual times.
   - Companion: `__debug` never appears in a tool result; files land under `debug/`; `index.jsonl` is written;
     `maxMB` prunes the oldest session; a timed-out call still gets a dump.
   - Export: a filled fixture exported has no values and no profile strings, and `extract()` on it gives the
     same fields and ids.

   **References**: `data-formats.md` (the flag, `debug/` layout), `components/workday-adapter.md` and
   `components/oracle-adapter.md` (the trace points), `components/extension.md`, `components/companion.md`,
   `components/cli.md` (`ezapply debug`), `components/workspace.md` (the read deny), `security.md` (what's
   dumped, where, the consent step), `development.md` (`debug:report`, "Add a job site": debug a first live
   run).
4. **Application tracker.** An `ezapply-status` skill (or `postings_list` extensions) for "what's in flight?":
   status, deadline, date submitted, postings drafted but not applied to. `meta.json` has `deadline` and
   `status`. Optional reminders through Claude Code scheduled tasks.
