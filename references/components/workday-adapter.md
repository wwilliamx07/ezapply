# Workday adapter (`packages/extension/src/adapters/workday/`)

Reads a Workday application page into a [`FormSchema`](protocol.md#form-schema) and fills it, one step at
a time, for Claude. Built into `workday-main.js` and injected into the page's **MAIN world**, because some
Workday widgets are React components that only respond to React's own handlers, which isolated-world
content scripts can't reach.

| File | Role |
|---|---|
| `main.ts` | Bundle entry: defines `window.__ezapplyWorkday` (non-enumerable) unless the same `ADAPTER_VERSION` is already there |
| `api.ts` | `createWorkdayApi(doc, getUrl)`: the methods the background calls, plus `installSubmitGuard` |
| `extract.ts` | Page detection, field extraction, step info, errors, page actions, `isSubmitControl`, `nextButton` |
| `fill.ts` | One filler per field kind, option listing and search, uploads |
| `dom.ts` | DOM helpers: text normalization, visibility, native value setter, pointer/keyboard sequences, `settle`, `waitFor`, `matchOption`, React prop access |
| `selectors.ts` | **Every Workday-specific string**: `data-automation-id` hooks (several candidates each, since tenants and releases vary) and `PROFILE_HINTS` |

## API (`window.__ezapplyWorkday`)
`getForm()`, `listOptions(fieldId)`, `searchOptions(fieldId, query)`, `fill(fills)`, `upload(fieldId, file)`,
`addRepeatable(addButtonId)`, `next()`, `pageAction(action)`, `blockedSubmitAttempts()`. The field registry
from the last extraction is kept; a lookup whose element went stale re-extracts, and an unknown id fails
with "call get_form again".

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
  errors (visible alerts), page actions, and the forward button's label.

## Filling
Every filler follows **act → wait for the DOM to settle → read the value back → `{ ok, readBack, error }`**.
Real DOM events are tried first (native value setter, full pointer+mouse sequence, keyboard); calling React
props directly is only a fallback when the DOM route didn't take, and never on buttons: it would bypass
the DOM listeners the submit guard relies on.

| Kind | Approach |
|---|---|
| text, number, textarea | Native prototype setter + `input`/`change`, blur; fallback: React `onChange`/`onBlur` |
| password | Refused: the user types passwords |
| dropdown | Open the listbox (a portal under `body`), pick the best match, check the button label; fallback: React `onClick` on the option. No match → `availableOptions` |
| typeahead | Type the query and pick the match; a value like `"Job Board > LinkedIn"` walks nested menus; arrays select several; already-selected values are skipped; chips are read back |
| radio, checkbox, checkbox-group | Click the label or input; check `checked`/`aria-checked` |
| date | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` into the Month/Day/Year segments present; errors if the form needs a part not given |
| file | Only via `upload`: a `File` in a `DataTransfer` set on the input + `input`/`change`; else a drop on the drop zone; confirmed by the file chip showing the name |

**Option matching** (`matchOption`, whitespace-normalized and case-insensitive): exact, then a unique
prefix, then a unique substring; otherwise no match (never a guess between several).

After a batch, the page is re-read and any validation error that appeared is attached to that field's
result. `addRepeatable` presses the add button and waits for more field containers. `pageAction` presses
Apply, Apply Manually, Autofill with Resume or Use My Last Application.

## Never submitting
- `next()` refuses on `review` and `confirmation` pages, and whenever the forward button is a submit
  control, returning `refusedReason`.
- `isSubmitControl`: a control whose text or label is "Submit" / "Submit Application", or the footer/next
  button while the active step is Review (whatever its label). Fill, add and page-action calls refuse to
  touch such a control.
- **Submit guard** (`installSubmitGuard`, installed once per document): capture-phase listeners for click,
  mouse and pointer down/up, Enter/Space keys and `submit` cancel any **untrusted** (script-generated)
  event aimed at a submit control, and record it (`blockedSubmitAttempts`). Real user clicks are trusted
  and always go through.
- There is no general click or script tool in the MCP surface.

## Updating for Workday changes
Change `selectors.ts` (keep every Workday string there), add a snapshot to `test/fixtures/live/` with
`npm run recon:workday -- <careers-url>`, and extend the tests.
