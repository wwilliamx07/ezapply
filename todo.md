# ezapply: todo

Proposals, as of 2026-10-04: only work that isn't built. Whatever is built, in whole or in part, is described in
`references/` (what still needs a live run is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | Application forms on an employer's own page | Medium | M–L | a page saved from a real one |
| 2 | Autofill debug mode: the adapter trace and markup | High | M–L | — |
| 3 | Show what changed in a document | Medium | M | — |
| 4 | Application tracker | Medium | S–M | — |
| 5 | A skill for building adapters | Medium | M | 2 |
| 6 | Login manager | Medium | L | — |
| 7 | Refresh the workspace's managed files after an update | Medium | S | — |

Suggested order:
1. The live runs in `references/status.md` ("Not yet verified for real"): a Workday run that presses a row's
   Delete and binds a job-board posting's tab, the two runs comparing the browser behind and in front, a
   Greenhouse application embedded in a careers page, then an Oracle run.
2. Item 2: the adapter trace, in the engine, then markup.

Item 1 waits for a saved careers page whose application is its own form, with no frame; item 5 until a site or two
more have been built by hand from saved pages.

---

## 1. Application forms on an employer's own page (Medium, M–L)

**Why.** Some careers pages show the application straight in their own page, with no frame. Nothing finds it:
the extension tells a page's site by its body (`references/components/extension.md`, "Telling a page's site"),
and every signature is a provider's own markup.

**What such a page is.** Submitting through Greenhouse's Job Board API, Lever's postings API or Ashby's
`applicationForm.submit` takes the employer's secret API key, so a careers page can't send an application to the
provider from the browser. A frameless application is the employer's own form, posted to its own server, which
forwards it. It has none of the provider's markup, so no per-provider signature (the earlier idea: a `form`
posting to `greenhouse.io`) finds it, and the provider's definition couldn't read it anyway. What fits is one
definition for plain HTML forms, used only when asked for.

**Part 1: a `generic` definition** (`extension/src/adapters/sites/generic/`), on the engine, shared drivers only.
- **The form.** Each `<form>`, or for a page without one (a React app), the smallest element holding an email
  input and a submit control. It counts as an application when it has an email input and either a file input or
  at least four labelled fields. A form with a password input never counts (sign-in and account forms stay the
  user's). Among several, the one with the most fields. None → `pageKind: unknown`, no fields.
- **Fields**, in page order, inside the form only:
  - text, email, tel and url inputs and textareas: `textDriver`; number inputs `textDriver("number")`; date
    inputs `dateInputDriver`; native selects: `selectDriver`;
  - radios and checkboxes grouped by `name` (container: their `fieldset`, else their closest common ancestor):
    `radioDriver`, `checkboxGroupDriver`, a lone one `checkboxDriver`;
  - file inputs, visible or hidden behind a label or button: `fileDriver`, names from the input's `files`;
  - `role=combobox` with its listbox (`aria-controls`): `comboboxDriver`;
  - never hidden, password, search, submit or button inputs. A control it can't place (no prompt, a custom
    widget) is left out and counted in a message, so the agent tells the user to fill it.
- **Prompts:** `promptOf` (label `for`, wrapping label, `aria-labelledby`, `aria-label`), else the placeholder;
  a group's from its legend. **Required:** `required`, `aria-required`, or a trailing `*`. **Errors:**
  `ariaError`, else `[role=alert]` inside the form.
- **Ids:** the control's `name`, slugged (`first_name`, `urls[LinkedIn]` → `urls-linkedin`), else its `id`, else
  the prompt's slug. **Section:** the nearest heading or legend before the field within the form, else
  "Application".
- **Hints** from the HTML `autocomplete` tokens first, since they're a standard and many forms set them:
  `given-name`, `additional-name`, `family-name`, `name` (full name), `email`, `tel`/`tel-national`,
  `tel-country-code`, `address-level2` (city), `address-level1` (region), `postal-code`, `country`/`country-name`.
  Then by `name` and by prompt, as the boards do: first and last name, email, phone, LinkedIn, GitHub, website or
  portfolio. Nothing else is guessed; the planner and the agent handle the rest by prompt.
