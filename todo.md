# ezapply: todo

Proposals, as of 2026-10-03. Finished work is described in `references/` (what still needs a live run, and
what the live runs found, is in `references/status.md`) and in git history.

Each proposal is rated for how much it helps one person apply faster without lowering quality or honesty.
- **Value:** High, Medium or Low.
- **Effort:** S (a day or less), M (a few days), L (one to two weeks), XL (more).

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

| # | Proposal | Value | Effort | Needs first |
|---|----------|-------|--------|-------------|
| 1 | Modular adapters: a site is a definition | High | L | — (3 before its phases 4–5) |
| 2 | Embedded application forms | High | M | 1 |
| 3 | Deterministic autofill: live runs left | High | S | — |
| 4 | Tie each application to its posting | High | M | — |
| 5 | The companion runs the hand-off checklist | High | M | — |
| 6 | Autofill debug mode | High | L | — |
| 7 | More application sites, and Oracle follow-ups | High | M per site | 1 (2 for embedded sites) |
| 8 | Show what changed in a document | Medium | M | — |
| 9 | Application tracker | Medium | S–M | — |
| 10 | A skill for building adapters | Medium | M | 1, 6 |
| 11 | Login manager | Medium | L | — |

Suggested order:
1. ~~Autofill phase 1~~ (built 2026-10-01).
2. ~~Debug mode's companion part~~ (built 2026-10-01).
3. ~~Items 4 and 5~~ (built 2026-10-01).
4. ~~A live run with debug mode on~~ (Hooli, 2026-10-01): autofill phase 1, posting matching and the
   checklist; its fixes are in.
5. ~~Autofill phases 2 and 3~~ (built 2026-10-02).
6. **Next: modular adapters** (item 1). Its phases 1 and 2 change no adapter's behaviour; then the first new
   sites on the engine (item 7), with embedded forms (item 2) for Greenhouse and iCIMS.
7. The autofill live runs (item 3) whenever the user next applies on Workday or Oracle, with debug mode on.
   They go before item 1 moves Oracle and Workday onto the engine (its phases 4 and 5).
8. The rest of debug mode (item 6): the adapter trace, built into item 1's engine, then markup.

Item 10 comes after item 1.

---

## 1. Modular adapters: a site is a definition (High, L)

**Goal.** Adding a job site should mean describing it, not writing an adapter. A site definition says:
1. which page is which: posting, sign-in, start choice, step, review, confirmation;
2. where the buttons are: apply, next, back, submit, add a row, delete a row, save an inline form, the start-page
   choices;
3. which kinds of fields exist, by naming the widget drivers its fields use;
4. where each field is and where its prompt is: the field's container, its label, help text, error, required
   mark and section;
5. code only for a widget no shared driver handles: how to put an answer into Workday's dropdown or Oracle's
   cx-select.

One engine does the rest, written once:
- the adapter API the background calls;
- the extraction loop and field ids;
- rows and saved items;
- the fill loop, with its waits and checks;
- moving between steps;
- the submit guard, strict option matching and the waits.

The companion and the agent keep the same `FormSchema` and tools.

