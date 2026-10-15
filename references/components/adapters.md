# Adapters: one engine, a definition per site (`packages/engine/`)

An adapter reads a job site's application page into a [`FormSchema`](protocol.md#form-schema) and fills it for
Claude. There is one engine, written once, and a **site definition** per site that says what differs: where the
fields, their prompts and the buttons are, which widgets the site uses, how its rows and pages behave, and how
long it waits. Every site's adapter has the same API, so the background, the companion, the MCP tools and the
skills treat them all alike.

The engine is its own package, `@ezapply/engine`, with no build: its `package.json` exports its sources
(`@ezapply/engine/dom`, `@ezapply/engine/widgets/native`), which each site's bundle compiles in. It names no site; the
definitions are in [the sites package](sites.md#the-package), each in `<site>/definition/`.

| Path (`packages/engine/src/`) | Role |
|---|---|
| `types.ts` | `SiteDefinition` and its parts (`PageRules`, `RepeatRules`, `FillRules`, `SiteWaits`, `Messages`), `FieldSpot`, `RowSpot`, `AddButtonSpot`, `WidgetDriver` |
| `extract.ts` | `extract(site, doc, url)`: the page as a schema, plus the field registry the API works from |
| `api.ts` | `createAdapter(site, doc, getUrl)`: the API the background calls; `install(site)`; `ADAPTER_VERSION` |
| `standard.ts` | Helpers for plain HTML and ARIA forms: prompts, choice labels, headings, the submit-by-text test, confirmation text, single-page rules (`singleStep`, `titledJob`), standard waits and messages |
| `dom.ts` | DOM helpers: text, visibility, events, `settle`, `waitFor`, `matchOption`, `answersQuery` (whether options can be a search's results), `parseDate`, React props, `reactFiber` (a node's fiber in the current tree), `win(node)` |
| `timing.ts` | `T` (the waits in use), `useSiteWaits`, `setTiming`; `watchWaits` and `waitName` for the debug trace |
| `guard.ts` | `installSubmitGuard(doc, isSubmit)` ([never submitting](#never-submitting)) |
| `trace.ts` | Debug mode's trace ([below](#debug-mode-the-adapter-trace)): the recorder, its hooks, and what the helpers and fillers call |
| `markup.ts` | Debug mode's markup snapshots: `cleanMarkup`, `pageMarkup`, `failureMarkup` |
| `widgets/` | Shared drivers ([below](#shared-drivers-widgets)) |

Every site, and what it does differently, is in [sites](sites.md): [Workday](sites/workday.md) and
[Oracle](sites/oracle.md) (`page.ts`, `selectors.ts`, `widgets.ts` and a file per widget of
their own beside `site.ts` in `definition/`), Greenhouse, Lever, Ashby, Phenom and Dayforce (a `site.ts` each, on shared drivers), and
SAP SuccessFactors (a `site.ts`, with its picklist and attachment drivers in `widgets.ts`).

**Why one engine.** The Workday and Oracle adapters were about 1,600 lines each, and most of each repeated the
other: the API, ids, sections, rows, errors and notices, the fill loop, next and back, the guard. What really
differs per site is the markup and a few widgets. Greenhouse, Lever and Ashby are 150 to 165 lines each; Phenom,
with steps and rows, about 330; Dayforce, with steps, records, Personal Information's own form and phone numbers
read as two fields, about 490; SuccessFactors, one page with rows and documents, about 320, plus 350 of drivers for
its own framework's widgets.

**Why TypeScript, not data.** A definition is code: typed, able to hold a small function where a selector isn't
enough, tested like code, and bundled with the extension. It's never fetched remotely: Manifest V3 forbids
remote code, and whatever touches a form should be reviewed and tested.

**No generic definition.** There's no "plain HTML" definition that would run on any site: page kinds and the
submit test would be guesses there, and a guess about Submit is the one this project can't make. A site gets a
definition built from its own pages ([building adapters](../building-adapters.md)).

**No globals.** Event, observer, `File`, `DataTransfer` and element-prototype constructors come from the
element's own window (`win(node)`). The engine and drivers run the same in the page, in a jsdom test
environment, and in a jsdom window inside a Node test, which is how the companion's e2e tests drive them.

## The site definition (`SiteDefinition`)

| Part | Says |
|---|---|
| `info` | The site's [registry entry](sites.md#the-registry): id, tenant, its waits |
| `widgets` | Its drivers. A field whose spot names none gets the first that recognises its container, so the more specific go first |
| `fields(doc)` | Every field in page order, as `FieldSpot`s: container, driver (optional), key, prompt (`label`), section title, required, and optionally automation id, help, error, profile hint |
| `addButtons(doc)` | `AddButtonSpot`s: element, key (`add.work-experience`, `save.languages`), label, section, and `kind`: `row` (adds a row of fields), `form` (opens an inline form), `save` (an inline form's Save, or a form that's part of the step), `edit` (opens a saved item's form again) |
| `rows(doc, sections)` | Rows the page can delete (a section with its own delete button), and saved items (a section of its own with no fields: Oracle's tiles) |
| `page` | Page kind, step, step key (what changes on a move: index and title, or the URL), errors, notices, page actions and their buttons, next, `nextBlocked?` (why Next can't go on from the page as it is, checked before pressing: a requirement the page would enforce with a native dialog), back, button labels, `isSubmit`, and `job?` (the job the page says it's the application for: its title, a requisition it shows; the engine puts it in `FormSchema.job`, and the companion uses it to tell which posting a tab belongs to when its URL can't: [which posting](../mcp-tools.md#forms)). Every site has `job`: Workday's `jobTitleHeading`, Oracle's flow heading, the one-page sites' own title. A site whose pages show no title leaves it out |
| `repeat` | What a deletable thing is called, what an add makes more of and a removal fewer of, the delete button (revealed first where the site hides it), confirming a removal, and an inline form's errors |
| `fill` | `order` (`given`, or `page` for dependent lists), `waitForStaleErrors`, `scrollBeforeUpload`, `newErrorsOnly` (a page that keeps old errors on screen) |
| `waits` | `afterField`, `afterRow`, `afterStep(doc, moved)`, `afterAction` ([waits](#waits-owned-by-the-site)) |
| `messages` | What the engine says when it refuses or finds nothing, in the site's terms (no Next button, Submit is the way on, why `next` won't go on, what `remove_items` works on) |

## Extraction (`extract.ts`)
For each `FieldSpot`, its driver gives the kind, the current value, known options, `optionsLazy`, date parts and
`multiple`; the spot gives the rest. Then:
- **Ids:** `<section slug>.<key>`, with `#2`, `#3` for repeats, so rows stay distinct.
- **Sections** in page order, titled by the spots' section titles. A row from `rows()` marks its section
  `removable`; a saved item becomes a section of its own, `removable` and `saved`, with no fields.
- **Add buttons** get unique ids (`#n` after the first) and their `kind`.
- **Page level:** page kind, step, actions, errors, notices (`messages`), `nextLabel`, `backLabel`, the tenant (from
  the registry), and `lastPage: true` on a `step` whose forward button is a submit control.

The schema's facts (`kind`, `saved`, `lastPage`) are what the companion reads instead of site names
([checklist](companion.md)), so a new site needs no companion change.

## The API (`api.ts`)
`createAdapter(site, doc, getUrl)` returns `version`, `site`, `setTiming`, `setDebug`, `takeDebug`, `getForm`,
`listOptions`, `searchOptions`, `fill`, `upload`, `remove`, `removeRepeatable`, `addRepeatable`, `next`, `back`,
`pageAction` and `blockedSubmitAttempts`. It keeps the field registry from the last extraction; a lookup whose element left
the page re-extracts, and an unknown id fails with "call get_form again". No call touches a field or button that
`isSubmit` says submits.
- **`fill`:** each field through its driver, in the order given or in page order (`fill.order`), with the site's
  `afterField` wait after each. Then the page is read again: a field showing an error keeps `ok: true` with
  "Filled, but the page reports: …". With `waitForStaleErrors`, fields filled but still showing an error get up to
  `afterFieldMaxMs` for it to clear first (Oracle's lists, seen live).
- **`listOptions`:** the driver's `list`, else the options the field shows. **`searchOptions`:** the driver's
  `search`, else `messages.noSearch`.
- **`upload`:** builds a `File` from the companion's base64 in the page's own window and hands it to the driver.
- **`remove`:** the driver's `remove`, else `messages.cantRemove(kind)`.
- **`addRepeatable`:** presses the button and waits (`addRowMs`) for `repeat.added` to grow. A `save.*` button
  with `repeat.saveErrors` waits for the form to close or show errors; still open → `ok: false` with the page's
  errors.
- **`removeRepeatable`:** presses the row's delete button (`repeat.deleteButton`), confirms a dialog if the count
  hasn't dropped, and succeeds once `repeat.removed` is lower.
- **`next`:** refuses where `messages.refuseNext` says (review, confirmation; Oracle's sign-in), where the
  site's `page.nextBlocked` says (a requirement the page would enforce with a native dialog that stops it: Phenom's
  resume on step 1), with no next button, and when the forward button submits. Otherwise presses it and waits (`stepMs`) for the step key to
  change or errors to show (only new ones, with `newErrorsOnly`); then the site's `afterStep`. `advanced` = step
  key or page kind changed. Notices go to `messages`, not `errors`.
- **`back`:** refused after submitting; presses the back button and waits for the step key to change.
- **`pageAction`:** presses the site's button for the action, then `afterAction`.

`install(site)` (each bundle's entry) defines `window.__ezapply_<site>` (non-enumerable) unless the same
`ADAPTER_VERSION` is already there. The build stamps that with a hash of the bundle
([builds](extension.md#builds-npm-run-build--w-ezapplyextension)); unbundled, in tests, it's `"dev"`.

## Widget drivers
Drivers are per widget library, never per site: a new site uses the existing ones first, a library no driver
handles gets a shared driver named after it, and only a widget of the site's own gets a driver in the site's
folder ([building adapters](../building-adapters.md#principles)).

A `WidgetDriver` is one kind of widget: `kind`, `is(container)`, `value`, and optionally `options`,
`lazyOptions`, `dateParts`, `multiple`, `fill(container, value)`, `list`, `search`, `remove`,
`upload`. Every fill acts, waits, reads back, and returns `{ ok, readBack, error?, availableOptions?, unmatched? }`.
Options are matched by `matchOption` (`dom.ts`), case-insensitive: the option itself; the option without its
trailing parenthetical, or the parenthetical alone ("Python" for "Python (Programming Language)"); a prefix either
way; a substring. Each rule after the exact one must single out one label, so "Yes" picks "Yes, I will require
sponsorship" only when no other option begins so, and "Canada" takes Greenhouse's "Canada +1" and Dayforce's
"🇨🇦 +1 Canada". A miss returns the options seen. The agent reads every read-back, so a loose pick is seen. A
stricter mode that took only exact wordings served deterministic autofill and went with it
([status](../status.md#deterministic-autofill-removed)).

### Shared drivers (`widgets/`)
| Driver | For |
|---|---|
| `textDriver(kind, selector \| { selector?, leave?, react? })` (`native.ts`) | Text, email, tel, url, number inputs and textareas: native setter past React's value tracker, blur (or the site's `leave`), React's own handlers as a fallback unless `react: false` (Oracle's Knockout inputs). A phone number the page reformats counts when the digits match; a read-only input is refused |
| `passwordDriver` | Recognised so it's never taken for text; never filled |
| `selectDriver({ settled? })` | A native `<select>`; an option with an empty value ("Select...") is the placeholder, not a choice. `settled` (Phenom): for a React list that puts the old value back at once and takes the new one a moment later, set it past React's tracker and wait for the read-back, without calling React's handler (which by then reads the old value) |
| `radioDriver({ label?, fallback? })`, `checkboxDriver({ fallback? })`, `checkboxGroupDriver({ label?, fallback? })` | By their own labels (`choiceLabel`, or the site's `label`). When pressing the input didn't change it, `fallback` says what's next: its label takes the click (a hidden input; the default), React's `onChange` gets the state wanted (`"react"`, Workday), or nothing (`"none"`, Oracle's checkboxes). The group fills exactly the options named and removes some |
| `dateInputDriver()` | Native `date` and `month` inputs, `YYYY-MM-DD` or `YYYY-MM` |
| `monthPickerDriver()` (`datepicker.ts`) | A react-datepicker that picks a month (`MM/YYYY`; date parts `MM`, `YYYY`), driven through its calendar because its input takes no typing: opened from the input, the year chosen from the header's list (else stepped to with its arrows), the month pressed. A year the list lacks is refused with the years on offer, a disabled month as outside the dates the page allows |
| `reactSelectDriver()` (`react-select.ts`) | react-select, through its own props ([below](#react-select-through-its-props)) |
| `antSelectDriver()` (`antd-select.ts`) | Ant Design's Select, through rc-select's context ([below](#ant-designs-select-through-rc-selects-context)) |
| `toggleButtonsDriver(selector \| { buttons?, label?, pressed?, multiple? })` (`buttons.ts`) | A choice of toggle buttons (Ashby's Yes / No; Oracle's pills, by their own label and pressed class), as a radio; with `multiple`, a checkbox group that `remove_items` unpresses. A button is pressed only when it must change (a pressed toggle may unpress itself), with React's `onClick` as the fallback |
| `comboboxDriver({ input?, options?, value? })` (`combobox.ts`) | A search-as-you-type field (a location): types the value, waits for suggestions that differ from those before, chooses the match. No match → `unmatched` with the suggestions. By default the input is `role=combobox` and the suggestions the `role=option`s of its listbox |
| `ui5DatePickerDriver()` (`ui5-datepicker.ts`) | A UI5 Web Components date picker (SuccessFactors' dates), whatever tag an app registers it under (`[ui5-date-picker]`): its `value` set in its `format-pattern` (`MM/dd/yyyy`; date parts from it), then the `change` event the component fires, with `{ value, valid }`, which is what an app hears ([sites](sites/successfactors.md)). A date without the day the pattern asks for, a read-only picker and a pattern with month names are refused |
| `fileDriver({ input?, names, entries?, dropZone?, reactDrop?, removeButton?, confirmRemoval?, multiple? })` (`file.ts`) | A file input (often hidden behind "Attach"): a `File` in a `DataTransfer` on the input, then a drop on the field (or the site's `dropZone`, through its React `onDrop` first with `reactDrop`). Done only when the page shows a **new** file of that name: one more of that name, or, with `entries`, an element that wasn't there before, so a same-named file the page replaces counts. A field without an input that already holds a file says to remove it first. Removed by its own button, confirming a dialog when the site gives `confirmRemoval` |

**The combobox types a key too.** Lever's location field searches on keyup, not on input (seen live): setting
the value found nothing. The driver sets the value, then sends the last character as a key event. When a search
brings the same suggestions as the last one, the wait ends without a change and the suggestions on screen are
used; each is matched against the value anyway.

### react-select, through its props
react-select (Greenhouse, many React forms) is driven through the component itself: the fiber of its input leads
up to the component whose props hold `options`, `onChange`, `onMenuOpen` and `getOptionLabel`. `list` reads the
options without opening anything; `fill` calls `onChange` with the matching option (an array for a multi-select);
`remove` calls `onChange` without the values.

**Lists that load as you type** are searched by `search` and by `fill`: an async select (`loadOptions`), and any
list with no options at all, which is a page fetching on `onInputChange` and passing the results in as `options`
(Greenhouse's location). The driver opens the menu, types the query through `onInputChange`, and waits for the
load to end (`isLoading` seen and gone, or else the options changing), so a query nothing matches ends with the
load instead of waiting out `typeaheadResultsMs`. Afterwards it closes the menu and clears the typed text, which
would otherwise stay in the input over the choice. **Why open the menu.** react-select-async-paginate (Greenhouse's
school and discipline) loads on an input change only while its menu is open, and loads nothing otherwise (read
from its code: the effect is gated on `menuIsOpen`). `reactSelectDriver({ menu })` says how to open and close it;
the default calls `onMenuOpen` and `onMenuClose`, which change nothing on a page that holds `menuIsOpen` itself.
After a choice in a searched list the driver waits up to `typeaheadResultsMs` for the value to change, since the
page can confirm it with a request of its own first (Greenhouse's location asks its provider for the place).

**Why not clicks.** Seen live on Greenhouse: a synthetic mousedown never opens the menu unless the
page has focus, and the user's browser window usually hasn't while they type in their terminal. Choosing
through `onChange` needs no menu and no focus. **Why the alternate fiber.** React keeps two copies of each fiber;
the one stored on the node can be the old one. After a choice the page showed, reading from the stored copy gave
a null value. The node's props are always current, so the walk starts from whichever copy holds them
(`reactFiber` in `dom.ts`, which the Ant Design driver uses too).

### Ant Design's Select, through rc-select's context
Ant Design's Select (Dayforce, many React forms) is rc-select underneath, which renders a `SelectContext.Provider`
above its input. The driver walks up from the input's fiber (`reactFiber`) to the first fiber whose props' `value`
has `flattenOptions` and `onSelect`: the options as the menu would show them, the values chosen (`rawValues`, an
array or a Set by version), and the function the menu calls when an option is pressed. `list` and `search` read the
options (group headings and disabled options aside); `fill` matches the value against their labels and calls
`onSelect(value, { selected: true })`, which is what pressing the option does: the select's `onChange` runs, and so
does that of antd's `Form.Item` around it. The value read back is the chosen values' labels; without the context,
the page's own display (`.ant-select-selection-item`). A disabled list (`ant-select-disabled`, one waiting for an
earlier answer) is refused. A label can be a React element (Dayforce's dialling codes: a flag, `+1`, the country):
its text is read from the element tree.

**Why not clicks.** The menu opens on a mousedown, renders in a portal only while open, and a long list is virtual,
holding only the options in view; a synthetic mousedown on react-select did nothing without page focus (above). The
context needs no menu, no focus and no scrolling. **The risk:** the context is rc-select's internals. Its shape was
checked in the version Dayforce bundles, but the driver hasn't run live ([status](../status.md#not-yet-verified-for-real)).

### A site's own drivers
A widget no shared driver handles gets a driver in the site's folder: Workday's listbox dropdown, prompt
(typeahead with nested menus), split date and drop zone; Oracle's cx-select, date lists, pills and attachment
buttons; SuccessFactors' paginated picklist and attachment fields, both components of its own framework (juic), driven
through juic's component registry and the attachment view's upload popup
([sites](sites/successfactors.md#the-paginated-picklist-through-its-component)). Each such driver holds everything about its
widget: how it's recognised, read, listed, searched, filled and cleared.

**Why Workday and Oracle were reworked.** When they moved onto the engine, their fillers and readers
moved unchanged: each "driver" handed its kind back to one `fillField` switch and to `currentValue` and
`knownOptions` switches, the kind was decided twice (the drivers' `is` and `fieldKind` / `rowKind`), and their
text, radio, checkbox, checkbox-group and file code were copies of the shared drivers, which had drifted apart (the
shared ones took a reformatted phone number and refused read-only inputs; Workday's tried React's handlers where
the shared ones press the label). Now each widget of their own is a real driver in a file of its own, the plain
controls and files use the shared drivers with options for what really differs, and the switches are gone. The
golden schemas and every behaviour test stayed equal. One fix came with it: an Oracle checkbox group of native
checkboxes (not pills) was filled as pills, so no option ever matched; it now uses the shared checkbox group.

## Waits, owned by the site
Each site owns its waits. Its registry entry (`SiteInfo.waits`, in its `registry.ts`) gives every named wait
a value; today every site starts from `STANDARD_WAITS`, measured on Workday. Its definition's `waits` say what to
wait for after each field, row, step move and page action: `standardWaits` settles the page for as long as the
waits say; Workday's `afterStep` also waits (up to `stepFieldsMs`) for the new step's fields, since Workday moves
the progress bar before the step renders. The engine's loops never sleep on their own; they wait only through
these, and for their conditions as long as `T` says.

`createAdapter` loads the site's waits into `T` (`useSiteWaits`). The companion reads `autofill-timing.yaml` for
the tab's site ([format](../data-formats.md#autofill-timingyaml-companionsrcformstimingts)): a top-level key changes a wait on every site,
a key under the site's name (`workday:`) on that site only. It resolves them against the same site's waits and
sends the result with every call; `setTiming` applies it before the method runs, and `null` or none restores the
site's own, since `T` lives on in the page between calls. `scale` multiplies the waits the file leaves unset; a wait
it sets is used as written.

Every wait (about 50: after each field, a dropdown's open and close, a search, a date's parts, uploads, rows, steps)
is a named value in `T` (`engine/src/timing.ts`), and `TIMING_DOCS` (`protocol/src/timing.ts`) says what each is for. Of
the poll intervals only `waitFor`'s default is configurable (`pollMs`); waits with their own interval (search
results 100 ms, uploads 200 and 250 ms, a step's fields 150 ms) keep it.

**Why every wait is tunable.** Live Workday fills once ran slowly (dropdowns about 2.5 to 3 s each, a 15-dropdown
step in 49 s). Most waits end as soon as their condition holds, but some cost their full length on every field when
the page never goes quiet or a check never matches, and which ones wasn't measured. The file lets a wait be shortened
without a rebuild, to see what breaks. Six dropdown waits set to 200 ms (from 1 to 2 s) then ran four live
applications in one day, on Workday and Oracle, with 128 fills and no dropdown failing to open, so those are the
defaults now.

## Debug mode: the adapter trace
With [debug mode](../development.md#debugging-a-live-run-debug-mode) on, every adapter call records what
happens inside the page. The companion asks for it on each call (`debug` in the form call's parameters); the
background sets it with `setDebug` right after `setTiming`, in the same script, and takes it with `takeDebug`
after the method returns or throws ([background](extension.md#serving-form-requests-formsts)). It travels back
beside the result, never in it, and the companion writes it into the call's record
([format](../data-formats.md#debugdate-postingid-companionsrcformsdebugts)).

**What it records** (`trace.ts`, `DebugTrace`):
- **Inside the call, in order:** every query the adapter makes (`querySelector`, `querySelectorAll`,
  `getElementById`) with the selector, what it ran on and how many elements it found; every event it dispatches
  and change it makes (press, key, input, typed characters, blur, a React handler called directly), with a summary
  of the element (tag, automation id, role, label); every wait, with its name, how long it was allowed and took,
  and whether its condition, quiet or its maximum ended it; how each value was matched against the options; each
  field's start, end and outcome; and the branches the fillers take only sometimes, which they name themselves
  (Workday: `dropdown re-open`, `date entered again`, `date part set directly`, `typeahead search again`, `selected on Enter`,
  `upload by drop`, and each dropdown's `listbox`: the listboxes on screen, the one read, its options; Oracle:
  `search the list`, `typeahead search again` and the list's options).
- **Around it:** the page's state before and after (URL, step, `document.visibilityState`, `hasFocus()`); its DOM
  changes, summarised (the topmost element of each addition and removal, with its size, and changes to
  `aria-expanded`, `aria-selected`, `aria-invalid`, `value`, `disabled` and `hidden`), which shows a listbox opening
  and closing or a section re-rendered with its filled rows dropped; and the page's own uncaught errors, unhandled
  rejections, `console.error`s and `fetch` and XHR requests (method, origin and path, status, duration; never a
  query string or a body). A step whose save request failed shows up only there.
- **Markup** (`markup.ts`), as the companion asks: the whole page before the call (taken before the trace starts,
  so it isn't timed), after it, and at each field that fails: its section (the nearest fieldset, section, group,
  region or form), every popup or listbox open on screen, and the last one the page took away during that field,
  since a dropdown's list closes before its fill returns. The page's removals are watched for that and kept as
  elements, serialised only if the field fails. Cleaned of scripts, styles, stylesheet links, SVG contents and
  inline handlers, with live values written into attributes (never a password's): debugging needs the values,
  and the companion's export scrubs them. A shadow root's contents aren't copied.

**Where it's recorded.** Every driver goes through the engine's helpers (`dom.ts`): `press`, `key`,
`setNativeValue`, `typeChar`, `blur`, `callReact`, `waitFor`, `settle`, `sleep`, `matchOption`. They report to the
trace, so the fillers didn't change for most of it; `api.ts` records the fields, and the fillers add only their
named branches and listbox notes. Without debug every reporting function returns at once and nothing is installed:
a call runs as it did before. Checked on the behavioural fixture: the same six-field Workday fill took the same
time with debug on and off (within a few ms of 3.5 s over six runs each).

**Naming waits without touching every call site.** A wait's length is passed as `T.someWait`. While debug is on,
`watchWaits` turns `T`'s values into getters that note each key read, so `waitFor(fn, T.dropdownOpenMs)` reads
`dropdownOpenMs` just before the call and the wait takes the latest name read with its length (`pollMs` aside,
which every `waitFor` reads for its interval). After the call they're plain values again. Labelling the waits at
their hundred-odd call sites was the alternative; it would have made the trace an edit of every filler.

**Telling the adapter's queries from the page's.** The query hooks sit on the DOM prototypes, which the page uses
too. A query counts while the adapter's own code runs: from the start of the call, from the end of each of its
waits to the start of the next, and in a `waitFor`'s condition, but never inside an event it dispatches, where the
page's handlers run. Page microtasks that run in between can still be counted; they're few. A polling wait's
repeated queries are one entry with a count.

**Bounded.** Lists are capped (events 5000, DOM changes 2000, errors 200, requests 500) and the overflow is
counted. A trace left running by a call the companion gave up on is dropped by the next call's `setDebug`, and
its hooks come off after 15 minutes regardless.

## Never submitting
- `next` never presses a submit control and refuses where the site says; no other call touches one.
- **Submit guard** (`installSubmitGuard(doc, site.page.isSubmit)`, once per document): capture-phase listeners for
  click, mouse and pointer down/up, Enter and Space, and `submit` cancel any **untrusted** (script-generated) event
  aimed at a submit control, and record it (`blockedSubmitAttempts`). Real user clicks are trusted and go through.
- Each site's `isSubmit`: Workday's and Oracle's own tests; Greenhouse, Lever and Ashby use `isSubmitByText`: a
  `type=submit` button or input, or a control reading "Submit", "Send", "Submit (my) application". Phenom goes by
  the words alone, since its Next is a `type=submit` button too; Dayforce by its Submit's hook and the words, since
  its forms' Update buttons are `type=submit`; SuccessFactors by Apply's hook (`_submitBtn`) and the words "Apply" or
  "Submit". On a one-page
  site Submit sits beside every field, so the guard's Enter case matters as much as the click.
- The conformance test checks, for every registered site, that the guard blocks a synthetic click and Enter on
  its Submit and that `next` doesn't press it.

## Tests
- **Golden schemas** (`<site>/test/golden.test.ts` and `golden/*.json`, for Workday and Oracle): `getForm()` of every Workday and Oracle fixture state
  and live snapshot, written before the two moved onto the engine. The ported adapters give the same JSON, apart
  from the new schema facts. `UPDATE_GOLDEN=1` rewrites them after an intended change.
- **Conformance** (`sites/test/conformance.test.ts`), for every registry site on the page its `test/page.ts` builds
  (Workday's and Oracle's fixtures, the others' saved live pages): a definition, a bundle entry and a page exist; every wait is set; every field has
  a prompt and a kind; ids are the same on two reads; the guard blocks Submit by click and by Enter, and `next`
  never presses it.
- **Signatures** (`conformance.test.ts` and `registry.test.ts`): every saved live page of every site matches its own site's
  [signature](sites.md#the-registry) and no other's, and a careers page that only links to
  boards, loads their embed scripts, frames them or has a form of its own matches none. The saved pages are found from each
  site's `fixtures/`.
- **Drivers** (`engine/test/widgets.test.ts`) on minimal markup: each native control, react-select (with the stale stored
  fiber), Ant Design's Select on a model of rc-select's context (labels that are React elements, a disabled list), toggle buttons, a combobox that searches on keyup, a file field, a select that settles late, a month
  picker that ignores typing, and a UI5 date picker heard through its change event.
- **Sites from live pages** (each site's `test/live.test.ts`): extraction from each saved Greenhouse, Lever and Ashby
  application and Phenom step, and Phenom's `next` refusing step 1 without a resume; Dayforce's Candidate Info
  step, its Submit told by hook and words, its posting and confirmation told apart from its scripts' messages, and
  its records (markup from the portal's scripts, inside the saved page): an open one as a section with its Update, a
  saved one as a saved item deleted through its dialog. SuccessFactors' application: the one page with Apply as the
  way on, the job from its heading, the profile's named and hinted fields, lists, dates with their parts, rows and
  their Add, the documents, a collapsed section still read, Apply told from Save; and, with juic's registry, the
  picklists, the upload popup and the delete dialog modelled from its scripts: a list listed, searched and chosen
  through its component, a disabled list refused, a row removed, documents uploaded beside others and replaced, an
  optional one removed after its dialog and a required one refused.
- The Workday and Oracle behaviour tests and the companion's e2e tests run on `createAdapter` with their
  definitions (`sites/test/adapters.ts`: `createWorkdayApi`, `createOracleApi`).
- **The debug trace** (`sites/test/trace.test.ts`, on the Workday fixture): with debug off nothing is installed or recorded,
  and every hook comes off when the trace is taken; a filled dropdown's trace has the press, the listbox read, the
  match and its named waits with planned and actual times; a wait the companion shortened keeps its name; a failed
  field is saved with its section and the list it read, and the page before and after; the date's second entry and
  the dropdown re-open show as branches; the page's errors and requests are recorded without a query or body; a
  trace left running is dropped by the next call.

## Checking a site live
The Greenhouse, Lever and Ashby definitions were checked against live public forms with a script, not
in the repo, that starts headless Edge, opens the page over the DevTools protocol, injects the site's built bundle
into the page's main world as the extension does, and calls the adapter's methods. Rules it kept:
- **Never submits.** Nothing calls Submit; the guard is in place; `next` was checked to refuse.
- **Obviously fake values** only ("Test", `test@example.com`), never the user's data.
- **No file sent to a third party.** An upload was tried only where the page keeps the file until Submit
  (Greenhouse); Lever and Ashby send it on attaching, so their uploads weren't tried.
- **No bot-protection workarounds.** A site that blocks headless browsers or shows a challenge (SmartRecruiters'
  DataDome, iCIMS) is built from pages the user saves from a real session instead.

The script hardcodes this machine's paths, so it stays out of the repo until the todo's "Agents that try to
break a new adapter" gives it a home.

**Phenom** was looked at differently: its steps open only through Next, which saves each step to the employer's
system, and step 1 requires a resume, which goes there on attaching. With the user's agreement, a script drove the
live page directly (not the built bundle) with placeholder values and a placeholder resume, saved each step, and
stopped after step 3 without reaching Review. The definition was then built from the saved steps
([sites](sites/phenom.md)).
