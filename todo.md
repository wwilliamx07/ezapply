# ezapply: review and todo

Review of the whole repo (all packages, skills, `EZAPPLY.md`, `references/`, tests, CI) as of 2026-09-26.
Items are ordered by importance within each part: correctness first, then design and consistency, then
proposals. Each item says where the problem is, what goes wrong, and a suggested fix.

**Checked** means confirmed by reading the code path end to end or by running it. **Likely** means the
code reads that way but it hasn't been reproduced.

---

## Part 1: Correctness

### High

**1. The MCP relay can run a tool twice, and it cuts off requests after 5 minutes.** *Checked (code).*
`packages/cli/src/mcp-relay.ts:50-56`
- **Retries everything.** Any `fetch` error leads to `ensureDaemon()` and a second POST of the same
  message. That includes a connection reset *after* the daemon received the request, for example when the
  daemon stops for idleness or crashes mid-call. So `upload_file`, `fill_fields`, `remove_items` or
  `add_repeatable` can run twice: a second attachment, a second work-history row, a doubled log entry.
- **Cuts off long requests.** Node's `fetch` gives up waiting for response headers after 300 s by default
  (undici). Some tools legitimately take longer: `extension_pair_wait` and `github_login_wait` accept
  timeouts up to 900 s (`github_login_wait` defaults to exactly 300 s), and `repo_sync` allows git
  10 minutes. Such a call fails with "fetch failed", and then the retry above repeats it.
- **Fix:**
  - Retry only when the connection was refused (`ECONNREFUSED` in `err.cause.code`), never after the
    request was sent.
  - Use an undici `Agent` with `headersTimeout: 0` and `bodyTimeout: 0` (or above the longest tool
    timeout).
  - Add relay tests for both cases.

**2. Refreshing the GitHub token races, and a race logs the user out.** *Checked (code).*
`packages/companion/src/github/service.ts:162-176` (`token()`)
- GitHub App refresh tokens are single-use. The onboard skill runs `ezapply-index-repo` in parallel
  subagents, which call `repo_sync` at the same time.
- Once the access token is within 5 minutes of expiring, both calls refresh with the same refresh token.
  The second gets `bad_refresh_token`, and the user has to run `github_login` again in the middle of
  onboarding.
- **Fix:** single-flight the refresh (one shared promise while a refresh runs). Also re-read the stored
  blob before refreshing, in case another call just refreshed it.

**3. `github_login` never opens the browser, then tells Claude it did.** *Checked (code).*
`packages/companion/src/mcp/tools/github.ts:31`, `packages/companion/src/documents/pdf/toolkit.ts`
(`openInDefaultApp`)
- `openInDefaultApp(url)` calls `stat()` on its argument first. A URL is not a file, so this always
  throws, and `openedBrowser` is always `false`.
- The result still says "A GitHub authorize page opened", so Claude tells the user a page opened when
  none did. This step is part of onboarding.
- **Fix:**
  - Add `openUrl()` that skips the file check and only accepts `http://127.0.0.1:<port>/…`.
  - Make `tell` depend on `openedBrowser`: when nothing opened, give the URL to click.
  - Test it with a stubbed opener.

**4. The extension stops reconnecting after a browser restart.** *Checked (code); the browser behaviour
is documented, not tested here.*
`packages/extension/src/background/index.ts:93-101`
- The 30-second reconnect alarm is only created in `onInstalled`.
  - Firefox does not keep alarms across browser sessions.
  - Chrome may clear them on restart.
- After a browser restart, `onStartup` tries to connect once. The daemon usually isn't running then,
  because Claude Code starts it, so the extension stays disconnected until the user clicks Set posting.
- This defeats the reconnect and queued-capture design that idle shutdown relies on:
  - `posting_active` waits 40 s for an extension that never comes back.
  - A capture queued in the extension stays unsent.
- **Fix:** create the alarm on every background start: at the top level, or in `onStartup` plus a
  top-level `alarms.get` check (`create` with the same name just replaces it). Add a check in the
  manifest or lifecycle test.

**5. Form actions are credited to the active posting, not to the posting the application tab belongs
to.** *Checked (code).*
`packages/companion/src/mcp/tools/forms.ts:31-43` (`logEvent`, `setStatus`),
`packages/extension/src/background/forms.ts:9` (`resolveTab`)
- `resolveTab` picks the focused Workday tab, else the most recently used one.
- `form-log.jsonl` entries, `attached`/`filled` and above all `submitted` all go to whatever posting is
  active. Two ways this goes wrong:
  - Capture a new posting mid-application, or have two Workday tabs open, and fills get logged to the
    wrong posting.
  - Look at an old confirmation page, and the wrong posting is marked `submitted`.
