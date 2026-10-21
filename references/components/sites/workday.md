# Workday (`packages/sites/src/workday/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

**Pages.** `*.myworkdayjobs.com` and `*.myworkdaysite.com` (`isWorkdayUrl`, `registry.ts`). The
signature is Workday's UI widgets (`[data-uxi-widget-type]`) and the chrome every candidate page has
(`data-automation-id` `utilityButtonBar`, `accessibilitySkipToMainContent`), checked on every saved Workday page.
The **tenant** is the host's first label on myworkdayjobs.com, the segment after `recruiting` on myworkdaysite.com
(whose first label is just `wd5`). The **job** is the requisition at the end of the path's job segment, after `job`
or `details` and before `apply` (`…/job/Toronto/Engineer_JR1000001-1/apply` → `jr1000001-1`). The canonical path
drops the locale segment (`/en-US/`), which the same job's links have or lack. The hosts are Workday's
(`providerHosts`), so a posting's company is the tenant. A multi-step application: a progress bar, Save and
Continue, a review page.

| File | Holds |
|---|---|
| `site.ts` | The definition: the step key (index and title), rows, the wait for a new step's fields, messages |
| `page.ts` | Page kinds, fields (`workdayFields`), rows, add buttons, step, errors and notices, page actions, `isSubmitControl`, next and back |
| `widgets.ts` | `WORKDAY_WIDGETS`, in the order a field's kind is decided: file, date, prompt, dropdown, then the shared radio, checkbox group, checkbox, textarea, password, number and text drivers (labels by `optionLabel`, React's `onChange` as the fallback) |
| `dropdown.ts`, `typeahead.ts`, `date.ts` | Workday's own widgets (below) |
| `remove.ts` | Taking chips and attached files off (`removeItems`), confirming a delete dialog (`confirmRemoval`, the rows' too) |
| `selectors.ts` | Every Workday string of the adapter: `data-automation-id` hooks (several candidates each, since tenants and releases vary) and `PROFILE_HINTS` (`legalNameFirstName` → `identity.firstName`) |
| `reader.ts` (beside `definition/`) | The posting reader (`readWorkdayPosting`, in `POSTING_READERS`): Workday's posting pages carry no JSON-LD worth reading and their title is the role alone, so the capture takes the description, role, location and requisition from the posting hooks `registry.ts` shares with the adapter (`WORKDAY_POSTING`) |

**Page kinds** (`detectPage`), in order: **confirmation** (a confirmation element, or, with no progress bar and no
fields, "application submitted" / "thank you for applying"); **auth** (a visible password input, an active step
named "sign in" / "create account", or sign-in content; the sign-in page is step 1, so it has a progress bar);
**start-choice** (Apply Manually or Autofill with Resume); with a progress bar, **review** when the forward button
reads Submit or the active step is Review, else **step**; then **step** if there are fields, **posting** if a
posting header or Apply, else **unknown**. Posting, start-choice and sign-in are checked on live snapshots, the
rest on the behavioural fixture. Page actions: Apply, Apply Manually, Autofill with Resume, Use My Last Application.

**Fields.** Each visible `formField-*` container not nested in another. The key is the automation id without
`formField-`, or the label's slug when there's none or it's a bare `formField-` (a live Resume/CV field). The job is
`jobTitleHeading`, on every application step and the sign-in page.
- **Add buttons are named by their section:** the last heading (`h1`–`h5`, `legend`, `role="heading"`) before the
  button, outside fields and the progress bar, its row number dropped (`add.work-experience`); from the label only
  when that heading is the step's title. Live Workday labels every add button "Add", or "Add Another" once a row
  exists, so ids from labels said nothing and renumbered after each add.
- **Notices aren't errors:** alerts (`errorMessage`, `errorBanner`, `inputAlert`, `role="alert"`) whose text says
  "success(fully)" and nothing like fail, error, could not, unable, invalid or required go to `messages`. Workday announces
  "resume.pdf successfully uploaded" in the same region; read as an error, it showed in `go_next` and on the file
  field, and ended `next`'s wait before the page had moved.
- **Removable rows:** a section whose first field sits in a row with its own delete button, outside any field, in
  an ancestor holding no other section's fields (so a file's delete button doesn't count, nor a page-wide one). Live,
  that button is a plain "Delete" with a trash icon in a `role="group"` labelled by the row's heading, with no
  automation id or label, so it's found by the icon (`button:has(.wd-icon-trash)`); `panel-set-delete-button`,
  `deleteButton` and "Delete…" are fallbacks that matched nothing live. Removing a row renumbers
  the rows after it.

**Moving.** Live step titles are often all "Application", so the step key is the progress bar's index and title:
comparing titles alone reported every move as none, and Back waited out 12 s each time. After a move the definition
waits (up to `stepFieldsMs`, 3 s) for the new step to show a field, since Workday moves the progress bar before it
renders the step: a read straight after the move (`go_next`'s own `form`) would find an empty step, which with `onlyEmpty` looks like a step
with nothing left to fill. The review page has no fields and isn't waited for.

**A step filled before shows its dropdowns' choices late.** Coming back to such a step (Back, or Next after
Back), Workday renders it, then fetches each dropdown's values and shows the saved choice only once they're in. Seen
live: the page went quiet with those requests still out, so the read gave every dropdown (and the language rows'
levels) as empty, and the agent filled them again. So after the fields and the quiet, `afterStep` waits (up to
`stepRequestsMs`, 4 s) for the page's own requests started since the move (`watchRequests`), then for quiet again.
A longer quiet wouldn't do: the requests run while the page shows nothing changing.

**Back** (`pageFooterBackButton` live; `bottom-navigation-previous-button` and `wd-CommandButton_back` as
fallbacks, else a button reading Back or Previous) works from any step, review included, to correct an answer;
what Workday keeps of unsaved entries on the step left isn't known, so the skill re-checks steps when coming
forward. `isSubmitControl`: "Submit" / "Submit Application", or the forward button (an automation id with
`next` or `footer`, but not `back` or `previous`) while the active step is Review, whatever it reads; `next`
refuses on review and confirmation. Live, Back and Next are both `pageFooter…` buttons, so a test on `footer`
alone took Back on the review page for Submit and refused it.

**Files and removal.** The shared file driver, with Workday's drop zone (through React's `onDrop` first) and its
attached files: the `file-upload-item-name` elements with their row, or the rows when a tenant has no name
element (a row and its name both match the file hooks, which listed every file twice). Workday pre-fills skills
and files from the candidate's last application, so prompts and file fields can be cleared: each item's remove
control (`DELETE_charm` or a delete/remove button on a chip, `delete-file` in a file row), then a delete/remove
dialog's confirm, then React's `onClick`, then Delete and Backspace on the focused chip, each confirmed by the
count dropping. Those hooks haven't been pressed live; the fixture has chips with charms, one removable only by
keyboard, and a file and rows whose delete asks for confirmation.

