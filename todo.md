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

**b5ba545 (2026-09-29) brought some of those back, in one commit.** Tests, typecheck and lint pass, but none
of it has run on a live page:
- `openListboxRetrying` (`extension/src/adapters/workday/fill.ts`): when a dropdown doesn't open, wait for
  quiet and open it again. Close to the reverted "press again". A dropdown that can't open now costs its
  open waits twice, which is the kind of time Part 9 measured.
- `back()` (`workday/api.ts`) sees a move by step index or title. Nearly the same code as the reverted
  `go_back` change.
- New: `stepFields` after `next()`/`back()` polls `extract()` every 150 ms for up to `stepFieldsMs` (3 s)
  until the new step shows a field.
- Low risk, outside the adapter: `notAttached` from `upload_file`/`go_next`/`get_form`
  (`companion/src/forms/service.ts`) and the apply skill's text about attaching the cover letter.

**If the next live run is slower** than the Oscorp runs, these are the first suspects. `autofill-timing.yaml`
can shorten a wait without a rebuild. From here on, land adapter changes one per live run, so a slowdown
points at one change. Don't bundle adapter changes again. Once debug mode (C, item 3) exists, run these live
checks with it on, so a slowdown shows which waits grew instead of only that the run was slower.

---

## A. Workday: keep the application tab in front (`tab.show`)

1. **Bring the application tab to the front before each form call, and say when it can't be.**

   **Why it matters.** Browsers slow down tabs that aren't on screen. Chrome, Edge and Firefox run a hidden
   tab's timers at most about once a second. Chrome also runs chained timers only once a minute after a tab has
   been hidden for five minutes. `requestAnimationFrame` stops entirely. Every wait in the adapter is a timer:
   `sleep` and the quiet wait in `extension/src/adapters/common/dom.ts`, and the 150 ms `stepFields` poll.
   Workday's own widgets also render on timers and animation frames. So in a hidden tab, each wait of a few
   hundred milliseconds becomes a second or more, and a step with dozens of them runs many times slower. It
   was measured once, in the Monarch run (2026-09-28): 16 fields took 6.7 s, then `review_open` opened the
   review page in front of the Workday tab and 4 dates took 28 s. That is about 0.4 s per field against 7 s.
   A slow fill doesn't just waste time. It runs past the companion's fill timeout, keeps running in the page
   unlogged, and lets the tab's queue start the next call while it's still going. From outside that looks
   like the adapter breaking, and it made Part 8's slowdown harder to trace, since a hidden tab and a bad
   change look the same. The tab gets hidden in ordinary use:
   - `review_open` opens the review page as a new tab in front of the form (`after-approval`, the default
     attach mode).
   - The user reads the posting, a PDF or anything else in another tab while Claude fills.
   - The browser window is minimized.

   `screenshot` also only works on the tab that's on screen.

   **The stash is gone.** A version was built and tested on 2026-09-28 and kept in a git stash ("tab.show:
   bring the application tab to the front"). `git stash list` is empty and no unreachable commit holds it, so
   this is a rebuild.

   **Implementation.**
   - *Protocol* (`protocol/src/forms.ts`): `"tab.show": { params: TabParam.extend({ activate: z.boolean() }),
     result: { tabId, activated, hidden } }`. `activated` means the extension switched to the tab. `hidden`
     means the page still reports `document.visibilityState === "hidden"` afterwards.
   - *Extension* (`extension/src/background/forms.ts`):
     - Resolve the tab with `resolveTab`. If `activate` is set and `!tab.active`, call
       `ext.tabs.update(tab.id, { active: true })`.
     - Read `document.visibilityState` with one `executeScript`. The isolated world is enough, and the site's
       host permission is already required.
     - Don't call `windows.update({ focused: true })`. It would pull the browser in front of the terminal the
       user is typing in and take keyboard focus on every call.
     - A minimized window stays hidden, and so does a window fully covered by others (Chrome on Windows tracks
       occlusion and marks those pages hidden). Report `hidden: true` instead of forcing it.
   - *Companion* (`companion/src/forms/service.ts`, `onTab`):
     - Call `tab.show` inside the tab's queue, right before the adapter call, so nothing can hide the tab in
       between.
     - Pass `activate: false` while `reviews.pending()` (a review page is waiting for the user). Switching
       would take the review away from them in the middle of approving. `FormsService` needs the review
       service for that.
     - When `hidden` comes back, add `tabHidden: { hint }` to the tool result. Hint: the application tab is in
       the background, where the browser slows it down; ask the user to keep it visible (window not minimized,
       review page closed or moved to another window).
     - Log `activated` and `hidden` with the call in `form-log.jsonl`, so a slow step can be matched to a
       hidden tab afterwards.
     - An extension built before `tab.show` answers "Unknown method". Treat that as a no-op, not a failed
       fill: log it once and carry on.
   - *Skill* (`ezapply-apply`): on `tabHidden`, pass the hint to the user once and keep filling.
   - *Tests*:
     - `extension/test/background.test.ts` (fake `ext.tabs`): an inactive tab is activated; an active one is
       left alone; `activate: false` doesn't switch; `windows.update` is never called.
     - `companion/test/e2e.test.ts` (fake extension): `tab.show` reaches the tab before `form.fill`; no
       activation while a review is pending; `tabHidden` shows up in the result and the log; an extension
       without `tab.show` still fills.
   - *Live check*: one run with only this change (see "Read first"), opening a review page in the middle of
     the application. The step after it should take about as long as the steps before it.
   - *References*: `components/protocol.md` (method table), `components/extension.md` (handler and why no
     window focus), `mcp-tools.md` and `components/companion.md` (`tabHidden`), `status.md`.

## B. Agent guidance (skills and `EZAPPLY.md`; no adapter change)

Guidance that changes which tools the agent calls, or how often, changes how often the adapter opens
dropdowns (Part 9 suspected `list_options` then `fill_fields` on every dropdown). Change that kind with the
same care, one live run at a time.

Done, not yet seen in a real session: the skills and `EZAPPLY.md` show each call's parameters
(`references/components/workspace.md`, "Call shapes"; 11 schema errors in the Oscorp runs). It changes no
calls, only their spelling. Check the next session's transcript for schema errors.

1. **No Python on Windows.** Three runs tried `python` for a LaTeX edit and failed. Say in `EZAPPLY.md`: no
   Python; edit `.tex` with Edit. (It was in e390fef and reverted only for being unverified.)
2. **Answer bank after a resolved miss.** `how_heard` "School job board" missed on both Oscorp runs (the form
   wanted "College/University") and nothing was saved, so it will miss again. Offer a per-company answer once
   the agent has resolved a miss.

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
     matched to a hidden tab (Part A).
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
