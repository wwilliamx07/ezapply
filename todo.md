# ezapply: review and todo

Review of the whole repo (all packages, skills, `EZAPPLY.md`, `references/`, tests, CI) as of 2026-09-26.
Items are ordered by importance within each part: correctness first, then design and consistency, then
proposals. Each item says where the problem is, what goes wrong, and a suggested fix.

**Checked** means confirmed by reading the code path end to end or by running it. **Likely** means the
code reads that way but it hasn't been reproduced.

---

## Parts 1 and 2: done (2026-09-27)

All of Part 1 except item 13 and all of Part 2 are built, tested and described in `references/`
(`references/status.md` lists what is still unverified in a real browser or on a signed-in Workday page).

| Item | What was done |
|---|---|
| 1. Relay retried and timed out | Re-sends only on `ECONNREFUSED`; `node:http` without an agent, so no response timeout. Relay tests for a broken connection and a slow response |
| 2. Token refresh raced | Single-flight refresh that re-reads the stored token, and adopts one refreshed meanwhile. Mock GitHub with single-use refresh tokens |
| 3. `github_login` never opened the browser | `Opener.url` (loopback only, detached); `tell` depends on `openedBrowser`. Tested with a stub opener |
| 4. Reconnect alarm lost on browser restart | Created at every background start when missing. Lifecycle test with a stubbed API |
| 5. Form actions credited to the wrong posting | `FormsService`: tab chosen by the active posting's tenant; mismatch → action done, nothing logged or moved, `postingMismatch` with a hint |
| 6. Multi-file resumes | `contentFiles` (from `\input`/`\include`/`\subfile`) in `template_import`, `template_set_main` and `template.json`; skills copy them |
| 7. Carried-over rows | `remove_repeatable` (adapter `removeRepeatable`, `removable` sections), logged as `remove-row` |
| 8. Postings in iframes | Capture from all readable frames and pick the posting's; an unreadable embedded board opens in its own tab |
| 9. Bundling stripped links | Pages resized in place (content and annotations transformed), not redrawn as XObjects |
| 10. Log grew forever | Rotation at 5 MB, three files, checked at start and every 10 minutes |
| 11. 40 s stall after a start | Waits only for an extension seen in the last 6 hours (`daemon-state.json`); otherwise `extensionReconnecting` |
| 12. Token on git's command line | `GIT_CONFIG_*` environment variables |
| 14. Unchecked ids and paths | Posting ids must be plain folder names; template `main` must stay in `templates/<kind>/` |
| 15. Wrong capture metadata | LinkedIn/Indeed company, myworkdaysite tenants (shared `workdayTenant`), Workday locale dropped from canonical URLs |
| 16. Windows hints everywhere | `installCommand`/`installHint` per OS, with a Ghostscript case |
| 17. Daemon undid `daemon.json` edits | `updateDaemonConfig`: only pairing fields, on the file as it is then |
| 18. TeX distro cached as unknown | Only definite answers cached |
| 19. Concurrent builds and syncs | `KeyedQueue` per `.tex` file and per repo |
| 20. Stack traces on bad input | Safe token parsing; `EzError` for a bad `--port` or damaged `daemon.json`, printed as one line |
| 21. GitHub App port | `localBaseUrl` recorded; `portMismatch` in `github_status`, `github_login` refuses with the fix |
| 22. Workday site detection too broad | Only `*.myworkdayjobs.com` and `*.myworkdaysite.com`, in detection and host permissions |
| 23. Stale claim evidence | Evidence `hash` stamped by `knowledge_mark_indexed`; `claims_check` flags changed lines |
| Part 2 | Compact results, lean `get_form` with filters, shorter descriptions; `FormsService`; `TemplateService`; shared helpers in `companion/src/util/`; Workday hooks shared through `protocol/src/workday.ts`; `doctor.ts`; tool-naming rule in `references/mcp-tools.md`; CI `tex` and `firefox` jobs; one Workday fixture driven by both test suites; `ADAPTER_VERSION` stamped from a bundle hash; references and README updated |

### Still open

**13. The Workday remove controls haven't been seen on a live page.** `DELETE_charm`, `delete-file` and now
`panel-set-delete-button` come from knowledge of Workday's markup. On the first real application,
`screenshot` plus a saved snapshot of a step with a removable pill, file and row; turn it into a live
fixture (see proposal 3).

---

## Part 4: Context and usage: done (2026-09-27)

### What the first real session cost
Measured from the first real workspace session (onboarding, then one Soylent Workday application) with
`npm run usage:report`. Every turn re-sends the whole conversation, so **cost ≈ turns × context size**.

| | |
|---|---|
| Main session | 159 model turns: **19.4M** tokens re-sent from the cache, 208k newly written, 44k output |
| Fill phase | 92 turns, **14.4M** tokens, average context **156k** per turn |
| Carried into the fill | **~115k** of onboarding was still in context at "fill in the active posting". A fresh session starts at ~45k, a subagent at ~33k |
| Wasted turns | ~18 turns at ~160k lost to the stale-dropdown bug; after the first failures the agent filled **one field per call**, about 40 calls on the Application Questions step |
| Documents mid-fill | The resume and cover letter were built at the upload step: 12 turns, 1.77M tokens |
| Repo indexing (one-off) | **10.5M** more in 9 subagents; one (canvasbuddy) reached 204k over 37 turns, 5.2M on its own |

