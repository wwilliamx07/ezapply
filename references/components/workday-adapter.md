# Workday adapter (`packages/extension/src/adapters/workday/`)

Reads a Workday application page into a [`FormSchema`](protocol.md#form-schema) and fills it, one step at
a time, for Claude. Built into `workday-main.js` and injected into the page's **MAIN world**, because some
Workday widgets are React components that only respond to React's own handlers, which isolated-world
content scripts can't reach.

| File | Role |
|---|---|
| `main.ts` | Bundle entry: defines `window.__ezapplyWorkday` (non-enumerable) unless the same `ADAPTER_VERSION` is already there. The build stamps it with a hash of the bundle ([extension builds](extension.md#builds-npm-run-build--w-ezapplyextension)); unbundled, in tests, it's `"dev"` |
| `api.ts` | `createWorkdayApi(doc, getUrl)`: the methods the background calls, plus `installSubmitGuard` |
| `extract.ts` | Page detection, field extraction, step info, errors, page actions, `isSubmitControl`, `nextButton` |
| `fill.ts` | One filler per field kind, option listing and search, uploads |
| `dom.ts` | DOM helpers: text normalization, visibility, native value setter, pointer/keyboard sequences, `typeChar` (one typed character), `settle`, `waitFor`, `matchOption`, React prop access, `win(node)` |
| `selectors.ts` | **Every Workday-specific string of the adapter**: `data-automation-id` hooks (several candidates each, since tenants and releases vary) and `PROFILE_HINTS`. The posting-page hooks the companion reads too, the Workday hosts and tenant parsing come from `@ezapply/protocol/workday` ([protocol](protocol.md)) |

**No globals.** Event, observer, `File`, `DataTransfer` and element-prototype constructors come from the
element's own window (`win(node)`), never from globals. The adapter behaves the same in the page, in a jsdom
test environment, and in a jsdom window created inside a Node test, which is how the companion's e2e tests
drive it.

## API (`window.__ezapplyWorkday`)
`getForm()`, `listOptions(fieldId)`, `searchOptions(fieldId, query)`, `fill(fills)`, `upload(fieldId, file)`,
`remove(fieldId, values?)`, `addRepeatable(addButtonId)`, `removeRepeatable(sectionId)`, `next()`, `back()`,
`pageAction(action)`, `blockedSubmitAttempts()`. The field registry from the last extraction is kept; a
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
  button (`rowDelete`: `panel-set-delete-button`, `deleteButton`, or a button labelled "Delete…") outside any
  field, in an ancestor holding no other section's fields. The first condition keeps a file's delete button
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
| dropdown | Open the listbox (a portal under `body`; [finding it](#finding-a-dropdowns-listbox)), pick the best match, check the button label; fallback: React `onClick` on the option. No match → `availableOptions` (each label once). Closing makes sure the listbox has gone |
| typeahead | Per value: type the query, wait for its results ([searching](#typeahead-searches-and-lists)) and pick the match; a value like `"Job Board > LinkedIn"` walks nested menus; already-selected values are skipped; chips are read back. Each value is matched on its own: one that matches nothing goes to `unmatched` with the options its search showed and the rest are still selected; one where Workday selected an option itself (single-select prompts select on Enter) goes to `inexact`. `ok` is false while anything is unmatched |
| radio, checkbox, checkbox-group | Click the label or input; check `checked`/`aria-checked` |
| date | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (also `MM/YYYY`, `MM/DD/YYYY`), typed into the Month/Day/Year parts present ([dates](#dates-typed-into-workdays-split-widget)); errors if the form needs a part not given. Read back from what the parts hold for the page; a mismatch fails with "the page didn't take the date … ask the user to type it" |
| file | Only via `upload`: a `File` in a `DataTransfer` set on the input + `input`/`change`; else a drop on the drop zone; confirmed only by a **newly shown** file whose name matches, so a same-named file left from a previous application doesn't pass |

**Honest results.** After a batch the page is re-read, and a field that still shows an error is `ok: false`
with "The page still reports: …", whatever it reads back. Before, the result was `ok: true` with a
"Filled, but…" note, and in the first live run the agent trusted it and found out only at `go_next`.

**Option matching** (`matchOption`, whitespace-normalized and case-insensitive): exact; then the label
without a trailing parenthetical, or the parenthetical itself ("Python" → "Python (Programming Language)",
"SQL" → "Structured Query Language (SQL)"); then a prefix either way; then a substring. Each rule after the
exact one must single out one **label** (a label listed twice counts once: live Workday listed every
typeahead option twice, which made unique matches look ambiguous); otherwise no match, never a guess between
several. A work-eligibility question with "Yes, I am a citizen…" and "Yes, I possess a temporary work
permit" doesn't match "Yes", by design. **Decline:** `"decline"` (the profile's EEO value) or any
decline-worded value ("I prefer not to respond") first looks for the one option worded as a decline ("prefer
not", "do not wish", "decline", "choose not", "rather not", "not to say/disclose/answer"), since each form
words it differently: "I do not wish to self-identify", "I prefer not to identify".

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
- **A listbox that stays open.** Closing waits up to 600 ms for the listbox to go (the animation); one
  still there was never closed, so it's dismissed: Escape on the listbox and on the focused element, then a
  press on the page body (a click-away). In the second live run, after a value matched nothing the listbox
  stayed open, and the *next* dropdown then failed with "Could not open the dropdown" (5 times; once it took
  four more fields in the same call with it) while the call after that worked: the press on the next button
  had only closed the stray listbox.
- **Opening again.** When no listbox appears after the press, stray listboxes are dismissed and the button
  pressed once more, then React's `onClick` as a last resort.

The fixture models both behaviours: the portal lingers 150 ms and Degree Level's button has no
`aria-controls`; with `liveDropdowns`, buttons have no `aria-expanded`, Escape closes nothing, and a press
outside an open listbox only closes it (the press is swallowed). Each test fails on the old logic.

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
entered, they're entered once more (the first live run saw a date accepted on the second entry). A date the
page still doesn't take fails with the value for the user to type.

The display and spinbutton hooks are best knowledge of Workday's markup; the typing approach is unverified
on a live tenant. The fixture's `dateWidget: "keys"` models parts that take digits only in keydown (typing
works; the old setter didn't), and `"stuck"` parts that ignore synthetic keys (the fill fails honestly and
`get_form` shows the date empty).

`addRepeatable` presses the add button and waits for more field containers. `pageAction` presses Apply,
Apply Manually, Autofill with Resume or Use My Last Application.

**Going forward** (`next()`): presses the forward button and waits (up to 12 s) until the step changes (its
index or title) or validation errors show: new ones at once, ones already on screen after 2.5 s. `advanced`
is true when the step index, title or page kind changed. Live step titles are often all "Application", so
comparing titles alone reported `advanced: false` on every move of the second live run, and waited the full
12 s on two of them. Notices go to `messages`, not `errors`. Returns
`{ advanced, pageKind, step?, errors, messages?, refusedReason? }`.

**Going back** (`back()`): presses the footer's Back button (`backButton`: `bottom-navigation-previous-button`,
`pageFooterBackButton`, `wd-CommandButton_back`, else a visible button reading Back or Previous) and waits for
the step index or title to change. It's allowed from any step with a Back button, including review (to
correct an answer before the user submits), refused on the first step and on the confirmation page, and never
presses a submit control. Returns `{ moved, pageKind, step?, errors, messages?, refusedReason? }`. What Workday keeps of
unsaved entries on the step being left isn't verified; the skill re-checks steps when coming forward. The
Back hooks are best knowledge of Workday's markup, unverified on a live tenant (Back appears from step 2,
behind sign-in); the fixture's review page has one that returns to the step with its entries.

**Removing a row** (`removeRepeatable(sectionId)`): "Use My Last Application" pre-fills work experience,
education and website rows, and when Workday holds more rows than the profile, adding alone can't fix it.
The method re-extracts, presses the row's delete button, confirms a delete/remove dialog if one appears
(the same `confirmRemoval` as attachments), and succeeds once the page has fewer field containers (a row
element may be re-rendered, so its disappearance alone proves nothing). Returns
`{ sectionId, ok, removed?, error? }`; an id that isn't a removable section fails with "call get_form".
Workday renumbers the rows after it, so their field ids change. The row and delete-button hooks are best
knowledge of Workday's markup, unverified on a live tenant.

**Attached files** (`attachedFiles` in `extract.ts`) are listed once each: the `file-upload-item-name` elements
with their row (`file-upload-item` / `file-upload-successful`), or the rows themselves when a tenant has no
name element. A row and its name both match the file hooks, so reading them naively listed every file twice.

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
Change `selectors.ts` (keep every Workday string of the adapter there; posting-page hooks and hosts shared
with the companion are in `protocol/src/workday.ts`), add a snapshot to `test/fixtures/live/` with
`npm run recon:workday -- <careers-url>`, and extend the tests. The behavioural fixture
(`test/workday-fixture.ts`) is the one model of a Workday step: the adapter tests use it in a jsdom
environment, and the companion's e2e tests run the real adapter on it behind a fake extension, so a new
adapter method needs one fixture behaviour, not two fakes.
