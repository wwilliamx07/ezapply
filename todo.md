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

## Part 5: No daemon: done (2026-09-28)

ezapply runs only through `ezapply chat`, so the background daemon went. The companion runs inside the
`ezapply chat` process, with `claude` as its child; there is no daemon mode at all. Built, tested and described
in `references/` (`architecture.md` has the why; `status.md` what's unverified with a real Claude Code).

```
ezapply chat   one Node process: companion (HTTP + MCP + extension bridge) on 127.0.0.1:<port>
  └─ claude    child, inherits the terminal
       └─ ezapply mcp   stdio relay Claude Code starts; forwards to the companion over HTTP
```

| Item | What was done |
|---|---|
| Hosting | `hostChat` starts the companion, then Claude; closes it when Claude exits; no Claude if the companion can't start |
| Restarts by events | `PostingsService.onActiveChange` and `ChatSessions.onCallEnd` through `ChatHost`; `/control/chat`, `fetchChatState` and the poll gone |
| Relay | Never starts anything; `NOT_RUNNING` for every request outside a chat; nothing re-sent |
| Commands | `start`, `stop`, `restart`, `daemon`, `pair` gone (pairing is `extension_pair [replace]`); `status` and `doctor` report whether a chat runs; `/control/*` and `daemonctl.ts` gone |
| Background-only code | `idle.ts`, `idleTimeoutMinutes`, `CloseCode.Idle` and the extension's idle state, `daemon-state.json` and the 6-hour rule gone; `extensionReconnecting` now means "not connected since the start" |
| Naming | `~/.ezapply/config.json` (`AppConfig`, `config/app.ts`), moved from `daemon.json` on load; "daemon" gone from messages and tool results (`portMismatch.localUrl`) |
| Terminal | Logger file-only; jsdom silent `VirtualConsole`; `quietProcess` sends `console.*` and stderr to the log |
| Crashes | `guardProcess`: uncaught exceptions and rejections logged, the chat carries on |
| One instance | `/health` `mode: "chat"`; a second chat refused; an earlier build's daemon asked to shut down; another program on the port named |
| Tests | Chat host with a stub `claude` and the real companion, second instance, legacy daemon, port squatter, quiet child process, relay `NOT_RUNNING`, config move, change events; smoke-tested with the real CLI and a stand-in `claude` |

---

## Parts 6 and 7: done (2026-09-28)

| Item | What was done |
|---|---|
| 6. Open in the user's browser | The extension reports its browser in `hello` (`detectBrowser`: `getBrowserInfo` in Firefox, `userAgentData` brands in Chromium browsers). The companion keeps it (`bridge.browser()`, in `browser_status` and `workspace_check`) and starts that browser's program itself (`findBrowser`: App Paths or install folders on Windows, `.app` bundles on macOS, PATH elsewhere) with the page, or a PDF/image as a `file://` URL. Other files, and everything when no browser is known or found, use the OS opener. Tools report `openedIn`. Not through the extension, which can't open local files without the user granting file access |
| 7. Auto memory off | `ezapply init` sets `autoMemoryEnabled: false` in the workspace's `.claude/settings.json` unless the user set it |

Still to see for real (`references/status.md`): each browser opening a new tab from its program, Opera's
Windows path, Chrome with several profiles, and the context saved without auto memory (`npm run usage:report`).

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