**Why now.** The two adapters are about 3,500 lines: Workday 1,600, Oracle 1,650, `common/` 280. The user's
postings so far: Symplicity (the school's co-op portal, 9), Workday (3), Oracle (2), Ashby (Cohere), Greenhouse
embedded on Initrode's site, iCIMS embedded on careers.example.com, and Nakatomi's own site. At 1,600 lines a site,
covering them isn't practical. Most of each adapter repeats the other: the API, ids, sections, rows, errors and
notices, the fill loop, next and back, the guard. What really differs per site is the markup (where things
are) and a few widgets.

Simplify Copilot covers 57 providers the same way, one engine plus data per provider (studied 2026-10-02).
Their data needs label rules for every question on every provider ("sponsor", "require our assistance"). Ours
won't: the agent reads every field's prompt, so a definition only has to say where the prompt is.

**What doesn't change.**
- The adapter API: `getForm`, `listOptions`, `searchOptions`, `fill`, `upload`, `remove`, `removeRepeatable`,
  `addRepeatable`, `next`, `back`, `pageAction`, `setTiming`, `blockedSubmitAttempts`, `version`.
- `FormSchema` and its field ids (golden tests hold them).
- The MCP tools and the skills.
- Injection into the page's MAIN world on demand, one bundle per site.

**Today, and after.**

| Today | After |
|---|---|
| `workday/selectors.ts`, `oracle/selectors.ts`, the page and field parts of each `extract.ts` | `sites/<site>/site.ts`: the definition |
| Widget code spread over `fill.ts` and `extract.ts` (`currentValue`, `knownOptions`, `fieldKind`) | `widgets/`: shared drivers, plus `sites/<site>/widgets.ts` for the site's own |
| Two `api.ts`, two extraction loops, ids, rows, errors | `engine/` |
| `common/dom.ts`, `guard.ts`, `timing.ts` | `engine/`, unchanged |
| Two `main.ts`, `ADAPTERS` in `background/forms.ts`, the site list in `build.mjs` | generated from the site registry |
| Detection, tenant and job in `protocol/src/browser.ts`, `workday.ts`, `oracle.ts`; `FORM_SITES`; the Workday posting hooks and locale segment | `protocol/src/sites/`: one registry entry per site |
| The companion's `form.adapter === "oracle"` (autofill's `rowsToAdd` and `missingItems`, the hand-off check in `FormsService.checks`) and Oracle's id formats in `forms/lists.ts` | facts in the schema (below) |
| Oracle's site access in the background, Set posting and the options page | per registry entry: fixed hosts, or origins granted one at a time |

### The site definition
`extension/src/adapters/sites/<site>/site.ts`. It's TypeScript, not JSON: typed, able to hold a small function
where a selector isn't enough, tested like code, and bundled with the extension. It's never fetched remotely.
Manifest V3 forbids remote code, and every change to what touches a form should be reviewed and tested.

```ts
interface SiteDefinition {
  id: SiteId;
  pages: {                                   // the first that matches; "step" when the page has fields
    confirmation?: Signal; auth?: Signal; startChoice?: Signal; posting?: Signal; review?: Signal;
  };
  step?: { title: Find<string>; index?: Find<number>; total?: Find<number> };
  fields: {
    container: string;                       // one field: Workday [data-automation-id^="formField-"], Oracle .input-row
    skip?: string;                           // never a field: a honeypot, a nested container
    prompt: Locator[];                       // the question: label[for], legend, aria-labelledby… (first with text)
    help?: Locator[];
    error?: Locator[];
    required?: (container: HTMLElement) => boolean;
    section: (container: HTMLElement) => string;              // the heading it sits under
    key?: (container: HTMLElement, prompt: string) => string; // default: control id without its render counter, else the prompt
    more?: (doc: Document) => Candidate[];   // fields outside containers: Oracle's phone halves, uploads, agreements
  };
  widgets: WidgetDriver[];                   // the site's own first, then shared; the first that recognises a field decides its kind
  buttons: {
    next: Locator[];
    back?: Locator[];
    submit: Locator[];                       // also caught by the shared text rule ("Submit", "Submit application")
    actions?: Partial<Record<PageAction, Locator[]>>;
    add?: { button: string; section: (b: HTMLElement) => string | undefined; opens: "row" | "form" };
    save?: string;                           // an inline form's Save
  };
  rows?: { delete: string };                 // a row: a section whose container holds its own delete button
  items?: { saved: string; title: Find<string>; delete: string; revealOnHover?: boolean };
  alerts: { selector: string; notice?: (text: string) => boolean };
  hints: { key: (field: Field) => string | undefined; table: Record<string, string> };
  fill?: { order?: "given" | "page"; waitForStaleErrors?: boolean };
}
```

A `Locator` is a CSS selector, a function, or `byText(/^(next|continue)$/i, within?)`. The first one that finds
something wins, so an element can be known by several automation ids, as now.

