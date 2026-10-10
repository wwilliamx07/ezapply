# ezapply: todo

Proposals, as of 2026-10-10: only work that isn't built. Whatever is built, in whole or in part, is described in
`references/` (what still needs a live run is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | Application forms on an employer's own page | Medium | M–L | a page saved from a real one |
| 2 | Put off re-indexing a repo for a set time | Low | S | — |
| 3 | Application tracker: progress and outcomes (application manager) | Medium | M | — |
| 4 | Job search across the boards ezapply knows (application manager) | Medium | L | — |
| 5 | Job alerts (application manager) | Medium | M | Job search |
| 6 | Auto mode (application manager) | High if trusted, else Low | XL | Tracker, job search, alerts; a change to `philosophy.md` |
| 7 | Agents that try to break a new adapter (adapter building) | Medium | M–L | — |
| 8 | One directory per adapter (adapter building) | Medium | M–L | — |
| 9 | Everything in the browser | High | L–XL | a change to `philosophy.md` |

Suggested order: the live runs in `references/status.md` ("Not yet verified for real"): a Workday run with debug
mode off whose timings match the earlier runs' (the adapter trace's no-op path), which also presses a row's Delete
and binds a job-board posting's tab; then runs with debug on, the two comparing the browser behind and in front
among them; a Greenhouse application embedded in a careers page; then an Oracle run.

Everything in the browser (item 9) before the application manager: the tracker's page and auto mode's runner are
built on it. Item 8 before the next new site, and before item 1, so neither is built in the old layout and then moved. Item 1
waits for a saved careers page whose application is its own form, with no frame. The application manager (items 3
to 6) is built in that order, each on the one before; auto mode last, and only once the rest has shown the quality
holds without the user watching.

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
definition for plain HTML forms, used only when asked for. An embedded application differs: its frame is the
provider's own page, so the provider's signature and definition work there unchanged.

**Part 1: a `generic` definition** (`extension/src/adapters/sites/generic/`, or `generic/` in the sites package
once "One directory per adapter" is built), on the engine, shared drivers only.
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

