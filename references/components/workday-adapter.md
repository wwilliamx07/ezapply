# Workday adapter (`packages/extension/src/adapters/sites/workday/`)

Reads a Workday application page into a [`FormSchema`](protocol.md#form-schema) and fills it, one step at
a time, for Claude. Workday is a site definition on the [adapter engine](adapters.md), with drivers of its own
for its widgets. Built into `workday-main.js` and injected into the page's **MAIN world**, because some
Workday widgets are React components that only respond to React's own handlers, which isolated-world
content scripts can't reach.

| File | Role |
|---|---|
| `site.ts` | The definition: page rules, the step key (index and title), repeat rules, the waits (with the wait for a new step's fields), messages |
| `main.ts` | Bundle entry: `install(workday)`, which defines `window.__ezapply_workday` ([engine](adapters.md#the-api-apits)) |
| `page.ts` | Page detection, fields (`workdayFields`), rows (`workdayRows`), add buttons (`workdayAddButtons`), step info, errors and notices, page actions, `isSubmitControl`, `nextButton`, `backButton`, and the value readers the drivers use |
| `fill.ts` | One filler per field kind, option listing and search, uploads, removals |
| `widgets.ts` | `WORKDAY_WIDGETS`: the fillers and readers of `fill.ts` and `page.ts` as drivers, in the order a field's kind is decided |
| `selectors.ts` | **Every Workday-specific string of the adapter**: `data-automation-id` hooks (several candidates each, since tenants and releases vary) and `PROFILE_HINTS`. The posting-page hooks the companion reads too, the Workday hosts and tenant parsing come from `@ezapply/protocol/workday` ([protocol](protocol.md)) |

The engine (`adapters/engine/`) does the rest, the same for every site: the API, ids and sections, the fill
loop, next and back, the submit guard, the waits, and the DOM helpers (`dom.ts`: visibility, which in jsdom means
`hidden`, `aria-hidden` or an inline `display: none` up the tree; pointer and keyboard sequences; `typeChar`;
`settle`; `waitFor`; `matchOption`; `parseDate`) ([adapters](adapters.md)). When the adapter moved onto it,
its fillers and readers moved unchanged and the golden schemas stayed equal. It has run live twice since
([status](../status.md#the-first-workday-run-on-the-engine)).

The extension knows a Workday page by its body ([telling a page's site](extension.md#telling-a-pages-site-framests)):
the registry's signature is Workday's UI widgets (`[data-uxi-widget-type]`) and the chrome every candidate page has
(`data-automation-id` `utilityButtonBar`, `accessibilitySkipToMainContent`), checked on every saved Workday page.
Its hosts (`*.myworkdayjobs.com`, `*.myworkdaysite.com`, `isWorkdayUrl`) decide where no page can be read.

## API (`window.__ezapply_workday`)
The engine's ([adapters](adapters.md#the-api-apits)): `getForm()`, `listOptions(fieldId)`, `searchOptions(fieldId, query)`, `fill(fills)`, `upload(fieldId, file)`,
`remove(fieldId, values?)`, `addRepeatable(addButtonId)`, `removeRepeatable(sectionId)`, `next()`, `back()`,
`pageAction(action)`, `blockedSubmitAttempts()`, `setTiming(timing)` (the background calls it before every
method). The field registry from the last extraction is kept; a
lookup whose element went stale re-extracts, and an unknown id fails with "call get_form again".

## Page detection (`detectPage`), in order
1. **confirmation:** a confirmation element, or (no progress bar, no fields) "application submitted" /
   "thank you for applying" text.
2. **auth:** a visible password input, an active step named "sign in"/"create account", or sign-in /
   create-account content. (The sign-in page is step 1 of the flow, so it has a progress bar.)
3. **start-choice:** Apply Manually or Autofill with Resume present.
4. With a progress bar: **review** if the forward button reads Submit or the active step is Review, else
   **step**.
5. **step** if any fields, **posting** if a posting header or Apply button, else **unknown**.

Posting, start-choice and sign-in detection are verified against live snapshots
(`test/fixtures/live/`); later steps against a behavioural fixture.

## Extraction
- **The job** (`FormSchema.job`): the title in `jobTitleHeading`, over every application step and the sign-in
  page (seen live on a My Experience step and a sign-in page). It's how the companion
  tells two applications apart where the URL doesn't ([which posting](../mcp-tools.md#forms)).
- **Fields:** each visible `[data-automation-id^="formField-"]` container that isn't nested in another.
  Kind, from the widgets inside: `file` (drop zone or file input), `date` (Month/Year inputs), `typeahead`
  (multi-select container), `dropdown` (listbox button), `radio`, `checkbox-group` (2+ boxes), `checkbox`,
  `textarea`, `password`, `number`, `text`.
- **Ids:** `<section slug>.<automation id without formField->` (or the label slug, also when the automation
  id is a bare `formField-`, as on a live Resume/CV field that came out as `resume-cv.`), `#2`, `#3` for
  repeats, so work-history rows stay distinct.
- **Per field:** label (required markers stripped), required, current value, help text, known options,
  `optionsLazy` for dropdowns and typeaheads, date parts, `multiple`, the field's error (notices excluded,
  below), and a `hint.profileKey` when the automation id is in `PROFILE_HINTS` (e.g. `legalNameFirstName` →
  `identity.firstName`). Hints are suggestions; Claude decides. A date's current value is what its parts
  hold for the page ([dates](#dates-typed-into-workdays-split-widget)), not the inputs' text.
- **Page level:** sections, add buttons, step title/index/total from the progress bar, page errors (visible
  alerts), notices (`messages`), page actions, the forward button's label, the Back button's label
  (`backLabel`, when there is one), and the tenant (`workdayTenant`: the
  host's first label on myworkdayjobs.com, the segment after `recruiting` on myworkdaysite.com, where the
  host's first label is just `wd5`).
- **Add buttons** are named after the section they sit under: `{ id: "add.work-experience", label,
  section: "Work Experience" }`. The section is the last heading (`h1`–`h5`, `legend`, `role="heading"`)
  before the button, outside fields and the progress bar, with a row number dropped ("Work Experience 2");
  none when that heading is the step's title, and then the id comes from the label. Live Workday labels
  every add button "Add", or "Add Another" once a row exists, so ids from labels (`add.add`, `add.add#2`…)
  said nothing and renumbered after each add.
- **Errors and notices:** alerts (`errorMessage`, `errorBanner`, `inputAlert`, `role="alert"`) are errors,
  except notices (`isNotice`: the text says "success"/"successfully" and nothing like fail, error, could not,
  invalid or required), which go to `messages`. Live Workday announces "resume.pdf successfully uploaded" in
  the same alert region; as an error it showed up in `go_next` and as the file field's error, and ended
  `next()`'s wait before the page had moved.
- **Removable rows:** a section is `removable` when its first field sits in a row that has its own delete
  button (`rowDelete`) outside any field, in an ancestor holding no other section's fields. Live
  that button is a plain `<button>` reading "Delete" with a trash icon (`.wd-icon-trash`), beside
  the row's heading in a `role="group"` labelled by it, with no automation id or aria-label, so it's found by
  the icon (`button:has(.wd-icon-trash)`). The other hooks (`panel-set-delete-button`, `deleteButton`, a button
  labelled "Delete…") were guesses that matched nothing there and are kept as fallbacks. The first condition keeps a file's delete button
  from counting; the second keeps a page-wide button from making every section removable.

## Filling
Every filler follows **act → wait for the DOM to settle → read the value back → `{ ok, readBack, error }`**.
Real DOM events are tried first (native value setter, full pointer+mouse sequence, keyboard); calling React
props directly is only a fallback when the DOM route didn't take, and never on buttons: it would bypass
the DOM listeners the submit guard relies on.

| Kind | Approach |
|---|---|
| text, number, textarea | Native prototype setter + `input`/`change`, blur; fallback: React `onChange`/`onBlur` |
| password | Refused: the user types passwords |
| dropdown | Open the listbox (a portal under `body`; [finding it](#finding-a-dropdowns-listbox)), pick the best match, check the button label; fallback: React `onClick` on the option. No match → `availableOptions`. Closing waits until the listbox has gone |
| typeahead | Per value: type the query, wait for its results ([searching](#typeahead-searches-and-lists)) and pick the match; a value like `"Job Board > LinkedIn"` walks nested menus; already-selected values are skipped; chips are read back. Each value is matched on its own: one that matches nothing goes to `unmatched` with the options its search showed and the rest are still selected; one where Workday selected an option itself (single-select prompts select on Enter) goes to `inexact`. `ok` is false while anything is unmatched |
| radio, checkbox, checkbox-group | Click the label or input; check `checked`/`aria-checked` |
| date | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (also `MM/YYYY`, `MM/DD/YYYY`), typed into the Month/Day/Year parts present ([dates](#dates-typed-into-workdays-split-widget)); errors if the form needs a part not given. Read back from what the parts hold for the page; a mismatch fails with "the page didn't take the date … ask the user to type it" |
| file | Only via `upload`: a `File` in a `DataTransfer` set on the input + `input`/`change`; else a drop on the drop zone; confirmed only by a **newly shown** file whose name matches, so a same-named file left from a previous application doesn't pass |

**After a batch** the page is re-read, and a validation error on a field that was filled is added to its
result as "Filled, but the page reports: …" (`ok` stays true).

**Option matching** (`matchOption`, whitespace-normalized and case-insensitive): exact; then the label
without a trailing parenthetical, or the parenthetical itself ("Python" → "Python (Programming Language)",
"SQL" → "Structured Query Language (SQL)"); then a prefix either way; then a substring. Each rule after the
exact one must single out one **label** (a label listed twice counts once: live Workday listed every
typeahead option twice, which made unique matches look ambiguous); otherwise no match, never a guess between
several. A work-eligibility question with "Yes, I am a citizen…" and "Yes, I possess a temporary work
permit" doesn't match "Yes", by design. The bare-name and parenthetical rules and counting labels once
worked live: 12 of 15 skills given as plain names ("Java", "SQL", "AWS") were selected under Workday's own
names.

**Strict fills.** A fill sent with `strict: true` (`autofill_step` sends every fill so, except a city or postal
code: [autofill](autofill.md#strict-matching)) matches dropdown, radio, checkbox-group and typeahead options
only by `strictIndex` (`protocol/src/match.ts`): the option, its bare name or parenthetical, or the option
without a leading rank ("5 - Fluent" for "Fluent"); never a prefix or substring. A dropdown miss fails with
`No option matches "…" exactly.` and the options; a typeahead miss is `unmatched` with its search's options. A
single-select prompt that selects an option itself on Enter still does: that's `inexact`. Not yet run live.

### Finding a dropdown's listbox
Live Workday gives the dropdown button no usable `aria-controls`, and a closed listbox stays on screen for a
moment while it animates away. The adapter used to take the first visible `[role="listbox"]`, so right
after one dropdown it read the previous one's options. In the first real application that happened on the
first attempt at almost every dropdown (`list_options` and `fill_fields` alike), and each retry cost a turn.
Now:
- Only listboxes outside any `formField-` container count (portals live under `body`; a list of selected
  items inside a field isn't one).
- Before opening, wait (up to 1 s) for no such listbox to be visible, pressing Escape on any still there.
- After the press, accept `aria-controls`' target when it exists, or else a listbox that wasn't visible
  before the press, or one that was but whose options changed (a reused portal).
- When no listbox appears after the press, React's `onClick` is tried.
- When that fails too, the adapter waits for the page to go quiet (`afterFieldQuietMs`/`afterFieldMaxMs`)
  and opens the dropdown once more from the start, for `list_options` and `fill_fields` alike.
- **Closing.** After a choice the list closes by itself; the adapter waits (up to 1 s,
  `dropdownClosedMs`) until it's hidden or removed, pressing Escape and then the button only while the button
  says `aria-expanded="true"`. When nothing was chosen (`list_options`, or a value that matched nothing) the
  list has to be closed: Escape on the button, and if the button has no `aria-expanded` and the list is still
  there after `dropdownEscapeCloseMs` (300 ms), a press on the dropdown's own button, as a person would. A
  button without `aria-expanded` is never pressed after a choice: a list still animating away would open
  again.

**Why the press.** "Could not open the dropdown" followed a miss in the second live run, and in the fifth it
failed 9 fields (each waiting out 1 s + 0.5 s + 2 s + 2 s): the first dropdown after `list_options` had read
that step's dropdowns, five after a value that matched nothing (in one call), the first dropdown of two later
calls, and one mid-call after a successful dropdown. Live buttons have no `aria-expanded` and Escape doesn't
close a live listbox, so the close did nothing when nothing was chosen, the list stayed open, and the next
dropdown's press only closed it. The press covers the first two patterns; the other three failures aren't
explained, and the fix is unverified on a live tenant. (An earlier, broader fix that also clicked the page
body and pressed again when opening was reverted: unverified, and fills had become much slower.)

**Why the second attempt.** Two runs on one tenant (with the press above) failed 12 dropdowns with
"Could not open the dropdown". Every one was a dropdown whose own list had been read without a choice
earlier (by `list_options`, or by a value that matched nothing), and every such dropdown failed its next
open; no other dropdown failed. The agent's next call filled all 12 at the first try, at a turn each. Why the
first open fails isn't known (the page wasn't captured), so the adapter does what worked: it tries again
itself. A dropdown that can't be opened at all now costs its open waits twice.

The fixture models the live behaviour: the portal lingers 150 ms, and Degree Level's button has no
`aria-controls`. With `liveDropdowns`, buttons have no `aria-expanded`, Escape closes nothing, and a press
outside an open list (its own button included) only closes it. Its tests (the next dropdown after a miss,
after `list_options`, and no reopening after a choice) fail on the old logic, the first two with "Could not
open the dropdown". `dismissedIgnoresNextPress` adds those runs' symptom: a dropdown whose list was closed
without a choice ignores the next press on its button. Filling it after `list_options` or after a miss fails
without the second attempt.

### Typeahead searches and lists
- **Waiting for results.** Typing a query waits until the options on screen differ from those before it
  (checked every 100 ms, up to 4 s, then once more after React's Enter handler), or until "No Items." has
  stayed for 2 s (a search that found nothing; it also shows briefly while results load). Reading once the
  DOM went quiet, as before, returned the previous query's results in the second live run: each
  `search_options` call got the one before's, and the first got none. (Calls on one tab were already one at a
  time in the companion, so this was timing, not overlap.)
- **Each option once.** Both option hooks (`promptOption`, `promptLeafNode`) match one live option, one inside
  the other; the innermost is kept (a press on it reaches the outer one's handlers). `search_options` and
  `list_options` also list each label once, and "No Items." is never an option.

### Dates typed into Workday's split widget
In the second live run, every multi-part date (work From/To as MM/YYYY, a graduation date as MM/DD/YYYY)
read back right while Workday still called it empty, however often it was filled: the user typed five dates
by hand. The adapter used to set each part's input value (native setter plus `input`/`change`); Workday's
parts keep their value in their own state, which that didn't reach. A one-part `YYYY` date worked.

Now each part is entered like a person would: press the part (its display element when there is one),
focus it, and type the digits with `typeChar` (keydown and keypress; then, unless the page handled the key,
`beforeinput`, the character inserted, `input`; keyup); a browser-style `change` follows when the value
changed. Only if the part still doesn't hold the value is it set directly, as before. **What a part holds**
(`datePartValue`) is read from the display element next to its input (`[data-automation-id$="-display"]`)
when there is one, else `aria-valuenow`, else the input's value, so a value the widget didn't take reads as
empty in both the fill result and `get_form`. When the field still shows an error after the parts are
entered, they're entered once more (the first live run saw a date accepted on the second entry). A date whose
parts don't read back the value fails with the value for the user to type. One whose parts read back right
while the field still shows an error stays `ok: true`, with "Filled, but the page reports: …".

Typing worked on a live tenant: in the third and fourth runs four `MM/YYYY` dates and two `YYYY` dates were
taken and the step advanced. The read-back hook is the display element: on the saved My Experience step each part
is a `dateSectionMonth-input` / `dateSectionYear-input` with a `…-display` beside it showing the padded value
("06") while the input holds "6". The fixture's `dateWidget: "keys"` models parts that take digits only in keydown (typing
works; the old setter didn't), and `"stuck"` parts that ignore synthetic keys (the fill fails honestly and
`get_form` shows the date empty).

**Failing again, cause unknown** (the first Workday run on the engine). All five multi-part dates (four `MM/YYYY` work
dates, one `MM/DD/YYYY` graduation date) read back the digits while Workday called them required, however often
they were filled, and the user retyped them. Two `YYYY` dates were taken. The date code is the one that worked in
the third and fourth runs. The browser was in front, by the user's account. A change was tried and dropped the
same day: date parts sent focus events by hand when the page has no focus (Chrome holds them back while the
window is behind another app). With the browser in front it would have done nothing. `tab.show` now reports
`focused` and debug mode records it, so focus can be ruled in or out from the records rather than from
memory. What the records can't show is which path each part took (typed, or set directly as a last resort).
That needs the adapter trace (`todo.md`, "Autofill debug mode").

The next run (another posting at the same employer, the same day) kept the browser in front, and every call recorded
`focused: true`. Every date was taken the first time: four `MM/YYYY`, two `YYYY` and the `MM/DD/YYYY`
graduation date, and each step advanced on the first Save and Continue. So focus is the leading suspect after
all: the first run has no `focused` record to compare, and the user's account of it was "pretty sure".
So calls that change the page now bring the browser window to the front (`forms.focusBrowser`, on by
default; [the tab in front](../mcp-tools.md#forms)). Not yet proven: a run with the option off and the terminal in
front, compared with one with it on ([status](../status.md)).

`addRepeatable` presses the add button and waits for more field containers. `pageAction` presses Apply,
Apply Manually, Autofill with Resume or Use My Last Application.

**Going forward** (`next()`): presses the forward button and waits (up to 12 s) until the step changes (its
index or title) or a validation error shows. `advanced` is true when the step index, title or page kind
changed. Live step titles are often all "Application", so comparing titles alone reported `advanced: false`
on every move of the second live run, and waited the full 12 s on two of them; the next runs reported every
move. Notices go to `messages`, not `errors`. Returns
`{ advanced, pageKind, step?, errors, messages?, refusedReason? }`.

**Waiting for the new step's fields** (the definition's `afterStep` wait, after `next()` and `back()` see a move): up to
`stepFieldsMs` (3 s) for the step to show at least one field, checked every 150 ms, then the usual quiet
wait. Workday moves the progress bar before it renders the step: in two runs on one tenant a `get_form` straight after
`go_next` read an empty step (no sections) four times, and one or two seconds later the questions were there.
A re-check with `onlyEmpty` in that moment looks like a step with nothing left to fill, which the agent took
as "my answers were kept" three times. The wait ends as soon as a field shows, so it costs its full length
only on a step without fields. The review page has none, so it isn't waited for. The fixture's
`questionsStepRenderMs` puts a step between the first and review whose field renders later; `get_form` after
`next()` fails to see it without the wait.

**Going back** (`back()`): presses the footer's Back button (`backButton`: `bottom-navigation-previous-button`,
`pageFooterBackButton`, `wd-CommandButton_back`, else a visible button reading Back or Previous) and waits for
the step title to change. It's allowed from any step with a Back button, including review (to correct an
answer before the user submits), refused on the first step and on the confirmation page, and never presses
a submit control. A move is seen as in `next()` (index, title or page kind), then it waits for the step's
fields. It used to wait for the title alone: on a tenant whose steps are all "Application", each of
five Backs waited out the 12 s and said `moved: false` although the step had changed. Returns
`{ moved, pageKind, step?, errors, refusedReason? }`. What Workday keeps of
unsaved entries on the step being left isn't verified; the skill re-checks steps when coming forward. Back
worked on a live tenant in those two runs (five presses, from the review page and between steps; which hook
matched wasn't recorded). From the review page it went to step 5 once and to step 1 once, unexplained. The
fixture's review page has a Back that returns to the step with its entries.

**Removing a row** (`removeRepeatable(sectionId)`): "Use My Last Application" pre-fills work experience,
education and website rows, and when Workday holds more rows than the profile, adding alone can't fix it.
The method re-extracts, presses the row's delete button, confirms a delete/remove dialog if one appears
(the same `confirmRemoval` as attachments), and succeeds once the page has fewer field containers (a row
element may be re-rendered, so its disappearance alone proves nothing). Returns
`{ sectionId, ok, removed?, error? }`; an id that isn't a removable section fails with "call get_form".
Workday renumbers the rows after it, so their field ids change. The delete button is found as on the live page
(above); whether pressing it asks for confirmation live isn't known, and a dialog is confirmed if one appears.

**Attached files** (`attachedFiles` in `page.ts`) are listed once each: the `file-upload-item-name` elements
with their row (`file-upload-item` / `file-upload-successful`), or the rows themselves when a tenant has no
name element. A row and its name both match the file hooks, so reading them naively listed every file twice.

## Waits (`autofill-timing.yaml`)
Every wait the adapter makes (about 46: after each field, opening and closing a dropdown, a typeahead's
search, typing a date, uploads, rows, steps) is a named value in `T` (`engine/timing.ts`), with a line on what
it's for in `TIMING_DOCS` (`protocol/src/timing.ts`). Workday's values are its registry entry's waits: the
standard ones (`STANDARD_WAITS`), which were measured here
([waits owned by the site](adapters.md#waits-owned-by-the-site)). The companion reads the user's
`autofill-timing.yaml` for every form call ([format](../data-formats.md#autofill-timingyaml-companionsrcformstimingts)): its top-level keys
and those under `workday:`. It resolves them against Workday's waits (`scale` multiplies the waits it leaves
unset; a wait it sets is used as written) and sends the result as the call's `timing`; the background calls
`setTiming` before the method, so an edit applies to the next call. No `timing` (an older companion) or `null`
restores Workday's own, since `T` lives on in the page between calls. Of the poll intervals only
`waitFor`'s default is configurable (`pollMs`); the waits with their own interval (typeahead results
100 ms, uploads 200/250 ms, steps 150 ms) keep it.

**Why:** the fourth live run completed but slowly: dropdowns about 2.5–3 s each, a 15-dropdown step 49 s.
Most waits end as soon as their condition holds, but some cost their full length on every field when the
page never goes quiet or a check never matches (the settle after each field, a dropdown's closed and selected
checks). Which ones isn't measured yet; the file lets the user shorten them and see what breaks.

**Defaults from the user's file.** The user set six dropdown waits to 200 ms
(`dropdownOthersClosedMs`, `dropdownOpenMs`, `dropdownOpenRetryMs`, `dropdownSelectMs`,
`dropdownSelectRetryMs`, `dropdownClosedMs`; they were 1000–2000), and four live applications
ran with them in one day (two on Workday, two on Oracle): 128 fills, no "Could not open
the dropdown", the only failures "No option matches". Those values are now the defaults.

## Removing values and attachments (`remove`)
Workday pre-fills from the candidate's last application, so a Skills multi-select or a Cover Letter field can
hold another job's entries. `remove(fieldId, values?)` works on `typeahead` (multi-select) and `file`
fields; other kinds fail with "use fill_fields". `values` are matched with `matchOption` against what the
field holds (pill labels, from `promptSelectionLabel` when present, or file names); without `values` it
removes everything. For each item:
1. Press its remove control: `DELETE_charm` (or a button labelled delete/remove) on a pill; `delete-file`
   (or a delete/remove button) in a file row.
2. If it's still there, confirm a visible dialog that mentions delete/remove by pressing its
   Delete/Remove/Yes/OK button (never a submit control).
3. Then React's `onClick` on the control, then the keyboard: focus the pill and send Delete, then Backspace.

Each removal is confirmed by the item count dropping. Returns `{ ok, removed, remaining, notFound?, error? }`.
The remove-control hooks are best knowledge of Workday's markup and haven't been seen on a live tenant yet
(they sit behind sign-in); the behavioural fixture has pills with charms, a pill removable only by keyboard,
a file whose delete asks for confirmation, and work-history rows whose Delete asks for confirmation and
renumbers the rest.

## Never submitting
- `next()` refuses on `review` and `confirmation` pages, and whenever the forward button is a submit
  control, returning `refusedReason`.
- `isSubmitControl`: a control whose text or label is "Submit" / "Submit Application", or the footer/next
  button while the active step is Review (whatever its label). Fill, remove, add and page-action calls refuse to
  touch such a control.
- **Submit guard** (`installSubmitGuard`, installed once per document): capture-phase listeners for click,
  mouse and pointer down/up, Enter/Space keys and `submit` cancel any **untrusted** (script-generated)
  event aimed at a submit control, and record it (`blockedSubmitAttempts`). Real user clicks are trusted
  and always go through.
- There is no general click or script tool in the MCP surface.

## Updating for Workday changes
Change `selectors.ts` (keep every Workday string of the adapter there; what every site shares is in
`adapters/engine/` and `adapters/widgets/`; posting-page hooks and hosts shared
with the companion are in `protocol/src/workday.ts`), add a snapshot to `test/fixtures/live/` (saved
from the browser, or once it exists exported from autofill debug mode: `todo.md`, "Autofill debug mode"), and extend the tests. The behavioural fixture
(`test/workday-fixture.ts`) is the one model of a Workday step: the adapter tests use it in a jsdom
environment, and the companion's e2e tests run the real adapter on it behind a fake extension, so a new
adapter method needs one fixture behaviour, not two fakes.