- **Fix:**
  - Compare the form's tenant (from `get_form.url`) with the active posting's `tenant`.
  - On a mismatch, don't change status or write the log. Return a `postingMismatch` warning with the
    hint "activate the matching posting (postings_list company filter)".
  - Default the tab to one on the active posting's tenant.

### Medium

**6. Resumes split across several `.tex` files can't be tailored without editing the template.**
*Checked (skills + code).*
`packages/cli/templates/skills/ezapply-resume/SKILL.md` (Setup 3), `EZAPPLY.md` (Documents)
- The skills copy only the main file into the posting folder. Many resume templates `\input` their
  content (`sections/experience.tex`).
- Those files resolve from `templates/resume/` on `TEXINPUTS`. So Claude either edits the template
  (forbidden) or can't change the bullets.
- **Fix:**
  - When the main file inputs content files, copy them into the posting folder too. The posting folder
    comes first on the search path.
  - Alternatively, flatten the file (`latexpand`, or a small `\input` inliner in the companion).
  - Say so in the skill and in `template_import`'s result (`contentFiles: [...]`).

**7. Work-history rows carried over from a previous application can't be removed.** *Checked (code).*
`packages/cli/templates/skills/ezapply-apply/SKILL.md` ("add_repeatable until the row counts match")
- "Use My Last Application" pre-fills work experience, education and websites rows. When Workday holds
  more rows than the profile, Claude can only add, so stale rows go into the application.
- **Fix:** `remove_repeatable` (in the plan, never built). Same pattern as `remove_items`: find the row's
  Delete button inside its group, confirm, check that the row count dropped, then re-read the field ids.

**8. Postings embedded in an iframe come back nearly empty.** *Likely.*
`packages/extension/src/capture/capture.ts`, `packages/extension/src/background/index.ts` (`setPosting`)
- `executeScript` runs only in the top frame. Company career pages often embed Greenhouse, Lever or iCIMS
  boards in an iframe.
- The capture then holds the company's page chrome, and `posting.md` has no job description.
- **Fix:**
  - Capture with `allFrames: true` and pick the frame with the most visible text or a `JobPosting`
    JSON-LD block.
  - Failing that, detect an ATS iframe and flash "open the job in its own tab" with the iframe URL.

**9. Bundling can strip the links from the resume.** *Checked (code).*
`packages/companion/src/documents/pdf/toolkit.ts:203` (`drawScaled` via `embedPage`)
- When page sizes differ (an A4 transcript, a Letter resume), normalized pages are redrawn as form
  XObjects, and link annotations are dropped.
- If the first input's size differs from the resume's, the resume loses its clickable LinkedIn and GitHub
  links.
- **Fix:**
  - Copy the pages instead and scale with `/UserUnit` or `setMediaBox` plus a content transform. That
    keeps annotations, with their rectangles transformed.
  - Or never normalize the documents ezapply generated itself; only normalize library scans.

**10. The daemon log grows forever.** *Checked (code).*
`packages/companion/src/logger.ts:33`
- `companion.log` is appended to with no rotation. Since idle shutdown, every restart adds to it.
- **Fix:** rotate by size (keep, say, three files of 5 MB), or truncate on start when it's over a limit.

**11. `posting_active` can stall for 40 seconds after a start.** *Checked (design; this came from my own
idle-shutdown change).*
`packages/companion/src/bridge/server.ts:29` (`RECONNECT_GRACE_MS`)
- After an on-demand start with the browser closed, the first `posting_active` or `postings_list` waits
  the full 40 s for an extension that isn't coming.
- **Fix:**
  - Track the extension's last-seen time in `daemon.json` or `state.json`. Only wait when it was connected
    in the last few hours.
  - Or return right away with `extensionReconnecting: true`, so Claude can say it's waiting.

**12. The GitHub token is visible in git's command line.** *Checked (code).*
`packages/companion/src/repos/service.ts:100`
- `-c http.extraHeader=Authorization: Basic …` puts the token in the git process's arguments. On Linux,
  `/proc/<pid>/cmdline` can be read by other local users.
- **Fix:** pass it through the environment (`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.extraHeader`,
  `GIT_CONFIG_VALUE_0=…`), which isn't in the arguments.