### What was done
All built, tested and described in `references/`. What still needs a real run is in `references/status.md`.

| Item | What was done |
|---|---|
| A0. Measuring | `scripts/usage-report.mjs` (`npm run usage:report`): turns, context, per prompt, per tool, per subagent |
| A1. Stale dropdown options | `openListbox` waits for other listboxes to go and accepts only one that appeared (or changed) after the press; `closeListbox` waits until its listbox has gone. The fixture lingers a closed listbox and drops `aria-controls`; the test fails on the old logic |
| A2. Dates needing a second entry | Entered again when the field still shows an error. The cause is still unknown: needs a live snapshot |
| A3. Batching | `ezapply-apply`: one `fill_fields` per step, one retry call for all failures, no listing first unless the option wording decides the answer |
| A4. `list_options` for several fields | `fieldIds` → `{ fieldId: options | { error } }` in one call |
| A5. Lean fill results | A clean success that reads back exactly the value is `{ fieldId, ok: true }` |
| B. Clearing | `ezapply chat` (the workspace launcher `./ezapply`) runs Claude Code and restarts it with a fresh session when another posting is captured, once the session has used a tool and none is running. The relay tags MCP requests with the session id, the daemon counts its tool calls (`GET /control/chat`), `context.restartOnCapture` turns it off. No hooks, no handoff: work is on disk, and every claim is read in one Grep (`EZAPPLY.md`) |

### Later

**C1. Forked skills.** A skill with `context: fork` runs in a separate subagent that starts at ~33k,
without the conversation, and only its final report comes back. `background: false` keeps the full tool
set, `AskUserQuestion` included.
- **Candidates:** the first drafts of the resume and cover letter (1.77M tokens in the session, ~0.7M
  forked), and `ezapply-index-repo`.
- **Experiment:** `ezapply-apply`, with step questions through `AskUserQuestion`. The cost is that the
  user can't chat during the fill.
- Tweaks and the review loop stay inline.

**C2. Indexing cost.** Look at why the canvasbuddy indexing subagent grew to 204k over 37 turns (5.2M
tokens) when the others stayed under 80k: a large component read whole, or re-reads.

---

## Part 5: The daemon inside `ezapply chat` (next up)

ezapply runs only through `ezapply chat`, so a separate background daemon no longer buys anything. Run the
companion in the wrapper's own process instead: the same HTTP/MCP server and extension bridge on the same
port, with `claude` as its child. This is a cleanup, not a token saving: it removes a background process, the
on-demand start and the once-a-second polling, and lets restarts react to a capture at once.

### What changes
- **`ezapply chat` hosts the companion.** It calls `startCompanion` in-process (no idle monitor), then starts
  `claude`. It ends when Claude ends, closing the server and the extension socket as `ezapply stop` does now.
- **Restarts are driven by events, not polling.** The companion gets an `onActivePostingChanged` hook, fired
  by a capture (`PostingsService.capture`) and by `posting_activate`, and `ChatSessions` is read in-process.
  `GET /control/chat` and `fetchChatState` go. The restart rules stay as built: only after the session has
  used a tool, never during a call, not for the same posting, `context.restartOnCapture` to turn it off.
- **The relay stays but no longer starts a daemon.** Claude Code talks to MCP servers over stdio; its direct
  HTTP transport would bring its own timeouts, and some tools wait up to 15 minutes. `ensureDaemon` leaves
  `ezapply mcp`: an unreachable daemon answers every request with "ezapply isn't running: start it with
  `ezapply chat`". The session header stays, so stray MCP clients aren't counted.
- **`ezapply daemon` stays** as the foreground debug mode, with the idle monitor. `ezapply start`, `stop` and
  `restart` go, or become "run `ezapply chat`" messages. `status` and `doctor` report "not running, start
  `ezapply chat`" instead of treating a stopped daemon as normal.
- **Code that only mattered for a background daemon** becomes debug-mode only or goes: the idle timeout,
  `daemon-state.json` and the "wait for the extension only if it was seen in the last 6 hours" rule. Decide
  per piece: after `ezapply chat` starts, the extension still takes up to 30 s to reconnect and deliver a
  queued capture, so `settled()` still matters.

### What has to be handled
1. **Nothing may write to the terminal.** Claude's screen owns it. Today the logger writes to the file *and*
   stderr (`companion/src/logger.ts`), `pdfjs-dist` prints warnings with `console.log`, and jsdom forwards page
   errors to the console during extraction. In chat mode: file-only logging, pdfjs `verbosity` at errors
   only, and the wrapper's own `console.*` and `process.stderr.write` redirected to the log. (Claude writes
   to the inherited terminal, not the wrapper's streams, so it's unaffected.) Test: run a capture,
   extraction and `pdf_render` in chat mode and assert nothing reached stdout or stderr.
