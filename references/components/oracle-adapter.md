# Oracle adapter (`packages/extension/src/adapters/sites/oracle/`)

Reads an Oracle Recruiting Cloud application (Oracle's "Candidate Experience") into a
[`FormSchema`](protocol.md#form-schema) and fills it for Claude. Oracle is a site definition on the
[adapter engine](adapters.md), with drivers of its own, so it has the same API as every other site and the
background, the companion, the MCP tools and the skill treat them alike. Built into `oracle-main.js` and injected into the page's **MAIN world**: the page is Knockout
components with React widgets inside (`cx-select`, `cx-select-pills`), and React widgets respond only to
events that reach React's own root listener, which the MAIN world dispatches like a user's.

| File | Role |
|---|---|
| `site.ts` | The definition: page rules, the step key (URL and step), repeat rules (a timeline entry's delete button revealed by hovering, an inline form's errors), fill rules (page order, stale errors, scroll before upload, new errors only), the waits, messages |
| `main.ts` | Bundle entry: `install(oracle)`, which defines `window.__ezapply_oracle` ([engine](adapters.md#the-api-apits)) |
| `page.ts` | Page detection, fields (`oracleFields`), saved items and rows (`oracleRows`), add and Save buttons (`oracleAddButtons`), step, errors and notices, page actions, `isSubmitControl`, `nextButton`, `backButton`, and the value readers the drivers use |
| `fill.ts` | One filler per widget, option listing and search, uploads, removals |
| `widgets.ts` | `ORACLE_WIDGETS`: the fillers and readers of `fill.ts` and `page.ts` as drivers |
| `selectors.ts` | **Every Oracle-specific string of the adapter**: class hooks, button texts, `PROFILE_HINTS`. URL detection and the tenant come from `@ezapply/protocol/oracle` ([protocol](protocol.md)) |

The engine (`adapters/engine/`) does the rest, as for every site: the API, ids and sections, the fill loop,
next and back, the submit guard, the waits ([adapters](adapters.md)). When the adapter moved onto it
(2026-10-03), its fillers and readers moved unchanged and the golden schemas stayed equal. It hasn't run live
since.

## Which pages

Oracle career sites live on the employer's Oracle Cloud host
(`<pod>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123`) or, as often, on the
employer's own domain (`jobs.example.com/en/sites/CX_1/job/123`). The host says nothing, so the extension knows
an Oracle page by its body: the registry's signature is the Candidate Experience's own components (`apply-flow`,
`apply-flow-block`, `apply-flow-header`), its dialogs (`.app-dialog__wrapper.oj-dialog-body`) and its scripts'
path (`/hcmUI/CandidateExperience/`), checked on every saved Oracle page ([telling a page's
site](extension.md#telling-a-pages-site-framests)). Where no page can be read, `isOracleUrl`
(`protocol/src/oracle.ts`) goes by the path: https, an optional `hcmUI/CandidateExperience`, a language
(`en`, `fr-CA`), `sites/<site number>`, then one of the Candidate Experience's routes (`job`, `jobs`,
`requisitions`, `my-profile`). "Sites" pages on other websites don't have that shape (tested).

The **tenant** is host plus site number, lowercased (`jobs.example.com/cx_1`): an employer's postings and its
applications share it, which is what the companion compares ([tab choice](../mcp-tools.md#forms)). Both it and the
job come from that path, so a page known to be Oracle's by its body on a URL of another shape has neither, and
its tab is matched to a posting by its binding or by what the page shows.

## Site access

Oracle career sites can be on any host, and the extension holds every site from the install (`<all_urls>`), so
nothing is asked for one Oracle site at a time ([access to websites](extension.md#access-to-websites)). Asking
for one origin at a time was rejected: a tab on a host the extension doesn't hold can't be read, so its site
could only be guessed from the URL. A host list such as `*.oraclecloud.com` was rejected too: it doesn't cover
employers' own domains, and it would reach every Oracle Cloud customer's own staff applications on those hosts.

## Page detection (`detectPage`), in order
1. **confirmation:** no flow on screen, no fields, and a `/thank-you` URL or "thank you for applying" /
   "application submitted" / "you have applied" text.
2. **auth:** a visible password or one-time-code input, the email-verification form, or an
   `/apply/email` URL. Applying starts with an email step (email, terms checkbox, Next), followed for a known
   address by a code sent to it; the user completes both. **Verified live** (the email step).
3. **start-choice:** "Welcome Back" (a returning candidate's profile) with **Use My Profile** on screen.
4. **step:** a section of the apply flow on screen, or any fields.
5. **posting:** an Apply / Apply Now button outside the flow. **Verified live.**
6. **unknown**.

There is no `review` kind: Oracle has no review page. The forward button is **Submit** on the last section,
and on single-page sites it is the only one.

## The flow: single page or multi-page
The flow is sections (`.apply-flow-section`: "Personal Info", "Job Application Questions"…), each of blocks
(`apply-flow-block`: "Contact Information", "Address", "Application Questions"…), each of rows. A site
shows either:
- **every section on one page** (the employer site the adapter was built from), with Submit as the only
  button: `step.title` joins the section titles, with no index; `nextLabel` is "Submit" and `go_next`
  refuses. Claude fills everything, then hands over;
- **one section per page**, with Next (`data-qa="applyFlowPaginationNextButton"`) and Previous, and Submit
  on the last: `step` has the section's title and "step 2 of 4" from the flow's hidden heading. From the
  page's own templates, not yet seen live.

**The job** (`FormSchema.job`, `jobInfo`): the title from the same hidden heading, "DSP Firmware Engineering
Co-op/Intern application, step 1 of 4" on the live page, the part before "application, step". Worded otherwise
(another language), nothing: never a guess.

The "Import your profile" pre-section (LinkedIn and Indeed import) holds no fields of ours and is left out.

## Extraction
- **Rows:** each visible innermost `.input-row` (an email row nests one). The phone row gives two fields:
  `phoneCountryCode` (a list) and `phoneNumber` (text). Agreement checkboxes outside rows (job alerts) and
  the attachment buttons are fields too.
- **Kinds:** `date` (a date row: month, day and year lists), `radio` (single-choice pills, or native radios),
  `checkbox-group` (multi-choice pills, which carry +/− icons), `dropdown` (a cx-select combobox), `checkbox`,
  `textarea`, `password`, `number`, `text`, `file`. Widgets the adapter can't drive yet (the multi-select
  dropdown used for preferred locations, Oracle JET comboboxes) are reported as `typeahead`, so Claude sees
  them, and filling one fails with "ask the user to fill it": typing into their text inputs doesn't choose
  anything, and treating them as text did.
- **Ids:** `<block slug>.<key>`, the key being the control's id without Knockout's render counter
  (`lastName-39` → `lastName`), which changes whenever the form re-renders. Screening questions are keyed by
  long numbers; for them the label's slug (first 40 characters) is used, as stable and readable. `#2`, `#3`
  for repeats.
- **Per field:** label (from the row's label, required star dropped), required (the label's required class,
  `aria-required` or `required`), current value, help text (the row's instructions), options of pills and
  radios, date parts, `multiple` (additional documents, multi-choice pills), the row's error, and a profile
  hint (`PROFILE_HINTS` by key; EEO questions by Oracle's standard codes, `…ORA_GENDER…` → `eeo.gender`).
  A read-only field (the email, from the sign-in) says so in its help text.
- **Never offered:** the email step's **honeypot**, a text field hidden from people (`input-row--invisible`,
  `aria-hidden`) that marks whoever fills it as a bot. Seen live.
- **Values:** text from the input; a list's from its input (it shows the chosen label); pills from
  `aria-pressed`; a date from its three lists (a month shown as "April" reads as `04`); files from the names
  shown.
- **Sections:** one per block, titled by it. Saved items (a language tile, a timeline entry) are sections of
  their own with no fields, `removable`: `languages.item-1` "Languages: French, Fluent",
  `work-and-education-history.experience-1`.
- **Add buttons:** Add Language / License / Experience / Education and Add Another Link, as
  `add.<what>` (`add.language`, `add.link`), with their block as `section`; and the **Save button of an open
  inline form** as `save.<block>` ([items](#repeatable-items)).
- **Page level:** errors (row validation, the pagination's message, alerts) and notices ("Uploading",
  "Done" and success messages from the upload buttons, and the "Saved" announced after an inline item is
  saved, go to `messages`; the live run listed "Saved" as an error), actions, `nextLabel`, `backLabel`,
  `tenant`. An alert region whose content is all hidden (a closed dialog's wrapper) is skipped.

## Filling
Every filler acts, waits, and reads back, like Workday's. `fill` handles the fields **in page order** (the
definition's `fill.order: "page"`),
whatever order they came in, and returns results in the order asked: the address lists depend on each other
(country → province → city → postal code), each loading its options for the choice above it. A
date's month, day and year lists are matched by values the adapter builds itself.

| Kind | Approach |
|---|---|
| text, number, textarea | Native setter + `input`/`change` (Knockout's `value` binding reads on change, `textInput` on input), then focus leaves. A read-only input is refused. A phone number the page reformats (`416-555-0100` shown as `(416) 555-0100`, live) counts when the digits are the same |
| dropdown (cx-select) | Focus and press the input (the widget opens and loads every option), else its arrow button, else React's handler; a list that still hasn't shown is searched anyway, and only if the search shows nothing either is it "Could not open the list" (live, a school list didn't show within the open waits twice, while `search_options`, which always types, found the school). An option matching the value (`matchOption`) is pressed; else the value is typed, and once the options change and one of them holds the value (or "no results" shows, not having shown before; [searching](#searching-a-list)) the match is pressed; failing that, the value's part before its first comma is typed (the postal-code search finds "K2K 3E9" but not the full label "K2K 3E9, Kanata, Ontario"). The read-back is what the input shows after focus leaves, which may be the start of the option's label: the city option "Kanata, Ontario" shows "Kanata" once chosen. Leaving the input also puts back typed text the list didn't take, so what shows then is the choice, not the query. Nothing matches: the list is closed and the options are returned; the widget puts its old value back when focus leaves. An auto-suggest field keeps typed text |
| radio (pills) | Press the matching pill unless already pressed: a pressed single-choice pill unselects itself when pressed again |
| radio (native) | Press the input (Knockout's `checked` binding reads it on click), else its label |
| checkbox-group (pills) | Press each pill whose state must change |
| checkbox | Press the input |
| date | Each part is a list: month by name ("April", "Apr") or number, day with or without a leading zero, year |
| file | Only via `upload`: a `File` in a `DataTransfer` set on the input + `input`/`change`, else a drop on the upload button; confirmed only by a **newly shown** file of that name |

**The cx-select traps.** Escape on a **closed** list clears the field's value, so Escape is sent only
while the list is open. The widget searches only while its input has focus, so the adapter focuses it before
typing. Another list left open is closed before opening one. All three are from the widget's own code in
the page bundle. And from the live run: choosing a province re-renders the city list, replacing its input, so
the adapter looks the input up again by id whenever the one it holds has left the page; typing into the old
one had searched nothing.

### Searching a list
`typeQuery` types the value and waits (up to `typeaheadResultsMs`) for options that differ from those before
and of which one holds the value, case, spacing and punctuation aside (`answersQuery` in `engine/dom.ts`), or for
"no results" when it wasn't already showing (a list still loading shows it too). If none come it clears the
text, waits `typeaheadClearMs` (1 s), types the value again and waits once more (trace branch
`typeahead search again`).

**Why** (2026-10-06, a city and a postal code on a live tenant, both failing at every attempt): the address
lists open on "no results" while their first page loads. Typing re-renders the whole unfiltered list at once
(500 postal codes from `A0A`), and the server search runs about half a second later. The old wait took that
re-render for the results (the options differed from the empty list before), matched nothing and closed the
list, which dropped the search. The widget searches only when its text changes and keeps the last text typed
after the list closes, so every later fill or `search_options` with the same value searched nothing (no request
at all in 4 s) and read the unfiltered list again; a shorter query (a code's first half) did search. Requiring
the value in the results makes the first attempt wait for the search; clearing and typing again makes the
widget search a text it already holds. The clear's wait must outlast the widget's own delay before it searches,
which is why it's a wait of its own. Results that don't hold the value (a search matching on something else) cost
both waits before they're read, about 9 s.

**Stale errors.** A list's "required" error stays a moment after it's filled, until the page validates
again. After a batch, fields that were filled but still show an error get up to `afterFieldMaxMs` for it
to clear before the result says "Filled, but the page reports: …" (the live run reported three such errors
that the next read no longer showed).

**Attachments.** The resume and cover letter buttons hold one file each: while one is shown, the file input
is gone, so an upload fails with "remove it with remove_items first" (a resume from the candidate's profile
is the usual case). Additional documents take several, listed below their button.

**Removing** (`remove`): files by their Remove button (confirming a delete/remove dialog if one appears);
multi-choice pills by unpressing them. Other kinds say to use `fill_fields`.

## Repeatable items
Work and education (a timeline), languages and licenses (tiles) are added through an inline form:
1. `addRepeatable("add.language")` presses the add button and waits for more rows (the form's fields).
2. Claude fills them.
3. `addRepeatable("save.languages")` presses the form's Save (`data-qa` `profileItemInlineSaveButton` or
   `addTimelineItemDialogButton`) and succeeds once the form closes. When the page shows a validation error
   in the block instead, it returns `ok: false` with the page's errors.

Add Another Link adds a link row directly. `removeRepeatable(sectionId)` deletes a saved item: a tile by its
delete button; a timeline entry by the delete button it shows only while hovered (the adapter hovers it
first), after which the page removes it a second later. Done once there are fewer saved items.

Adding one education and two work entries through the inline form and Save **worked live**.
Languages and licenses (tiles) and the deletes are still unverified live. An empty block shows no fields,
only its add button, so the `ezapply-apply` skill has Claude match every add button's section to the
profile (the live run skipped the user's languages and certification).

## Moving and page actions
- `next()`: refuses on `confirmation` and `auth` (the email step is the user's), with no Next button, and
  whenever the forward button is Submit ("every section is filled on this page. The user reviews it and
  presses Submit"). Otherwise presses Next and waits (up to `stepMs`) for the URL or the step to change, or for
  new errors. `advanced` = the step or page kind changed.
- `back()`: presses Previous; refused on the first section and after submitting.
- `pageAction`: `apply` (Apply / Apply Now, only outside the flow) and `use_last_application` (Use My
  Profile). `apply_manually` and `autofill_with_resume` don't exist here.

## Never submitting
`isSubmitControl`: the pagination's submit button (`.apply-flow-pagination__submit-button`) or a control
reading "Submit" / "Submit Application". Fill, remove, add and page-action calls refuse to touch one, `next`
never presses one, and the submit guard (`engine/guard.ts`, installed once per document) cancels any
untrusted event aimed at one. The email step's Next is not a submit control.

## Waits
Oracle's registry entry holds the standard waits, and `autofill-timing.yaml` changes them for Oracle under
`oracle:` ([waits owned by the site](adapters.md#waits-owned-by-the-site),
[Workday's waits](workday-adapter.md#waits-autofill-timingyaml)). They're the same named waits as Workday's:
`dropdown*` for the lists, `typeahead*Results*` for a list's search, `typeaheadClearMs` (Oracle's alone) before
typing a search again, `checkMs` for pills, radios and checkboxes, `date*`, `upload*`, `remove*`, `addRowMs` / `removeRow*` / `row*` for items and Save, `step*`,
`pageAction*`, `afterField*`.

## What was verified, and how
- **Live, headless** (a Playwright recon script used while building the adapter and since removed, on an
  employer's own domain): the job page (`posting`, Apply,
  tenant), Apply → the email step (`auth`, fields email and terms, honeypot left out). Snapshots in
  `test/fixtures/live/oracle-posting.html` and `oracle-email.html`, employer details replaced.
- **A saved application** (the user's browser, that employer's single-page flow, before filling):
  `oracle-apply.html` (employer details and personal data replaced), all 46 fields with kinds, ids, hints and options, Submit as the only button.
- **Behaviour** against `test/oracle-fixture.ts`, a model of the widgets built from that page and the
  bundle's templates: every filler, dependent lists, the Escape trap, uploads and removals, inline forms and
  Save, tiles and timeline deletes, the multi-page flow, the guard. The companion's e2e tests run the real
  adapter on it too.
- **The first live application** (the same job, filled to Submit): text fields, pills,
  native radios, dates, lists (Degree matched "Bachelor" to "Bachelor’s degree"), the resume and additional
  document uploads, and education and work entries with Save all worked. What failed, all fixed and now
  reproduced by the fixture (each test fails on the old logic): City and Postal Code reported "Selection did
  not stick" though chosen (the field shows less than the option's label), the first City attempt typed into
  an input the province had replaced, the postal-code search by full label found nothing, the reformatted
  phone number, stale "required" errors, and "Saved" as an error. The **Cover Letter** upload field didn't
  appear in `get_form` on the live page, though the page the user saved earlier has one; why is unknown
  (Claude put the cover letter under Additional Documents). Next time, a saved copy of the page will tell.
- **On the engine, live** (2026-10-06, another employer's single-page flow): City and
  Postal Code failed at every attempt, the search problem [above](#searching-a-list), and the school list twice
  with "Could not open the list". Both fixed and reproduced by the fixture's `liveSearch` postal list (its tests
  fail on the old logic), not yet run live.
- **Not yet live:** language and license tiles, deletes, the multi-page flow, confirmation detection.

## Limits
- **English button texts.** Apply, Use My Profile, Next, Previous, Submit and the confirmation wording are
  matched in English (`TEXT` in `selectors.ts`); the class hooks work in any language, and Submit is also
  known by its class.
- **No `filled` status.** Oracle has no review page, which is what moves a posting to `filled`.
- **Unsupported widgets** are shown as `typeahead` and left to the user (above).

## Updating for Oracle changes
Change `selectors.ts` (every Oracle string of the adapter), add a snapshot the user saves from the browser (or one exported from a debug-mode run:
`ezapply debug export`, [the loop](../development.md#debugging-a-live-run-debug-mode)), and extend `oracle-live.test.ts` and the fixture.
