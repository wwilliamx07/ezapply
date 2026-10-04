# ezapply: todo

Proposals, as of 2026-10-04: only work that isn't built. Whatever is built, in whole or in part, is described in
`references/` (what still needs a live run is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | Embedded application forms | High | M | — |
| 2 | Autofill debug mode: the adapter trace and markup | High | M–L | — |
| 3 | Show what changed in a document | Medium | M | — |
| 4 | Application tracker | Medium | S–M | — |
| 5 | A skill for building adapters | Medium | M | 2 |
| 6 | Login manager | Medium | L | — |
| 7 | Refresh the workspace's managed files after an update | Medium | S | — |

Suggested order:
1. The live runs in `references/status.md` ("Not yet verified for real"): a Workday run that presses a row's
   Delete and binds a job-board posting's tab, the two runs comparing the browser behind and in front, then an
   Oracle run.
2. Item 1, so Greenhouse and the other boards work inside employers' career pages.
3. Item 2: the adapter trace, in the engine, then markup.

Item 5 waits until a site or two more have been built by hand from saved pages.

---

## 1. Embedded application forms (High, M)

**Why.** Company career pages often embed their ATS: an iCIMS application inside
`careers.example.com/…?icims=1`, Greenhouse's inside `careers.example.org/…?gh_jid=…`. The form tools act on a
whole tab, chosen by the tab's URL (`resolveTab` in `background/forms.ts`), so a form inside a frame is never
found. Capture already handles this for postings: `capture/frames.ts` picks the frame that holds the posting,
and `meta.json` keeps its `frameUrl`.

**How.**
- **Find form frames.** The background asks each frame of the tab for its URL (`scripting.executeScript` with
  `allFrames`; only frames on hosts the extension may access answer) and runs the registry's `isUrl` on each.
  `browser.status` lists, per tab, `frames: [{ frameId, url, site }]` for the frames on a form site.
- **Target a frame.** Form methods take a `frameId` next to the `tabId`, and `callAdapter` injects into
  `{ tabId, frameIds: [frameId] }`. `FormSchema` gains `frameId`. Each frame gets its own adapter instance and
  submit guard.
- **Choose the frame.** `FormsService.target` picks the tab, then the frame on the posting's tenant (by the
  frame's URL), then any form frame. When the top frame is the form itself, nothing changes. For a posting
  captured from an embedded board, its tenant and job come from `frameUrl`.
- **Which posting a frame's form belongs to:** the matching in `forms/match.ts`, given the frame's URL instead
  of the tab's.
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
- Greenhouse, the most common embedded board, is built; iCIMS isn't (`references/components/sites.md`).

## 2. Autofill debug mode: the adapter trace and markup (High, M–L)

Debug mode's companion part is built (`references/data-formats.md`, `debug/`; `references/development.md`,
"Debugging a live run"): every form call's parameters, the adapter's full answer, the tab's state, timings and
autofill's plan. What's left is what happens inside the page, which today shows only as a filler's one-line
result.

**Why.** A live run's failures are still guesses: dropdowns that didn't open on the first try, rows that
filled `ok: true` and were empty after Save and Continue, Back landing on different steps, dates needing a
second entry, a slowdown whose waits the records ruled out but couldn't locate (`references/status.md`).
Guesses bundled together are how fdd1d59 broke autofill ("One adapter change per live run" in
`references/development.md`). Few of the adapters' markup facts come from a real application step, and the
behavioural fixtures are built from what the adapter expects, so a test passing against them shows the adapter
agrees with itself, not with the site. `screenshot` is no substitute: it shows what the user sees, not the
automation ids, roles, `aria-*` attributes and nesting the selectors depend on, and it can't be replayed in a
test.

**Part 2 (M): the adapter trace and page hooks.** An adapter change, with its own live run.
- **The trace** (`extension/src/adapters/engine/trace.ts`): an ordered event list the engine records at one
  place, since every driver call and every wait goes through it:
  - every selector query and how many elements matched;
  - every click, key and input event dispatched, and on which element (automation id, role, label);
  - every wait: its kind, the planned and actual time, and whether it ended by the condition, by quiet or by
    timeout;
  - every branch taken: the dropdown re-open, the `onClick` fallback, the date's second entry, a typeahead's
    search attempts;
  - for dropdowns: the listboxes found, which one was read, the options seen, and how the value matched;
  - per field: start, end, `ok`.
- **Page state around the call:** URL, step title and index, `document.visibilityState`,
  `document.hasFocus()`.
- **DOM changes during the call:** a `MutationObserver` on the form, summarised: nodes added and removed (tag,
  automation id, role), and changes to `aria-expanded`, `aria-selected`, `aria-invalid`, `value`, `disabled`
  and `hidden`. This shows a listbox opening and closing, or a section re-rendered and its filled rows dropped.
- **Page errors and requests**, in the page's MAIN world while the call runs: `window.onerror`, unhandled
  rejections, `console.error`, and `fetch` and XHR calls (method, path, status and duration, never bodies). A
  step whose save request failed, or a widget throwing, shows up here and nowhere else.
- **Plumbing:** a no-op unless debug is on. The extension sets it with `setDebug(options)` next to
  `setTiming`, in the same `executeScript` (`background/forms.ts`, `callAdapter`). The adapter returns
  `{ __ok, __debug }`, and the companion strips `__debug` before anything reaches the agent and writes it into
  the call's record. The hooks install at the start of a debugged call and come off at its end, so a call
  without debug runs exactly as today. An extension without `setDebug` still fills; the record notes once
  that no trace came back.