2. **A crash in companion code must not kill the wrapper.** Today the relay restarts a crashed daemon; in
   process, an uncaught error would end `ezapply chat` and leave Claude without tools. Add
   `uncaughtException` / `unhandledRejection` handlers that log and keep serving. If the server itself dies,
   say so in one line and keep Claude running: the user can finish or exit.
3. **One instance.** A second `ezapply chat` finds the port taken. If `/health` answers as ezapply in chat
   mode (add `mode: "chat" | "daemon"` to `/health`), refuse with "ezapply is already running in another
   terminal". If it's a debug `ezapply daemon`, ask it to shut down first, as `ensureDaemon` does now.
4. **Picking up a new build** means restarting `ezapply chat` (and so Claude). `npm run setup` should say so.
5. **Pages that need the daemon** (GitHub login, document review, pairing) work only while chat is open. That
   matches how ezapply is run; the tools already run only from inside Claude.

### References to update
`architecture.md` (processes, lifecycle, the diagram, transports), `components/cli.md` (`chat`, `mcp`,
removed commands, `doctor`), `components/companion.md` (startup options, HTTP surface without
`/control/chat`, idle shutdown in debug mode only, the capture hook), `security.md` (the daemon's port open
only while chat runs), `flows.md` (setup, capture restarting the session), `data-formats.md`
(`daemon-state.json` if it goes, `idleTimeoutMinutes`), `development.md` (tests), `status.md`, README.

### Tests
- `ezapply chat` with the stub `claude`: the companion answers MCP while Claude runs; a capture delivered
  over the bridge restarts Claude at once; the server closes when Claude exits.
- A second instance is refused.
- A thrown error in a tool handler doesn't end the wrapper.
- Chat mode writes nothing to stdout or stderr (item 1).
- The relay's "not running" answer.

---

## Part 3: Proposals (features and improvements that fit the app)

Ranked by how much they help one person apply faster without lowering quality or honesty.

1. **Tie each application to its posting.** Item 5 did the tenant part: `get_form` reports the posting a tab
   is credited to, tab choice follows the active posting, and a mismatch warns and logs nothing. Left: match
   by requisition too (two postings at one company share a tenant), and stop filling on a mismatch instead
   of warning.
2. **More application sites: Greenhouse, Lever, Ashby.**
   - Their forms are plain HTML and much simpler than Workday's, and they're very common for software
     jobs.
   - Same adapter API (`getForm`/`fill`/`upload`/`remove`/`next`), with site detection in
     `protocol/src/browser.ts`.
   - These sites submit from a single page, so the submit guard matters more there.
3. **Checking Workday behind sign-in, with consent.**
   - A `form_snapshot` tool saves the current step's structure: field kinds, automation ids, the markup
     around widgets, with values stripped.
   - After the user agrees, it goes into `test/fixtures/live/`.
   - This turns the unverified steps (fillers, removal, review detection) into regression tests.
4. **Keyword coverage check without keyword stuffing.** A `coverage_check` tool compares the posting's
   key terms (from `notes.md`) with `pdf_text` of the resume. It lists terms that are **backed by
   evidence but missing**, and ignores terms with no evidence. It fits "no fabrication" and makes the
   ATS check measurable.
5. **Application tracker.**
   - An `ezapply-status` skill (or `postings_list` extensions) answers "what's in flight?": status,
     deadline, date submitted, and postings drafted but not applied to.
   - `meta.json` already has `deadline` and `status`.
   - Optional reminders through Claude Code scheduled tasks.
6. **Start from the closest earlier resume.** When a new posting resembles an earlier one (same role
   family), offer to start from that tailored `resume.tex` instead of the template. This reuses reviewed
   wording and saves a loop.
7. **Learn the answer bank from `form-log.jsonl`.** At hand-off, propose new `variants` and answers from
   questions answered in chat during this application, in one batch the user confirms. The skill already
   says "offer to save"; making it systematic gets the bank full sooner.
8. **Duplicate-application warning at capture.** When a capture's company matches earlier postings,
   `posting_active` says so ("applied to Acme on 2026-08-02 for Backend Engineer"). That helps with
   "Have you applied here before?" and avoids duplicates.
9. **Capture from PDFs.** (Iframes were item 8.) A posting that is a PDF (`tab.url` ends in `.pdf`)
   gets captured through `pdf_text` on the fetched bytes, or by asking the user to save it into
   `library/`.
10. **Workspace history.** Offer `git init` in the workspace (with `repo-cache/` ignored), so profile,
    answers and templates have undo beyond `.history/` snapshots. A later `ezapply backup` could zip the
    user's data.
11. **Page size per posting.** `resume.pageSize` is global. Postings outside North America usually expect
    A4: detect it from the posting's location and ask once.
12. **Decision provider (deferred, per `status.md`).** Only after about 150 real screening questions are
    in `form-log.jsonl`, as planned.