**13. The Workday remove controls haven't been seen on a live page.** *Known; recorded in
`references/status.md`.*
- `DELETE_charm` and `delete-file` come from knowledge of Workday's markup.
- **Fix:** on the first real application, `screenshot` plus a saved snapshot of a field that has a
  removable pill or file. Turn that into a live fixture (see proposal 3).

### Low

**14. Ids and paths passed by Claude aren't checked.** *Checked (code).*
`packages/companion/src/postings/service.ts:129` (`folder(id)`),
`packages/companion/src/profile/service.ts:256` (`setTemplateMain`)
- A `posting_activate` or `posting_update_meta` id like `../x` resolves outside `postings/`, and so does
  a `template_set_main` main like `../../x.tex`. The damage is limited because the file must already
  parse as posting metadata, but these are the only paths that skip `resolveAllowed`.
- **Fix:** accept only `^[\w.-]+$` ids, and resolve `main` with `resolveAllowed(["templates"])`.

**15. Some capture metadata guesses are wrong.** *Checked (code).*
- `companyFromUrl` returns `jobs` for `linkedin.com/jobs/view/…` and `viewjob` for Indeed
  (`packages/companion/src/postings/extract.ts:210-215`).
- On `wd5.myworkdaysite.com/recruiting/<tenant>/…` both the companion and the adapter's `tenantOf` give
  the tenant as `wd5` (`packages/extension/src/adapters/workday/extract.ts:197`). That also defeats the
  tenant check proposed in item 5.
- `canonicalizeUrl` keeps Workday's locale segment (`/en-US/`), so the same job captured with and without
  it becomes two postings.
- **Fix:**
  - Handle LinkedIn and Indeed in `companyFromUrl`.
  - Take the tenant from the path on `myworkdaysite`.
  - Drop `/[a-z]{2}-[A-Z]{2}/` from Workday paths.

**16. Some hints give Windows commands on every OS.** *Checked (code).*
`packages/cli/src/main.ts:312` (doctor), `packages/companion/src/documents/pdf/toolkit.ts:385`
(Ghostscript).
- **Fix:** use `installHint("tex")`, and add a `"ghostscript"` case to `installHint`.

**17. A running daemon can undo edits made to `daemon.json`.** *Checked (code).*
`packages/companion/src/main.ts:92,97`
- `onPaired` and `onForgotten` save the daemon's in-memory copy of the config. They overwrite anything
  `ezapply init` changed while the daemon ran, such as the port or `idleTimeoutMinutes`.
- **Fix:** re-read the file and change only the pairing fields.

**18. The TeX distribution check is cached even when it found nothing.** *Checked; cosmetic only.*
`packages/companion/src/documents/tex/engines.ts:94`
- If the daemon started before MiKTeX was installed, `distro()` stays `"unknown"`, and MiKTeX gets the TeX
  Live flag `-no-shell-escape`.
- I ran it: MiKTeX accepts that flag, and `\write18` stays disabled. So this only loses
  `--max-print-line`.
- **Fix:** don't cache `"unknown"`.

**19. Two operations on the same file or repo can run at once.** *Likely.*
- Two `tex_compile` calls on the same file share `.build/<name>/`.
- Two `repo_sync` calls on the same repo collide on git's `index.lock`.
- **Fix:** a per-key promise queue, as `PostingsService.serialize` already does.

**20. Some bad input ends in a raw stack trace.** *Checked (code).*
- A corrupt keychain token blob: `JSON.parse` in `tokenBlob()` and in doctor.
- `ezapply init --port abc`: a zod stack trace.
- **Fix:** parse safely, and give a one-line error that says what to do.

**21. The GitHub App remembers the port it was created on.** *Likely.*
- The callback and setup URLs include the port at creation time. After `ezapply init --port N`, login
  redirects to the old port.
- **Fix:** notice the mismatch in `github_status`, with the hint to update the app's callback URL, or
  re-register it.

**22. Site detection treats non-application Workday sites as Workday.** *Checked (code).*
`packages/protocol/src/browser.ts:20`
- `workday.com` also matches `www.workday.com` (marketing) and `*.myworkday.com` (employee tenants).
- **Fix:** list the application hosts explicitly (`*.myworkdayjobs.com`, `*.myworkdaysite.com`,
  `wd*.myworkday.com/<tenant>/d/…` if needed).

**23. Claim evidence can quietly go out of date.** *Checked (code).*
- `claims_check` only checks that line ranges are in bounds. After the code changes, a claim can point at
  unrelated lines and still pass.
- **Fix:** store a short hash of the cited lines in `evidence`. `claims_check` then flags claims whose
  lines changed, and re-indexing re-verifies them.