- **One page, Submit at the end**, like the boards: `singlePageKind`, `singlePageMessages`, `lastPage: true`,
  `next` refuses. **Job title** (`titledJob`): the first visible `h1`, else `document.title`.
- **Submit, broadly:** `isSubmit` is `isSubmitByText`, plus any button reading "Apply" inside the form, plus the
  form element itself, so the guard also blocks a synthetic `submit` event. A false positive only blocks a
  press; it never submits.
- **Waits:** the standard ones.

**Part 2: used only when asked, never by detection.** Almost any page has a form, so `generic` has no signature
and no URL rule. It isn't in `SITES`, and `browser.status` never lists a tab as one.
- **Protocol:** a `GENERIC: SiteInfo` beside the registry (`protocol/src/sites.ts`): tenant the page's host; job
  any registry site's `hostPageJob(url)` (a careers page with `?gh_jid=` still names its Greenhouse job).
  `adapterOf` (`background/forms.ts`) and `build.mjs` know it, so it gets its own `generic-main.js`. `SiteId` already has `generic`.
- **Extension** (`background/forms.ts`): a form call with an explicit `tabId` on a page that's no registry
  site's, where no frame is one either (a framed board always wins), injects the generic adapter instead of
  failing with "not an application page". It still fails, with today's message, when the page has no form that
  counts. Without a `tabId`, `resolveTab` still picks registry sites only.
- **Companion** (`forms/service.ts`): the agent's `tabId` already reaches the extension when the tab has no form
  site (`target()` falls back to `own`). `decide` returns early for a tab that isn't a form site, so nothing would
  be logged or credited: let it go on when the extension's answer says `adapter: "generic"`. Matching then works
  on the binding or the page's title (the URL says nothing); `posting_activate { id, tabId }` binds such a tab
  like any other.
- **Skill** (`ezapply-apply`): when the application is on the employer's own page (Apply opens no known site),
  call `get_form` with that tab's `tabId`. Say to the user that this form isn't from a known site, and check every
  field on the page after filling, since the generic reader may have missed custom widgets.

**Part 3 (only if a saved page shows it): a provider's markup served on the employer's host**, through a proxy or
a copied render. The signature finds it already, but the tenant and job are read from a URL that isn't the
provider's. `tabSite` (`forms/match.ts`) and the engine's `extract` would then fall back to the page's
`hostPageJob`, and to the board and job ids in the page where it carries them.

**Tests.**
- Generic, on synthetic forms: an application form read with its prompts, ids, groups and hints; a newsletter,
  search or sign-in form not counted; a page with two forms picks the application; a custom widget counted and
  reported; Submit blocked when pressed synthetically, including a `submit` event on the form. It also passes
  the conformance test every definition does (`sites.test.ts`), with a saved page from a real one when there is
  one.
- Extension: a page with no site and no frame, asked by `tabId`, gets the generic adapter; without `tabId`, or
  with a framed board, it doesn't.
- Companion: a generic answer is logged and credited by binding or title; nothing changes for registry
  sites.

**References when built:** `components/sites.md` (a Generic section), `components/adapters.md`,
`components/extension.md` (replace "Not covered"), `protocol.md` (`GENERIC`), `mcp-tools.md` (which tab),
`security.md` (the submit guard on arbitrary pages; password forms excluded), `status.md`.

**Challenges and open questions.**
- Custom widgets are the employer's own (a home-made dropdown, a date picker). The generic reader finds only what
  standard markup says; the rest is the user's. How much to try, beyond `role=combobox`, needs real pages.
- The forms' quality varies: unlabelled inputs, prompts in neighbouring `div`s. A prompt from the nearest
  preceding text is tempting but often wrong; start strict.
- A form that forwards to Workday or Oracle may still send the user to that site for a later step: it's then a
  registry site from that point on.

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
markup, its signature and saved pages, the conformance test, a first live run with debug mode on, reading its
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