**References when built:** `components/sites.md` (a Generic section), `components/adapters.md` (replace "No
generic definition"), `components/extension.md` (replace "Not covered"), `protocol.md` (`GENERIC`),
`mcp-tools.md` (which tab), `security.md` (the submit guard on arbitrary pages; password forms excluded),
`status.md`.

**Challenges and open questions.**
- Custom widgets are the employer's own (a home-made dropdown, a date picker). The generic reader finds only what
  standard markup says; the rest is the user's. How much to try, beyond `role=combobox`, needs real pages.
- The forms' quality varies: unlabelled inputs, prompts in neighbouring `div`s. A prompt from the nearest
  preceding text is tempting but often wrong; start strict.
- A form that forwards to Workday or Oracle may still send the user to that site for a later step: it's then a
  registry site from that point on.

## 2. Put off re-indexing a repo for a set time (Low, S)

**Why.** When the user answers "later" to re-indexing a repo with new commits, `workspace_change_mark { as:
"later" }` hides it only until the chat ends (`FreshnessService.later`, in memory, by change id). Every new
`ezapply chat` asks again, which for someone opening several chats a day is the same question each time, and a
repo pushed to daily is asked about daily.

**How.**
- **A timer per repo,** in `state.json`: `deferred: { repos: { "<owner>/<name>": { until, at } } }`. Optional, so
  no `schemaVersion` bump.
- **Setting it:** `workspace_change_mark { ids, as: "later", hours? }` (`ids` replaces `id`, so one call puts off
  several). On a `repo-pushed` change, `later` starts that repo's timer: 24 hours by default, longer when the user
  says ("for a week" → 168), at most 90 days so no repo is silenced for good (deselecting it is how to stop for
  good). **All:** the agent passes every current `repo-pushed` id; **some:** the ones the user names.
- **While a timer runs** the repo isn't checked at all (no `ls-remote`), so pushes made meanwhile don't ask, unlike
  the change id's state today. **When it has run out,** the next chat's check reports the repo if its head differs
  from `indexedSha`, pushes made while it was put off included. A repo with no running timer that gets new commits
  is asked about at the next chat's start, as now.
- **Ending a timer early:** re-indexing (`knowledge_mark_indexed`) and deselecting the repo drop it. Expired
  timers are dropped on any write to `state.json`.
- **Seen by the agent:** `workspace_changes` lists running timers as `deferred[] { repo, until }`, so it can answer
  "what did I put off?" and offer to re-index one early.
- **Other kinds keep `later` for the chat,** and `hours` on them is refused with a hint: a template or profile
  behind its source feeds the next document, so asking each chat is right for them.
- **Skill** (`ezapply-onboard`, keeping current): ask now, after this posting, or put off, for a day unless the
  user says longer; all repos or the ones named.
- **Tests:** a timer set and the repo not checked in a new service (no `ls-remote`); the default and a given
  length, the cap; an expired timer checked and reporting pushes made meanwhile; a repo without a timer reported
  at once; all and some through `ids`; `hours` on another kind refused; re-indexing and deselecting dropping the
  timer; `deferred` listed; the skill's call shape.

**References when built:** `components/companion.md` ("Keeping the workspace current"), `mcp-tools.md`,
`data-formats.md` (`state.json`), `flows.md`, `development.md` (the freshness test's row), `status.md`.

---

## Application manager

One place for the user's job search: the postings they might apply to, where each application stands, and what
to do next. ezapply already keeps each application's record (the posting folder: `meta.json`, `form-log.jsonl`),
so the manager reads and extends those; it adds no database.

### 3. Application tracker: progress and outcomes (Medium, M)

**What.** "What's in flight?": each posting's progress (drafted, filled, submitted), deadline, date submitted, what
happened after (applied, interviewing, rejected, offer, withdrawn), and the next action. Postings drafted but not
applied to show up as such.

**How.**
- **Outcomes**, beside `status` rather than in it: `status` is ezapply's own progress, moved forward by the form
  tools; an outcome is what the employer did, told by the user. `meta.json` gains an optional `outcome { state,
  at, note? }` with a short `outcomes[]` history (`interviewing`, `rejected`, `offer`, `withdrawn`, `no-response`),
  set through `posting_update_meta` when the user says "Acme turned me down" (the agent finds the posting with
  `postings_list { company }`). Optional, so no `schemaVersion` bump.
- **The list:** `postings_list` gains `deadline`, `submittedAt` (from the log's confirmation step), `outcome`, and
  filters (not yet submitted, awaiting a reply, by outcome), sorted by deadline, then by date submitted.
- **Views:** an `ezapply-status` skill formats it in chat and suggests the next action per posting (tailor, review,
  fill, submit, follow up after N weeks with no reply). `ezapply status --postings` prints the same table without
  starting Claude, at no token cost. A read-only page on the companion's loopback server, beside the review page,
  could show it as a board by stage; it lives only while a chat is open.

**Challenges and open questions.**
- `deadline` is set only when the agent finds one in the posting, so many will be empty.
- Outcomes are set by hand; replies arrive by email, which ezapply doesn't read. The user can paste a reply into
  chat for the agent to record.
- Is a page worth it over the CLI table and the skill? A page on the UI package
  (`references/components/ui.md`) would cost little.

### 4. Job search across the boards ezapply knows (Medium, L)

**What.** Find new postings that fit the user, from the employers they care about, without visiting each careers
page: a list to pick from, each captured as a posting with one word.

**How.**
- **Sources are the boards' public job lists**, per registry site: Greenhouse's Job Board API, Lever's postings
  API, Ashby's public job board API, Workday's careers-site JSON, Oracle's requisitions REST. Each registry entry
  gains an optional `listJobs(tenant)` in a companion module (`search/`), so a new site covers itself. No scraping of
  LinkedIn, Indeed or other aggregators: their terms forbid it and they block headless clients; the live-check
  rule against bot-protection workarounds holds here too.
- **Which employers:** a watch list in the profile (`profile/watchlist.yaml`: company, site, tenant), seeded from
  the tenants of past postings and grown by the user ("watch Acme's Greenhouse board").
- **Matching** in two passes: a deterministic filter from `jobPreferences` (locations, work mode) and keywords the
  user sets (titles, seniority, exclusions), then the agent ranks what's left against the profile and says why.
- **Dedupe** by canonical URL against `search/seen.jsonl` and existing postings, so a job is shown once.
- **Tools:** `jobs_search { companies?, query? }` returns new matches; `posting_capture_url { url }` captures a
  chosen one without the browser, from the board's JSON (its description is the posting text), so
  the posting folder is the same as a capture's.

**Challenges and open questions.**
- Discovery: the boards have no search across employers, so the watch list is as good as the user makes it.
- Workday's and Oracle's JSON endpoints are the careers sites' own, not published APIs; they can change without
  notice. Rate-limit and cache politely.
- A posting captured from JSON has no visible-HTML step; its description is still untrusted, so the
  prompt-injection rules apply unchanged.

### 5. Job alerts (Medium, M)

**What.** Tell the user when a new posting matching their search appears, without a chat open. Deadline reminders
from the tracker ride along.

**How.** The companion runs only inside `ezapply chat`, and Claude Code's scheduled tasks only while a session is
open, so alerts need the OS scheduler. `ezapply alerts on` registers a job (Task Scheduler, launchd, a systemd timer
or cron) that runs `ezapply search --new`: the deterministic pass of the job search only, no Claude, no tokens. New
matches go to `search/new.jsonl` and an OS notification ("3 new postings at Acme, Globex"); deadlines within two
days get one too. The next `ezapply chat` lists them first, as it does workspace changes, for the agent to rank.
`ezapply alerts off` removes the job.

**Challenges and open questions.**
- Registering a scheduled job differs per OS and may need the user's approval; `ezapply doctor` should report it.
- How often: daily is enough for most boards; more risks rate limits.
- Email or phone alerts need a sender or a service, which ezapply avoids: start with OS notifications.

### 6. Auto mode (High if trusted, else Low; XL)

**What.** The agent searches regularly, drafts the documents for strong matches, fills each application, and leaves
it at the review step, so that applying is the user checking it and pressing Submit.

**How.**
- **The agent:** the alerts job, on new matches above a score, starts Claude Code headless (`claude -p`) in the
  workspace with an `ezapply-auto` skill. Claude Code stays the only agent; ezapply gains a trigger, not a loop.
- **Per match:** capture, tailor the resume and cover letter with the existing skills, compile and check. Anything
  the agent would ask about (a sensitive or unanswered question, a gap in the evidence, a document it isn't sure
  of) goes into a queue rather than being guessed.
- **Filling:** a browser the companion starts for this (its own profile, with the extension loaded and the user's
  sessions on the sites), filling through the same tools and adapters up to the review step, never past it. A tab in
  a truly headless browser can't be handed to the user, so it runs as a window kept in the background.
- **The queue** (the tracker's page or the `ezapply-status` skill): each application ready to submit, with its
  documents to approve on the review page, its questions to answer, and the tab to open. Submit stays the user's
  press; the guard is unchanged.
- **Limits:** a daily cap, a minimum match score, and nothing for an employer already applied to.

**Challenges and open questions.**
- It goes against the philosophy as written: "the user decides" becomes "the user checks", and "applying in bulk"
  is a non-goal. Adopt it only by changing `philosophy.md` first, and keep the honesty rules (no fabrication, ask
  rather than guess) as hard as they are now.
- Sessions: Workday wants an account per employer and Oracle an email code each time, and signing in and signing up
  stay the user's, so most applications stop at sign-in until the user signs in.
- Documents drafted without the user's chat lose the corrections they'd give along the way. The review page and
  its view of what changed since the last review carry the weight.
- Tokens: each application is a full tailoring and filling run. The cap bounds the cost.

---

## Improvements to the adapter-building workflow

### 7. Agents that try to break a new adapter (Medium, M–L)

**Why.** One agent writing an adapter and judging it too sees what it meant to build, not what it built. The
process in `references/building-adapters.md` goes from tests the builder wrote straight to a live run with the
user's account; nothing in between tries to break the adapter.

**How.** A skill in this repo (`.claude/skills/break-adapter/`, for Claude working on ezapply, not the
workspace), run once a site's definition and tests exist (after "Tests" in the process, before "Check it live").
It links to `building-adapters.md` rather than copying it, and splits the work across subagents with separate
contexts, in a loop:
- **Runner:** gets only the built bundle, the saved pages and the live-check script, never the builder's reasoning.
  It runs the whole flow against the saved pages served locally (every field read, filled with fake values and read
  back, rows added and removed, Next and Back, Submit pressed synthetically to prove the guard), then against the
  variants below. It reports each failure with the page, the variant, the call, its arguments, what came back and
  what should have, and the debug trace.
- **Improver:** fixes what the report names, adding a failing test for each failure first, and hands back to the
  runner.
- **Stops** when the conformance and extraction tests pass and a runner round finds nothing new, or after a set
  number of rounds, leaving what's still failing for the user. On a public page the runner may then do the same
  live, under the live-check rules; a page behind an account waits for the user's first run with debug mode on.

**The live-check script, in the repo** (`scripts/live-check/`): the script used for Greenhouse, Lever and Ashby
(`references/components/adapters.md`, "Checking a site live"), with this machine's paths made options: the
browser (Chrome or Edge, found as the companion's `Opener` finds them), headless or not, the page (a URL, or a
saved page served by a loopback static server), and the site. It injects `<site>-main.js` into the page's main
world over the DevTools protocol as the extension does, runs a list of adapter calls from a JSON file, and writes
each result, with debug mode's trace when asked. Its rules don't change: never submits, obviously fake values, no
upload to a third party, no bot-protection workarounds.

**Variants,** each a named transform of a saved page (`scripts/live-check/variants/`), so a failure reproduces and
every site reuses them: fields rendered late (inserted by a script after a delay), sections reordered, prompts
relabelled (a synonym, a trailing `*`, extra whitespace), a list replaced by one that loads as you type, rows added
or removed by the page, errors appearing on blur, a second form on the page, duplicate ids.

**Tests:** the call runner and the variants on one existing site's saved page, so the tool isn't what's flaky.

**References when built:** `building-adapters.md` (a step between "Tests" and "Check it live"),
`components/adapters.md` ("Checking a site live": the script is in the repo), `development.md` (scripts, the
skill).

**Challenges and open questions.**
- Real markup of application steps needs an account and an application in progress. The user has to drive that;
  debug mode's markup and `ezapply debug export` make one run enough.
- The variants are guesses about how the site behaves; an adapter hardened against them can still miss what the
  real site does. They test robustness, not fidelity: the saved pages and a live run stay the evidence.
- A loop of agents costs many tokens per site; worth it for sites with many applications behind them.

### 8. One directory per adapter (Medium, M–L)

**Why.** A site is spread over three packages. Its URL rules (`protocol/src/<site>.ts`), registry entry and id
(`protocol/src/sites.ts`, `SiteId` in `postings.ts`, the export in `index.ts`, a `PROTOCOL_VERSION` bump), its
definition (`extension/src/adapters/sites/<site>/`, listed in `sites/index.ts`), its notes
(`companion/src/forms/sites/`, listed in `index.ts`), its posting reader (`companion/src/postings/readers/`), and
its tests and saved pages (`PAGES` and `SAVED` in `extension/test/sites.test.ts`, `sites-live.test.ts`,
`protocol/test/sites.test.ts`, `extension/test/fixtures/live/`). And some of its knowledge sits in shared code:
`JOB_ID_PARAMS` in `postings/service.ts` (Phenom's `jobseqno`, SuccessFactors' `career_job_req_id` and `company`),
`companyFromUrl` and `ATS_HOSTS` in `postings/extract.ts` (Oracle's and SuccessFactors' data-centre hosts, the
boards' hosts). Reviewing a site means opening all of these, and the types catch only some of a missing piece:
nothing notices a site's job parameter left out of `JOB_ID_PARAMS`.

**Layout.** A package of its own, everything about a site in its directory:
```
packages/sites/               @ezapply/sites
  src/<site>/
    registry.ts               SiteInfo: id, name, signature, URL rules, tenant, job, canonical path,
                              hostPageJob, waits, and what shared code knows now: jobParams (query
                              parameters naming its job), providerHosts (hosts that name the provider,
                              not the employer)
    definition/               site.ts, main.ts, and its own widgets.ts, page.ts, fill.ts, selectors.ts
    notes.ts                  its notes for the agent
    reader.ts                 its posting reader, when it has one
    test/                     its URL rules, extraction from its saved pages, its behavioural tests
                              (Workday's, Oracle's) and golden schemas
    fixtures/                 its saved, scrubbed pages
  src/registry.ts             SITES, in detection order
  src/definitions.ts          SITE_DEFINITIONS (the extension's side)
  src/notes.ts, readers.ts    SITE_NOTES, POSTING_READERS (the companion's side)
  src/conformance.test.ts     every site: today's conformance and signature tests
packages/engine/              @ezapply/engine: today's extension/src/adapters/engine/ and widgets/
```
- **The lists stay per side,** so the extension's bundles never pull in notes or readers and the companion never
  pulls in the drivers. A test fails when a directory is missing from any list, or a list names one that's gone.
- **Dependencies:** `protocol` ← `engine` ← `sites` ← `extension`, `companion`. The engine leaves the extension
  because the definitions import it and the extension imports the definitions. Protocol keeps the types
  (`SiteInfo`, `Timing`, `STANDARD_WAITS`) and stops knowing the sites: `SITES`, `FormSiteId` (now derived from
  `SITES`), `detectSite` and `isFormSite` move to `@ezapply/sites`, and the wire schemas take a site as a string
  each peer checks against `SITES` (`generic` stays protocol's).
- **No `PROTOCOL_VERSION` bump per site:** `hello` carries the extension's site ids, and the companion reports a
  mismatch as an extension built from another version, with the rebuild hint a version mismatch gets. Today the
  bump is how an older peer rejects a new id; the list says which site is missing.
- **Shared code loses site knowledge:** `JOB_ID_PARAMS` becomes the generic parameters plus every site's
  `jobParams`, and `companyFromUrl` and `ATS_HOSTS` ask the sites' `providerHosts` and hosts. A test scans the
  other packages' sources, comments stripped with TypeScript's scanner, for any site id, so knowledge can't creep
  back.
- **The build:** `extension/build.mjs` builds `sites/src/<site>/definition/main.ts` for each of `SITES`; vitest
  picks up `packages/sites/**/test/`.
- **References stay in `references/`:** a site's reference page doesn't move into its directory. The
  directory gets no README of its own, so there's one place to keep current.

**Doing the move.** In three steps, each with every test passing:
1. A pure move: files and imports only. Golden schemas unchanged, and the built bundles compared with the
   previous build's (paths in comments and the version hash aside) to show the code is the same. So no live run is
   spent on it.
2. The site knowledge in shared code moves into registry entries, with tests that canonical URLs and companies
   from captures come out as before.
3. The site list in `hello` replaces the per-site protocol bump.

**References when built:** `building-adapters.md` (the table "What, where" and the process become the one
directory and its files; the checklist), `components/adapters.md`, `protocol.md`, `extension.md`, `companion.md`,
`postings.md`, `architecture.md`, `development.md` (packages, tests), `README.md`.

**Challenge.** Workday's and Oracle's fixtures and helpers (`test/adapters.ts`) are shared with the companion's
e2e tests. They move with the sites, and the e2e tests import them from there.

---

## The browser as the only interface

### 9. Everything in the browser (High, L–XL)

**Why.** After setup the user works in two places: the browser (capture, sign in, review, Submit) and the
terminal, where they type every request to Claude, answer its questions, approve its commands and read its
reports. The terminal half is the friction: switching windows mid-application, a chat that has to be read to know
what's happening, questions that sit unanswered while the user looks at the form. All of it fits in a panel beside
the page the user is already on.

**What.** The extension's toolbar button opens a side panel, and everything happens there: setting the posting,
tailoring the documents, filling the form, a chat with the agent as in the Claude Code terminal, and the agent's
questions and requests for approval. Claude Code is still the agent, with the same skills, tools and workspace;
the companion runs it headless ([agent](references/components/agent.md)) and relays everything between it and the panel. The review page and the setup page
stay tabs (a PDF and an eleven-step form don't fit a panel), opened from it.

**What used to need the terminal, in the panel.**
- **Skills ask through `ask_user`** ([the panel](references/mcp-tools.md#the-panel)) wherever they ask the user in
  chat today: a step's screening questions (one card per step), gaps in the evidence, "is this tab Acme's
  application?" (`postingMismatch`), "sign in, then Continue", a date the page didn't take. With that, today's rule
  that a sensitive question gets no suggestion goes (the onboarding page's screening step, the `ezapply-apply` and
  `ezapply-answers` skills): it gets one, flagged as sensitive.
- **Reports:** the agent's text, in the conversation.
- **Review:** `review_documents` opens the review tab as today; the panel shows the review as waiting, with a button
  to bring its tab back, and its outcome when answered.
- **Onboarding tasks:** a task is a message to the general conversation, with its `how`. The blocking `onboarding`
  tool, "whether the agent is listening" and "tell Claude in the terminal to continue" go away.

**The side panel** (`extension/src/panel/`, Chrome's `side_panel`, Firefox's `sidebar_action`).
- **Opening:** the toolbar button opens the panel (Chrome: `setPanelBehavior({ openPanelOnActionClick: true })`;
  Firefox: `sidebarAction.toggle()` in the click). Set posting moves into the panel. Firefox allows
  `permissions.request` only in a user's click; a click on the panel's button is one. Alt+Shift+P still captures
  without opening the panel.
- **Data over the bridge**, not a page of the companion's: the panel is an extension page, and the extension is
  already paired and pinned, so the panel needs no token of its own. New bridge methods, companion side:
  `panel.state`, `panel.send { text }`, `panel.stop`, `panel.answer { askId, answers }`, `panel.permission { id,
  allow, message? }`, `panel.switchPosting { id }`; and events from it, `panel.event` (an agent event) and
  `panel.changed`. Built with React and the UI package's components, bundled into the extension. *Rejected:* framing
  the companion's `/app` page in the panel: the page's `SameSite=Strict` cookie isn't sent in a frame under an
  extension page, so it would need another token scheme, and a panel open while ezapply isn't running would show
  nothing.
- **Elements**, top to bottom:
  1. **Header:** ezapply's mark; a status dot (connected, not running, not paired); the posting picker (the active
     posting, the recent ones, "No posting"); a menu with Setup (opens the setup tab), Settings, and Open log.
  2. **When it can't work:** not running ("Start ezapply: run `ezapply` in your workspace", copyable); not paired
     (the pairing steps); setup not finished (the required steps left, Continue setup). The rest of the panel is
     disabled, not hidden.
  3. **Posting card:** company, role, site badge, status (`new`, `drafting`, `filled`, `submitted`), deadline,
     requirement chips from `notes.md` (one PDF, cover letter required, two-page limit…), and **Reset**: a new
     conversation for this posting (asks first; stops the agent if it's working and withdraws open cards).
  4. **This tab:** what the current tab is, from `browser.status` and the posting match: "Acme's application on
     Workday, step 2 of 5", "Another posting's application", "A job page", "Not a job page".
  5. **Action buttons:** **Set posting** (captures the current tab; "Capture again" when it's already this
     posting); **Tailor documents** (the resume and, when the requirements ask for one or the preferences say so, a
     cover letter; a menu beside it for one of them, or for putting them in one PDF); **Fill form** (on the
     application tab: fill it; elsewhere: "Open the application" when the posting knows its link, else disabled
     with why). Each sends a message to the conversation naming the skill (`/ezapply-resume`…), so the button and
     typing the same request do the same thing. Disabled while the agent works, with the reason.
  6. **Documents:** each file the posting has (resume, cover letter, bundle) with pages and its state (draft,
     waiting for your review, approved, changes asked, attached); Review opens the review tab, the name opens the
     PDF.
  7. **Needs you** (pinned above the conversation while anything waits): question cards and approval cards, oldest
     first, a count on the toolbar badge, and the panel scrolled to the first. A question card: title, intro, each
     question by type (radios, checkboxes, a text field or box), the suggestion filled in and marked, `why` under it,
     Skip on optional ones, Save for next time where offered, Send, and "Reply in chat instead". An approval card:
     the tool, the description, the exact command or file and change in monospace (scrollable, never cut),
     Allow, Deny, and Deny with a reason.
  8. **Conversation:** the user's messages; the agent's text (Markdown, rendered as text, no HTML); tool calls
     folded to one line each ("Compiled resume.tex: 1 page", "Filled 12 fields on step 2"), unfolding to their
     input and result; answered cards, kept as a record; a line at each turn's end with its cost; progress of a
     fill ("Step 3 of 5, 14 filled, 2 waiting on you"); the hand-off at the end of a fill (the answers to check, and
     Submit is yours).
  9. **Chat bar:** a text box ("Ask or tell ezapply anything"), Enter sends and Shift+Enter is a new line; Send,
     which becomes Stop while the agent works (typing still sends, queued); a line above it saying what the agent
     is doing.
  10. **Footer:** the conversation's cost so far.
- **Starting ezapply:** `ezapply` (or `ezapply start`) hosts the companion with no Claude in the terminal, and
  prints "Open the ezapply panel from the toolbar; Ctrl+C stops ezapply". `ezapply chat` stays while the panel is
  unproven live (open question below).

**Later parts, each on its own once the panel works.**
- **Starting without a terminal:** a native messaging host (`ezapply native-host`, registered by `init`) the panel
  asks to start the companion when it isn't running. A process the user didn't start in a terminal, which the "no
  daemon" choice in `architecture.md` argued against; weigh it then.
- **The review in the panel**, if a narrow PDF viewer turns out usable.
- **Pointing at a field:** a hand-off item that scrolls the form to its field and outlines it (an adapter call).

**Philosophy and security.**
- `philosophy.md` first: Principle 1 becomes "Claude Code is the only agent, run by ezapply headless; the user
  works with it in the extension's panel", the non-goal "screens of ezapply's own beyond the review and setup
  pages" goes, Principle 8 counts the terminal out of everyday use, and Principle 9 reads "asks, with a suggestion
  where it has one, rather than filling sensitive answers itself". "The user always submits" and no fabrication
  don't change.
- `security.md`: approvals now come from the panel. The panel is an extension page talking over the paired bridge,
  so a web page can't reach it; the companion takes `panel.permission` only from the pinned extension, only for a
  request it raised and that's still open, and never stores an Allow. What the panel shows (posting text, the
  agent's words, a form's labels) is text, never HTML. The extension gains the `sidePanel` permission (Chrome).

**Tests.** The onboarding task path without the blocking tool; the bridge's panel methods refused from anything but
the pinned extension; the start command passing Claude Code to the companion; the skills' `ask_user` call shapes
(`skill-calls.test.ts`); the panel's components in the UI tests.

**References when built:** `philosophy.md`, `architecture.md` (processes, transports, the panel), `flows.md` (every
flow's "in chat" steps, capture from the panel), `components/companion.md`, `components/cli.md` (the new start,
`runChat`'s restart gone), `components/extension.md` (the panel, the toolbar button, the bridge methods),
`components/ui.md` (shared components, the onboarding page's tasks), `components/workspace.md` (skills),
`components/protocol.md` (bridge methods), `components/agent.md` (what starts it, the panel's side),
`mcp-tools.md` (`onboarding` gone), `security.md` (approvals from the panel; sensitive questions suggested, never
filled without the user), `development.md`, `status.md`.

**Challenges and open questions.**
- `ezapply chat` after this: keep it for debugging ezapply (the full terminal view of what Claude does), or drop it
  so there's one way to run ezapply and less to keep current?
- The panel is per window in Chrome. Two windows show the same conversation; both can answer a card, and the first
  answer wins.