**Its notes** ([`siteNotes`](../../mcp-tools.md#site-notes)): Add buttons tell their list by `section`; Resume/CV
is often the only file field (`multiple: true`) and takes every document the posting asks for, cover letter and
transcript included, one upload each (an agent that saw no transcript field left a required transcript out);
Use My Last Application and a returning account pre-fill files, skills and rows to clear first.

## Workday's dropdown: finding its listbox
A button opening a listbox rendered as a portal under `body` (`dropdown.ts`). Live Workday gives the button no
usable `aria-controls`, and a closed listbox stays on screen while it animates away, so "the visible listbox" right
after one dropdown was the previous one's, and live, first attempts read the wrong options. So:
- Only listboxes outside any `formField-` container count (a list of selected items inside a field isn't one).
- Before opening, wait (up to `dropdownOthersClosedMs`) for none to be visible, pressing Escape on any left.
- After the press, take `aria-controls`' target, else a listbox that wasn't visible before, or one whose options
  changed (a reused portal); none → React's `onClick`; still none → wait for the page to go quiet and open once more.
- The choice is checked against the button's label, with React's `onClick` on the option as the fallback.
- **Closing.** After a choice the list closes by itself and the driver waits until it's gone. Without one
  (a miss, or the tests' `listOptions`) it must be closed: Escape on the button, then, if the list is still open (its
  `aria-expanded` still true, or, without one, the list still there after `dropdownEscapeCloseMs`), a press on the
  button, as a person would. A button without
  `aria-expanded` is never pressed after a choice: a list still animating away would open again.

**Why the press and the second open.** Live buttons have no `aria-expanded` and Escape doesn't close a live
listbox, so without the press a list read without a choice stays open and the next dropdown's press only closes it
("Could not open the dropdown"). Even with it, live, a dropdown whose own list had been read without a choice failed
its next open, and the same fill a call later worked. Why the first open fails isn't known, so the driver does what
worked: it tries again (`dropdown re-open` in the trace). The fixture models this (`liveDropdowns`: lingering
portals, no `aria-expanded`, Escape closing nothing; `dismissedIgnoresNextPress`). A dropdown that can't be opened at
all costs its open waits twice.

## Workday's prompt: searches and lists
A search-as-you-type multi-select (`multiSelectContainer`, options in a `wd-popup`; `typeahead.ts`), single- or
multi-select, sometimes with nested menus, chosen values shown as chips. Each value is selected on its own: one
matching nothing goes to `unmatched` with the options its search showed while the rest are still selected (so one
miss doesn't stop a skills list); one Workday chose itself on Enter (single-select prompts do) goes to
`inexact`; one chosen but not kept is named in the error, not `unmatched`, so the agent doesn't look for other
wordings of an option it found. `"Job Board > LinkedIn"` walks nested menus. Values already selected are skipped.
- **An item named without its category.** A single name that matched nothing may be an item inside a category:
  on the fill's first such miss the top-level menu is opened, each category with children (`hasChildren`, up to 8)
  is opened in turn and its items read, and the miss's suggestions lead with the full paths of the items that match
  ("Job Board > LinkedIn" for "LinkedIn"); later misses in the same fill reuse what was read. *Why:* live, a
  how-did-you-hear field took four fills (the top level, a wrong path, then the item), each a turn re-reading the
  conversation. Built from the moves `selectPath` already makes on a nested path (open the menu, press a category,
  read its items); not yet seen live ([status](../../status.md)).
- **Waiting for results.** Typing waits until the options differ from those before and one of them holds the query
  (`answersQuery`; every 100 ms, up to `typeaheadResultsMs`, then once more after React's Enter handler), or until
  "No Items." has stayed for `typeaheadNoResultsMs` (it also shows while results load). Reading once the DOM went
  quiet returned the previous query's results, one call behind. **Why the query must show:** on a hierarchical
  prompt (a field of study under "All" and "Partial List…") the category menu rendered just after the query was
  typed and was read as the results. Results that hold no part of the query cost the full wait and its retry,
  about 6 s.
- **A list loaded on the press.** The query is typed only once the page's requests started by the press into the
  prompt are back (`watchRequests`, up to `typeaheadFocusRequestsMs`, then quiet again; the trace notes
  `typeahead list loading`). *Why:* live, a field of study fetched the start of its whole list on the press
  (about 0.7 s) while the page showed nothing changing; the search sent on that quiet came back sooner, and the
  list landed over its results, so every search and fill read the same first page ("Accounting",
  "Actuarial Science"…). A prompt whose press fetches nothing, such as skills, doesn't wait. The fixture models it
  (`skillsPrompt: "listOnFocus"`).
- **Checkbox lists.** Some multi-selects tick each option (`promptLeafNode` with `data-automation-checked`), stay
  open on a press, toggle on every press, and tick a search's only result themselves on Enter; pressing it then
  unticked it (live: skills and a citizenship selected, then unselected). An option already selected (its chip, or
  `Checked`) isn't pressed; the trace notes `selected on Enter`.
- **Each option once.** Both option hooks (`promptOption`, `promptLeafNode`) match one live option, one inside the
  other; the innermost is kept, so matches aren't made ambiguous by duplicates. "No Items." is never an option.

## Dates typed into Workday's split widget
A Month, Day and Year part (any of them), each its own input (`date.ts`). Workday's parts keep their value in their
own state: setting the inputs' values showed the digits while Workday called the date empty, however often it was
filled. So each part is entered as a person does: pressed (its display element when there is one), focused, the
digits typed with `typeChar`, then a browser-style `change`; only if it still doesn't hold the value is it set
directly. **What a part holds** is read from its display element (`…-display`, showing "06" while the input holds
"6"), else `aria-valuenow`, else the input, so a value the widget didn't take reads as empty in the fill result and
in `get_form`. When the field still shows an error after the parts are entered, they're entered once more (a date
was seen taken on the second entry). A part checks only itself as it's entered, and a busy page was seen re-parsing
the whole date as the first day digit landed (the month "08" became "2", the year its default), so after the parts
are entered every part is compared with what's wanted and those that drifted are entered once more, before the
read-back (the trace's `date parts drifted` branch). Parts that don't read back the value fail with the date for
the user to type; parts that do while the field shows an error stay `ok` with "Filled, but the page reports: …".
The fixture's `dateWidget: "keys"` (digits only in keydown), `"stuck"` (synthetic keys ignored) and `"reparse"`
(Month, Day and Year, rewritten on the first day digit) model these cases.

Typing works on live tenants while the page has focus; with the browser window behind another, every multi-part
date read back right while Workday called it required. So the application tab runs under focus emulation, which
gives the page focus wherever its window is ([the tab at full speed](../../mcp-tools.md#forms)), and debug mode
records `focused` and the date's `date part set directly`, `date entered again` and `date parts drifted` branches,
to confirm it.

**Tests.** The behavioural fixture (`test/fixture.ts`) is the one model of a Workday step: the adapter tests
use it in jsdom, and the companion's e2e tests run the real adapter on it behind a fake extension, so a new
behaviour needs one fixture change, not two fakes. Live snapshots are in `fixtures/`.