### Widget drivers
```ts
interface WidgetDriver {
  kind: FieldKind;
  is(c: HTMLElement): boolean;                         // this container holds this widget
  value(c: HTMLElement): Field["currentValue"];
  options?(c: HTMLElement): string[] | undefined;      // known up front: radios, pills
  dateParts?(c: HTMLElement): DatePart[];
  multiple?(c: HTMLElement): boolean;
  fill(c: HTMLElement, value: FillValue, opts: { strict: boolean }): Promise<FillOutcome>;
  list?(c: HTMLElement): Promise<OptionInfo[]>;
  search?(c: HTMLElement, query: string): Promise<OptionInfo[]>;
  remove?(c: HTMLElement, values?: string[] | null): Promise<RemoveOutcome>;
  upload?(c: HTMLElement, file: File): Promise<FillOutcome>;
}
```

**Shared drivers** (`adapters/widgets/`), each for plain markup and the ARIA patterns most sites use:
- **text:** text, textarea, number, email, tel and url inputs. Native setter and events, React's handler as a
  fallback, and a phone number the page reformats counts as taken.
- **native widgets:** `<select>`, a radio group, a checkbox, a checkbox group, date and month inputs.
- **file:** a file input (`DataTransfer`, then a drop on the drop zone). Done when a new file name shows;
  removes attached files too.
- **ARIA combobox** with a listbox: `role=combobox`, `aria-controls`, type to filter, options as `role=option`.
  This covers react-select and most React and Vue form kits.
- **toggle buttons** (`aria-pressed`), as a radio or checkbox group: Oracle's pills.
- **password:** recognised, never filled.

A site can pass options to a shared driver (which event opens it, how long to wait) before it needs a driver of
its own.

**Site drivers, moved as they are:**
- Workday: the listbox dropdown, the prompt (a typeahead with nested menus), the split date, the drop zone.
- Oracle: cx-select, the date lists, the attachment buttons, and the widgets it reports but can't drive (JET
  comboboxes, the multi-select).

### The engine (`adapters/engine/`)
**`extract.ts`.** For each field container, the first driver that recognises it gives a `Field`:
- the id `<section slug>.<key>`, with `#n` for repeats;
- prompt, help, error, required mark, value, options and hint.

Around the fields it also builds:
- sections, with rows marked `removable`, and saved items;
- add and save buttons (`add.<section slug>`, `save.<block>`);
- the page kind, step, `nextLabel` and `backLabel`;
- errors and messages, and the tenant (from the registry).

**`api.ts`.** `createAdapter(site)` implements the API above, doing what both adapters do now:
- **fill:** in the order the site asks; a settle after each field; the error check afterwards (with Oracle's
  wait for a stale error);
- **add a row:** waits for more fields. An inline form's Save waits for the form to close or to show errors;
- **remove a row:** by the row's own button (hovering first where the site asks), confirming a dialog;
- **next and back:** by a step key (index, title, URL), waiting for the new step's fields. They refuse on review,
  confirmation and sign-in, and at any submit control;
- **page actions**, and the guard.

**`dom.ts`, `guard.ts`, `timing.ts`** come from `common/`, unchanged.

