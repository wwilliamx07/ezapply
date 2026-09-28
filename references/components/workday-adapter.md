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
| `dom.ts` | DOM helpers: text normalization, visibility, native value setter, pointer/keyboard sequences, `settle`, `waitFor`, `matchOption`, React prop access, `win(node)` |
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
- **Ids:** `<section slug>.<automation id without formField->` (or the label slug), `#2`, `#3` for repeats, so
  work-history rows stay distinct.
- **Per field:** label (required markers stripped), required, current value, help text, known options,
  `optionsLazy` for dropdowns and typeaheads, date parts, `multiple`, the field's error, and a
  `hint.profileKey` when the automation id is in `PROFILE_HINTS` (e.g. `legalNameFirstName` →
  `identity.firstName`). Hints are suggestions; Claude decides.
- **Page level:** sections, add buttons (`add.<label>`), step title/index/total from the progress bar, page
  errors (visible alerts), page actions, the forward button's label, the Back button's label (`backLabel`,
  when there is one), and the tenant (`workdayTenant`: the
  host's first label on myworkdayjobs.com, the segment after `recruiting` on myworkdaysite.com, where the
  host's first label is just `wd5`).
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
| dropdown | Open the listbox (a portal under `body`; [finding it](#finding-a-dropdowns-listbox)), pick the best match, check the button label; fallback: React `onClick` on the option. No match → `availableOptions`. Closing waits until the listbox has gone |
| typeahead | Type the query and pick the match; a value like `"Job Board > LinkedIn"` walks nested menus; arrays select several; already-selected values are skipped; chips are read back |
| radio, checkbox, checkbox-group | Click the label or input; check `checked`/`aria-checked` |
| date | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` into the Month/Day/Year segments present; errors if the form needs a part not given. When the field still shows an error afterwards, the parts are entered once more (below) |
| file | Only via `upload`: a `File` in a `DataTransfer` set on the input + `input`/`change`; else a drop on the drop zone; confirmed only by a **newly shown** file whose name matches, so a same-named file left from a previous application doesn't pass |

**Option matching** (`matchOption`, whitespace-normalized and case-insensitive): exact, then a unique
prefix, then a unique substring; otherwise no match (never a guess between several).

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
- Closing waits (up to 1 s) until the listbox is hidden or removed.

The fixture models the live behaviour (the portal lingers 150 ms, and Degree Level's button has no
`aria-controls`); its test fails on the old logic.

### Dates entered twice when the page still objects
In the first real application, dates filled as part of a batch read back correctly while Workday still
called them required, and filling them again was accepted. The cause isn't known (it needs a live snapshot
of that step). So after entering the parts, if the field shows an error (`fieldError`: an error element in
the field, or an `aria-invalid` input's description), the parts are entered once more. A field without an
error gets one pass.

After a batch, the page is re-read and any validation error that appeared is attached to that field's
result. `addRepeatable` presses the add button and waits for more field containers. `pageAction` presses
Apply, Apply Manually, Autofill with Resume or Use My Last Application.

**Going back** (`back()`): presses the footer's Back button (`backButton`: `bottom-navigation-previous-button`,
`pageFooterBackButton`, `wd-CommandButton_back`, else a visible button reading Back or Previous) and waits for
the step title to change. It's allowed from any step with a Back button, including review (to correct an
answer before the user submits), refused on the first step and on the confirmation page, and never presses
a submit control. Returns `{ moved, pageKind, step?, errors, refusedReason? }`. What Workday keeps of
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