- **The report** gains what the trace makes possible: the slowest fields and waits, waits that ran to their
  maximum, and slow paths taken.

**Part 3 (M): markup, screenshots and `ezapply debug export`.**
- **The setting:** `debug.markup`, set to `"failures"` (the default: before each call, and at every failed
  field), `"always"` (also after every call) or `"none"`.
- **Markup:** the body with scripts, styles, SVG contents and inline handlers removed. It's saved before the
  call, and at the moment a field fails: that field's section plus any open popup or listbox, while they're
  still on screen. Values are kept, because debugging needs them. Files: `NNNN-before.html`,
  `NNNN-after.html`, `NNNN-fail-<fieldId>.html`.
- **A screenshot at each failure**, when the tab is on screen (`NNNN-fail-<fieldId>.png`), taken in the
  background script. It goes to disk, never into the conversation.
- **`ezapply debug export <session> <NNNN>`** writes a fixture candidate from a saved markup file:
  - values blanked (inputs, the option shown on a dropdown button, pill labels, file names);
  - a second pass replacing every string from `profile/profile.yaml`, with the count replaced;
  - a header comment in the existing style (site, page kind, step, what was removed).

  It goes into `extension/test/fixtures/live/` only after the user has looked at it and agreed: it's
  third-party markup and could still hold something the scrub missed.
- **Size:** markup and traces travel back through the bridge (64 MB `maxPayload`), well above a cleaned step.

**It must not change what it measures.** The adapter's timing is sensitive. Keep the observer's records small,
serialise markup only at the points above, and compare a debugged run's timings with other debugged runs only.
Before landing, compare one step's timings with debug on and off on the behavioural fixture. The first live run
with debug off must match the earlier runs' timings before the trace is trusted.

**The loop it enables** (Claude in this repo, after a live run with debug on): read the report; for a failure,
read its trace and `fail-` markup to find where the adapter's picture of the page and the real page diverged;
export the markup and add an extraction test (`workday-live.test.ts`, `oracle-live.test.ts`); correct the
behavioural fixture to the real markup and events the trace shows, and write the filler test there (jsdom
doesn't run the site's scripts); for autofill, run `extract()` on the exported step and test the planner's output
on it; fix, re-run live, compare the reports.

**Tests.**
- Adapter: with debug off, nothing is traced and no hook is installed. With debug on, against the behavioural
  fixture: a filled dropdown's trace lists the open, the listbox read and the match; a failed one has its
  `fail-` markup; waits report planned and actual times.
- Companion: `__debug` never appears in a tool result and lands in the record.
- Export: a filled fixture exported has no values and no profile strings, and `extract()` on it gives the same
  fields and ids.

**References when built:** `data-formats.md`, `components/adapters.md` (the trace points),
`components/extension.md`, `components/companion.md`, `components/cli.md` (`ezapply debug export`),
`security.md` (markup and screenshots), `development.md` ("Debugging a live run", "Add a job site").

**Challenges.** Screenshots need the tab on screen, so a failure on a hidden tab gets markup only. The trace
calls touch every filler, which makes landing them an adapter change of its own.

## 3. Show what changed in a document (Medium, M)

**Why.** After a revision, finding what changed means re-reading the whole document, and the agent reads the
PDF's text back to show it. Each review round is a full re-read for the user. `tex_diff` exists, but compares
the template with the tailored file, needs latexdiff, and isn't on the review page.

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

## 4. Application tracker (Medium, S–M)

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

## 5. A skill for building adapters (Medium, M)

**What.** A skill in this repo (`.claude/skills/`, for Claude working on ezapply, not the workspace) that walks
through adding a site: saving the site's pages, writing its registry entry and definition against the saved
markup, the fixture, the conformance test, permissions, a first live run with debug mode on, reading its
report, and the site's reference page.

**How.** The steps are "Add a job site" in `references/development.md`. The skill links to that and adds the
procedure around it: what to save, in what order to build, which tests to write first, and the checklist for
the live run. It should not copy development.md's list, or the two will drift.
- It brings the live-check script used for Greenhouse, Lever and Ashby
  (`references/components/adapters.md#checking-a-site-live`) into the repo, with this machine's paths made
  options: headless Chrome or Edge over the DevTools protocol, the site's built bundle injected into the page's
  main world, the adapter's methods called with fake values, never Submit, no uploads to a third party.

**Challenges and open questions.**
- The hard part is getting real markup of application steps, which needs an account and an application in
  progress. The user has to drive that; debug mode's markup export ("Autofill debug mode") makes one run enough.
- Its worth depends on how many sites get added. With one or two more, `development.md` may be enough.

## 6. Login manager (Medium, L)

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
  application once autofill and debug mode are done.

## 7. Refresh the workspace's managed files after an update (Medium, S)

**Why.** After ezapply is updated, the workspace's `EZAPPLY.md`, skills and settings stay as the older build wrote
them until the user runs `ezapply init`, so the agent follows old guidance (and may call tools by old shapes).
Nothing tells the user.

**How.** `init` stamps the build's version into `EZAPPLY.md` (a comment). `ezapply chat` compares the stamp with
its own version before starting Claude and, when they differ, rewrites only the managed files (the part of
`init` that refreshes `EZAPPLY.md`, the skills, the launcher and ezapply's entries in `.mcp.json` and
`.claude/settings.json`), printing one line. They're ezapply's and rewritten by `init` anyway, so no agent is
needed. Tests: an old stamp refreshed, the user's `CLAUDE.md` and settings kept, a current stamp left alone.

**Open question.** Whether `chat` should also run the rest of `init` (config migration, new folders), or only
print "run `ezapply init`" for those.
