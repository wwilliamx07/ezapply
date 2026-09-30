# ezapply: todo

What's left, as of 2026-09-29. Finished work is described in `references/` (what still needs a live run is
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

**The working tree (uncommitted, 2026-09-29) brings some of those back.** Tests, typecheck and lint pass,
but nothing has run on a live page:
- `openListboxRetrying` (`extension/src/adapters/workday/fill.ts`): when a dropdown doesn't open, wait for
  quiet and open it again. Close to the reverted "press again". A dropdown that can't open now costs its
  open waits twice, which is the kind of time Part 9 measured.
- `back()` (`workday/api.ts`) sees a move by step index or title. Nearly the same code as the reverted
  `go_back` change.
- New: `stepFields` after `next()`/`back()` polls `extract()` every 150 ms for up to `stepFieldsMs` (3 s)
  until the new step shows a field.
- Low risk, outside the adapter: `notAttached` from `upload_file`/`go_next`/`get_form`
  (`companion/src/forms/service.ts`) and the apply skill's text about attaching the cover letter.

Also in `git stash` ("tab.show: bring the application tab to the front"): built and tested, never run live.

**How to land these.** Commit the low-risk part on its own. Then add the adapter changes one per live run,
each run with per-field timings (Part A, item 1), so a slowdown points at one change. If a run is slower,
`autofill-timing.yaml` can shorten a wait without a rebuild. Don't bundle adapter changes again.

---

## A. Workday: speed and reliability (live runs needed)

1. **Per-field timings in fill results**, with the slow paths taken (dropdown re-open, `onClick` fallback,
   date re-entry), logged by the companion to `form-log.jsonl`. Nothing measures this now, which is why Part 8's
   slowdown couldn't be traced. Build it before any other adapter change.
2. **Land the uncommitted adapter changes and the `tab.show` stash**, one at a time (see above).
3. **"Could not open the dropdown".** The Oscorp runs (with the committed close-by-own-button fix, 42d9eb4)
   still failed 12 dropdowns, each one whose list had been read without a choice (`list_options` or a miss);
   the agent's next call filled every one. The uncommitted retry targets this. Why the first open fails is
   unknown: a live snapshot would say.
4. **A time budget per fill, and a way to stop one in the page** (on cancel or timeout), with partial results
   logged. A timed-out fill keeps running in the page now, isn't logged, and the tab's queue lets the next call
   in.
5. **Wait for a dropdown's options to stop changing** before reading them. "How did you hear" returned only
   "Select One" once (options loading late).
6. **`screenshot` permission.** Failed with "Either the '<all_urls>' or 'activeTab' permission is required" in
   Chrome (Monarch, and Oscorp run 1); worked in Oscorp run 2.
7. **Unexplained, from the Oscorp runs** (each needs a snapshot of the step):
   - Language rows filled `ok: true`, still filled before Save and Continue, empty when the agent came back.
   - Back from the review page went to step 1 once and to step 5 the other time.
   - `upload_file` said "Unknown field" right after the review page had been open; the same id worked after a
     `get_form`.
   - Dates: the adapter enters a date again when the field still shows an error (`fill.ts`, "second entry").
     Why the first entry isn't taken is unknown.
8. **Remove controls never seen live.** `DELETE_charm` (skill pills), `delete-file` (attached files) and
   `panel-set-delete-button` (rows) come from knowledge of Workday's markup. Oscorp: `remove_repeatable
   languages-3` said "No removable row". Save a live step with a removable pill, file and row and turn it into a
   fixture (C, item 3 builds the tool for that).

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
   the agent has resolved a miss. Part of C, item 7.
3. **Redo the reverted companion and skill changes** (listed above) only one at a time, if still wanted.

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
3. **`form_snapshot` tool.** Saves the current step's structure (field kinds, automation ids, the markup around
   widgets, values stripped); with the user's consent it goes into `test/fixtures/live/`. Most of A, items 3,
   7 and 8 wait on this.
4. **Keyword coverage check without stuffing.** `coverage_check` compares the posting's key terms (from
   `notes.md`) with `pdf_text` of the resume and lists terms backed by evidence but missing; terms without
   evidence are ignored.
5. **Application tracker.** An `ezapply-status` skill (or `postings_list` extensions) for "what's in flight?":
   status, deadline, date submitted, postings drafted but not applied to. `meta.json` has `deadline` and
   `status`. Optional reminders through Claude Code scheduled tasks.
6. **Start from the closest earlier resume** when a new posting resembles an earlier one (same role family).
7. **Learn the answer bank from `form-log.jsonl`.** At hand-off, propose new `variants` and answers from
   questions answered in chat, in one batch the user confirms.
8. **Duplicate-application warning at capture.** `posting_active` says "applied to Acme on 2026-08-02 for
   Backend Engineer" when the company matches earlier postings.
9. **Capture from PDFs.** A posting that is a PDF gets captured through `pdf_text`, or by asking the user to
   save it into `library/`.
10. **Workspace history.** Offer `git init` in the workspace (`repo-cache/` ignored); later an `ezapply backup`.
11. **Page size per posting.** `resume.pageSize` is global; postings outside North America usually expect A4.
    Detect from the location and ask once.
12. **Decision provider** (deferred): only after about 150 real screening questions are in `form-log.jsonl`.

## D. Context cost

The first real session (2026-09-27) re-sent 19.4M tokens over 159 turns; see `npm run usage:report`.

1. **Forked skills.** A skill with `context: fork` runs in a subagent that starts at ~33k without the
   conversation (`background: false` keeps `AskUserQuestion`). Candidates: first drafts of the resume and cover
   letter (1.77M tokens in that session, ~0.7M forked) and `ezapply-index-repo`. Experiment: `ezapply-apply`
   with step questions through `AskUserQuestion`, at the cost of the user not chatting during the fill.
2. **Indexing cost.** Find why the canvasbuddy indexing subagent grew to 204k over 37 turns (5.2M tokens)
   when the others stayed under 80k: a large component read whole, or re-reads.