### The site registry (protocol)
`protocol/src/sites/` holds one entry per site:
- `id`, `isUrl(url)`, `tenant(url)`, `job(url)`;
- the posting-page hooks the companion reads, and URL canonicalisation (Workday's locale segment);
- host permissions: fixed hosts in the manifest, or origins granted one at a time at Set posting, as Oracle's
  are.

Everything that knows the list of sites comes from it:
- `detectSite`, `FORM_SITES`, `isFormSite`, `siteTenant`, `siteJob` and canonical URLs;
- the build's site list and the manifest's host permissions (`manifest.test.ts` already compares those);
- site access in the background, Set posting and the options page.

A new site's only protocol change is its registry entry.

### Facts in the schema, instead of site names in the companion
Each definition produces these, and the companion reads them instead of `form.adapter` or Oracle's id formats.
A new site then needs no companion change.
- **`addButtons[].opens`:** `"row"` (Workday's Add) or `"form"` (Oracle's Add Language); a `save.*` button stays
  a Save. Used by autofill's `rowsToAdd` and `missingItems`, and by the checklist.
- **`Section.saved: true`** on a saved item, with its list where the page says so (Oracle's timeline columns,
  experience and education).
- **`FormSchema.lastPage: true`** when Submit is the only way on (Oracle's single page, any single-page site).
  Used by the hand-off.

### Adding a site, afterwards
1. Save the application's pages: posting, each step, review. Item 6's markup export makes one live run enough.
2. Write the registry entry, the definition, and a fixture built from the saved pages.
3. Use shared drivers first; write a site driver only for a widget they can't drive.
4. Pass the conformance test, do a live run with debug mode on, and write the site's reference page.

For a site of plain HTML and common ARIA widgets, step 2 should be most of the work: a definition of 100 to 200
lines.

### Tests
- **Golden schemas, before anything moves.** Write `getForm()` of every fixture state and live snapshot to
  `extension/test/golden/`:
  - Workday: the step, each fixture option, after an Add, review;
  - Oracle: the single page, each section of the multi-page flow, Welcome Back, the language form open;
  - every live snapshot.

  The ported adapters must give the same JSON, apart from the new schema facts.
- **The behaviour tests** (`workday.test.ts`, `oracle.test.ts`, the companion's e2e tests) run unchanged
  against the ported adapters. `createWorkdayApi` and `createOracleApi` stay, as `createAdapter(site)`.
- **Driver tests** on minimal markup, per shared driver: fill, read back, a strict miss, list, remove.
- **A plain-HTML fixture** (`generic-fixture.ts`):
  - labels by `for`, by wrapping, by `aria-labelledby`, and by `fieldset`/`legend`;
  - a native select, radios, checkboxes and a file input;
  - a react-select-style combobox;
  - a repeatable section;
  - Next and Submit.

  The engine is built against it, with no site code.
- **Conformance, per site** (`sites.test.ts`, run for every registered site on its fixture):
  - every field has a prompt and a kind;
  - ids are the same on two reads;
  - the guard blocks the site's Submit, by click and by Enter;
  - `next` refuses on review;
  - each saved page gets its page kind.

### Phases
"One adapter change per live run" holds. A phase that moves an existing adapter's code waits for a live run of
its own, after item 3's live runs (which test `strict`).
1. **(S–M) Registry and schema facts.**
   - The protocol registry, with detection, tenant, job, canonical URLs and permissions taken from it.
   - The three schema facts, emitted by both adapters (an extraction change only) and read by the companion
     instead of `adapter === "oracle"`.
   - No filler changes.
2. **(M–L) Engine and shared drivers**, built beside the two adapters on the plain-HTML fixture. Nothing existing
   moves, so landing it needs no live run.
3. **(M per site) The first new sites on the engine**, picked from the user's postings:
   - Ashby (Cohere), on its own host;
   - Symplicity, with the most postings; its application is the school portal's own;
   - then Greenhouse and iCIMS, together with item 2: in the user's postings both are embedded.

   Each one gets saved pages, a definition, a fixture and a live run.
4. **(M) Oracle on the engine**, after item 3's Oracle run: its definition, its drivers moved, golden schemas
   equal, one live run.
5. **(M–L) Workday on the engine**, after item 3's Workday run:
   - its drivers moved verbatim, with no logic change;
   - golden schemas equal;
   - one live run with debug mode on, compared with the previous run's timings.
6. **(S) Clean-up.**
   - The old adapter folders go.
   - In the reference: `components/adapters.md` (the engine, definitions and drivers), the Workday and Oracle
     pages cut down to their definitions and drivers, and "Add a job site" in `development.md` rewritten.

### Challenges and open questions
- **Moving Workday's fillers is the riskiest part** (it's how e390fef broke autofill), so it goes last: verbatim,
  checked against golden schemas, with a live run of its own. Item 6's adapter trace belongs in the engine (one
  place: every driver call and wait). Building the trace into the engine before phase 5 would make that live run
  a traced one.
- **Sites that almost fit a shared driver**: a combobox that opens only on mousedown, a list that renders late.
  Start with options on the shared driver, and write a site driver only when those run out.
- **Best effort on any site.** The plain-HTML definition (shared drivers, prompts by `label` and `aria-*`,
  buttons by text) could run on a site with no definition, on origins the user grants, as Oracle's are. That's
  the most reach for the least work, but page kinds and the submit test are guesses there. Decide after
  phase 3 shows how far it gets on Ashby and Symplicity.
- **Shadow DOM** (some enterprise sites): the engine's queries would have to look into open shadow roots. None of
  the sites above needs it.
- **Waits per site.** `autofill-timing.yaml` is one set of waits for every site. Keep it, and add per-site
  sections only when a site needs different waits.

**References**:
- a new `components/adapters.md`;
- `components/workday-adapter.md`, `components/oracle-adapter.md`, `protocol.md`, `extension.md`, `companion.md`;
- `autofill.md` and `mcp-tools.md` (the schema facts);
- `development.md` ("Add a job site");
- `security.md` (the submit test per site).

## 2. Embedded application forms (High, M)

**Why.** Company career pages often embed their ATS. In the user's postings, Duff's careers page holds an iCIMS
application (`careers.example.com/…?icims=1`), and Initrode's (`careers.example.org/…?gh_jid=…`) holds
Greenhouse's. The form tools act on a whole tab, chosen by the tab's URL (`resolveTab` in
`background/forms.ts`), so a form inside a frame is never found. Capture already handles this for postings:
`capture/frames.ts` picks the frame that holds the posting, and `meta.json` keeps its `frameUrl`.

**How.**
- **Find form frames.** The background asks each frame of the tab for its URL (`scripting.executeScript` with
  `allFrames`; only frames on hosts the extension may access answer) and runs the registry's `isUrl` (item 1)
  on each. `browser.status` lists, per tab, `frames: [{ frameId, url, site }]` for the frames on a form site.
- **Target a frame.** Form methods take a `frameId` next to the `tabId`, and `callAdapter` injects into
  `{ tabId, frameIds: [frameId] }`. `FormSchema` gains `frameId`. Each frame gets its own adapter instance and
  submit guard.
- **Choose the frame.** `FormsService.target` picks the tab, then the frame on the posting's tenant (by the
  frame's URL), then any form frame. When the top frame is the form itself, nothing changes. For a posting
  captured from an embedded board, its tenant and job come from `frameUrl`.
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
- Needs item 1: the embedded providers (Greenhouse, iCIMS) are new sites.

## 3. Deterministic autofill (High, L in three phases)

**Status:** all three phases built (phase 1 on 2026-10-01, phases 2 and 3 on 2026-10-02). What's built is
described in `references/components/autofill.md`. Phase 1 ran live once (Hooli); phases 2 and 3 were replayed on
that run's recorded pages, not yet run live.

**Left: the live runs.** In order, so a problem points at one change. Both go before item 1 moves the
Oracle and Workday adapters onto the engine (its phases 4 and 5):
1. A Workday run with debug mode on (`ezapply debug on`, then `ezapply debug report`). It checks rows (adding them,
   mapping them, the language levels), computed answers and the chunked fills, and `strict` in the adapter, the
   one adapter change. If it's slower than the 2026-09-30 runs, suspect `strict` first, then the suspects in
   "One adapter change per live run" (`references/development.md`).
2. An Oracle run: the link fields, and the work, education and language entries added through their inline forms.
   The work and education forms have never been seen, so their dates are matched by label on trust, and the
   language levels by the wordings the fixture models.

**Open questions, to answer from those runs:**
- **A wrong fill now happens silently.** The safeguards are the section-fit check, `filled` in the result, and
  the automatic fills listed at the hand-off. Is a glance at `filled` on each step enough?
- **Country and province names.** The profile may hold "ON" where the list says "Ontario". A strict miss goes to
  the model; the debug report's loose-match section shows which aliases come up.
- **Role descriptions** are the profile's highlights as stored, not tailored to the posting as the resume is. The
  replay showed the agent reword one. Keep as stored?
- **Language levels** are one level per language for every skill (reading, writing, speaking). The agent rated
  one language's reading and writing a step lower. Keep one level, or add per-skill levels to the profile?
- **How compact `filled` must be.** The model needs the label to notice a wrong value, but every label costs
  tokens. Measure on the next live run.
- **Workday's certification rows and Oracle's licenses** aren't filled: no live run has shown their fields.

## 4. Tie each application to its posting (High, M)

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
  how often `unknown` happens; debug mode (6) would show it.

## 5. The companion runs the hand-off checklist (High, M)

**Status:** built on 2026-10-01 (`references/mcp-tools.md`, "The hand-off checklist"). The warnings are given
during the step too, on `get_form` and `autofill_step`, so most are fixed before `go_next` instead of after a
`go_back`. Required fields still empty aren't checked: Workday reports those itself on `go_next`. Left: a live
run.

**Why.** The hand-off list in `ezapply-apply` (documents attached, every add-button section filled, files left
from a previous application removed, answers from the user or from judgment flagged) is kept by the model from
memory over many steps. Live runs missed parts of it: the cover letter twice (now caught by `notAttached`),
and sections that start empty are easy to miss. With autofill (item 3) it also lists what was filled
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

## 6. Autofill debug mode (High, L)

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

**For `autofill_step` (item 3), the plan as well.** The planner runs in the companion, so its record needs no
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
  listed above. Once item 1's engine exists, the trace goes there instead: one place, every driver call and
  wait. It's a no-op unless debug is on. The extension sets it with `setDebug(options)` next to `setTiming`, in
  the same `executeScript` (`extension/src/background/forms.ts`, `callAdapter`). The adapter returns
  `{ __ok, __debug }`. The companion strips `__debug` before anything reaches the agent.
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
     section. These are candidates for new hints or row labels (phase 3 of item 3 came from the first such
     list: education years, website rows, language rows);
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
- Without debug mode, autofill has only the `rule` on each `form-log.jsonl` event to go on. That's enough to
  count wrong and missing rules, but not to see the page that caused them.

## 7. More application sites, and Oracle follow-ups (High, M per site)

**Sites.** Each new site is a definition on item 1's engine (its phase 3). In the order of the user's postings:
Ashby (Cohere), Symplicity (the school's co-op portal, most of the postings), then Greenhouse (Initrode) and
iCIMS (Duff), which are embedded in the employer's page (item 2). Then Lever and the providers the user meets
next. Count the sites behind the captured postings (`meta.json` `url` and `frameUrl`) again before each choice.

**Oracle follow-ups** (`references/components/oracle-adapter.md`): re-run a live application to confirm the
fixes from the first one and add languages and certifications; find out why the Cover Letter field was missing
live (save the page); move the posting to `filled` when an Oracle form is complete (it has no review page);
the multi-select dropdown (preferred locations) and JET comboboxes, now left to the user; button texts in other
languages.

**Challenges and open questions.**
- Each site needs a real application step saved. Debug mode (6) makes the first live run produce it.
- A single-page form puts Submit next to every field. The guard must block it for keyboard (Enter in a text
  field) as well as clicks: item 1's conformance test checks both for every site.
- Symplicity's application lives inside the school's portal, behind the student's sign-in. Its documents may come
  from the portal's own document library rather than an upload: look at a real application before planning it.

## 8. Show what changed in a document (Medium, M)

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

## 9. Application tracker (Medium, S–M)

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

## 10. A skill for building adapters (Medium, M)

**What.** A skill in this repo (`.claude/skills/`, for Claude working on ezapply, not the workspace) that walks
through adding a site: saving the site's pages, writing its registry entry and definition (item 1) against
the saved markup, the fixture, the conformance test, permissions, a first live run with debug mode on, reading
its report, and the site's reference page.

**How.** The steps are "Add a job site" in `references/development.md`. The skill links to that and adds the
procedure around it: what to save, in what order to build, which tests to write first, and the checklist for
the live run. It should not copy development.md's list, or the two will drift.

**Challenges and open questions.**
- The hard part is getting real markup of application steps, which needs an account and an application in
  progress. The user has to drive that; debug mode (6) makes one run enough.
- Its worth depends on how many sites get added. With one or two more, `development.md` may be enough.

## 11. Login manager (Medium, L)

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
  application after items 3–6.