---

## Part 2: Design, consistency, aesthetics

1. **Leaner tool output (context cost).**
   - `mcp/result.ts:6` pretty-prints every tool result (`JSON.stringify(…, null, 2)`). Compact JSON saves
     about 20–30% of the tokens on large results.
   - `get_form` is the biggest result and is called every step. Add `onlyEmpty` / `section` filters, and
     leave out defaults (`required: false`, empty `options`).
   - Trim the longest tool descriptions (`fill_fields`, `remove_items`, `tex_compile`). All 43 tool
     descriptions sit in context all the time.
2. **The form tools break "thin tools, fat services".**
   - `mcp/tools/forms.ts` (317 lines) holds the logging, status changes, the MIME map, reading the file
     for upload, and the error translation for older extensions.
   - Move these into a `FormsService`. Item 5's tenant check belongs there too.
3. **Split `ProfileService`.** Template import, examples and TeX-engine detection are a `TemplateService`
   concern. Profile, answers and repos stay where they are.
4. **Repeated helpers.**
   - `exists()` is defined in 4 files.
   - `waitFor` appears twice (`cli/daemonctl.ts`, `extension/dom.ts`).
   - `writeAtomic` in `pdf/toolkit.ts` duplicates `writeFileAtomic` in `workspace.ts`.
   - Put them in `companion/src/util/fs.ts`.
5. **Workday strings outside `selectors.ts`.** `companion/src/postings/extract.ts:121-130` repeats
   `jobPostingDescription`, `jobPostingHeader`, `locations` and `requisitionId`. Move them into the
   protocol package (shared with the adapter), or relax the convention in `development.md` so it covers
   only the extension.
6. **CLI layout.** `cli/src/main.ts` (343 lines) mixes command parsing with `doctor`. Move `doctor` into
   `doctor.ts` and share checks with `workspace_check` (`agentFileStatus` already does).
7. **Inconsistent tool names.**
   - `posting_active` vs `postings_list` vs `posting_activate`.
   - `repos_selection_get` vs `github_list_repos`.
   - `claims_check` vs `knowledge_mark_indexed`.
   - Not worth breaking now. Pick a noun-verb scheme for new tools, and rename with aliases if a major
     version ever happens.
8. **CI doesn't cover the risky parts.**
   - No TeX engine, so every compile test is skipped.
   - No `web-ext lint`, no Firefox.
   - Add an Ubuntu job with `texlive-xetex latexmk` (or Tectonic) and `web-ext lint dist-firefox`.
9. **Test fixtures drift apart.** The e2e `fakeForm()` and the jsdom fixture model the same Workday step
   separately, so each new method needs two fakes. Generate the e2e fake from the adapter plus the jsdom
   fixture, or share one scripted model.
10. **`ADAPTER_VERSION` is bumped by hand** (`adapters/workday/api.ts`). Forgetting leaves stale adapters
    in open tabs. Stamp it with a hash of the bundle in `build.mjs`.
11. **One reference line is wrong until item 4 is fixed.** `references/architecture.md` ("a 30 s alarm
    reconnects it whenever it's down") and `components/extension.md` (wake-ups) describe an alarm that
    doesn't survive a browser restart.
12. **README.** It says nothing about idle shutdown (the daemon stops after 15 idle minutes, and the badge
    shows "idle"), or that the extension needs a reload after most updates.

---

## Part 3: Proposals (features and improvements that fit the app)

Ranked by how much they help one person apply faster without lowering quality or honesty.

1. **Tie each application to its posting.** Builds on item 5. `get_form` reports which posting the tab
   belongs to (by tenant and requisition). A mismatch stops filling with a clear hint. Tab choice follows
   the active posting. This removes a whole class of wrong-application mistakes.
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
9. **Capture from PDFs and iframes.** Item 8 plus: a posting that is a PDF (`tab.url` ends in `.pdf`)
   gets captured through `pdf_text` on the fetched bytes, or by asking the user to save it into
   `library/`.
10. **Workspace history.** Offer `git init` in the workspace (with `repo-cache/` ignored), so profile,
    answers and templates have undo beyond `.history/` snapshots. A later `ezapply backup` could zip the
    user's data.
11. **Page size per posting.** `resume.pageSize` is global. Postings outside North America usually expect
    A4: detect it from the posting's location and ask once.
12. **Decision provider (deferred, per `status.md`).** Only after about 150 real screening questions are
    in `form-log.jsonl`, as planned.
