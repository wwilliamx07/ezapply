# Adapters: one engine, a definition per site (`packages/extension/src/adapters/`)

An adapter reads a job site's application page into a [`FormSchema`](protocol.md#form-schema) and fills it for
Claude. There is one engine, written once, and a **site definition** per site that says what differs: where the
fields, their prompts and the buttons are, which widgets the site uses, how its rows and pages behave, and how
long it waits. Every site's adapter has the same API, so the background, the companion, the MCP tools and the
skills treat them all alike.

| Path | Role |
|---|---|
| `engine/types.ts` | `SiteDefinition` and its parts (`PageRules`, `RepeatRules`, `FillRules`, `SiteWaits`, `Messages`), `FieldSpot`, `RowSpot`, `AddButtonSpot`, `WidgetDriver` |
| `engine/extract.ts` | `extract(site, doc, url)`: the page as a schema, plus the field registry the API works from |
| `engine/api.ts` | `createAdapter(site, doc, getUrl)`: the API the background calls; `install(site)`; `ADAPTER_VERSION` |
| `engine/standard.ts` | Helpers for plain HTML and ARIA forms: prompts, choice labels, headings, the submit-by-text test, confirmation text, single-page rules (`singleStep`, `titledJob`), standard waits and messages |
| `engine/dom.ts` | DOM helpers: text, visibility, events, `settle`, `waitFor`, `matchOption`, `parseDate`, React props, `win(node)` |
| `engine/timing.ts` | `T` (the waits in use), `useSiteWaits`, `setTiming` |
| `engine/guard.ts` | `installSubmitGuard(doc, isSubmit)` ([never submitting](#never-submitting)) |
| `widgets/` | Shared drivers ([below](#shared-drivers-widgets)) |
| `sites/<site>/site.ts` | The site's definition; `main.ts` is its bundle entry (`install(site)`) |
| `sites/index.ts` | `SITE_DEFINITIONS`: every definition by site id (the conformance test checks one exists per registered site) |

Sites: [Workday](workday-adapter.md) and [Oracle](oracle-adapter.md) (their own drivers, `page.ts`, `fill.ts`,
`selectors.ts` and `widgets.ts` beside `site.ts`), and [Greenhouse, Lever and Ashby](sites.md) (a `site.ts` each,
on shared drivers).

**Why one engine.** The Workday and Oracle adapters were about 1,600 lines each, and most of each repeated the
other: the API, ids, sections, rows, errors and notices, the fill loop, next and back, the guard. What really
differs per site is the markup and a few widgets. Greenhouse, Lever and Ashby are 150 to 165 lines each.

**Why TypeScript, not data.** A definition is code: typed, able to hold a small function where a selector isn't
enough, tested like code, and bundled with the extension. It's never fetched remotely: Manifest V3 forbids
remote code, and whatever touches a form should be reviewed and tested.

**No generic definition.** There's no "plain HTML" definition that would run on any site: page kinds and the
submit test would be guesses there, and a guess about Submit is the one this project can't make. A site gets a
definition built from its own pages ([adding a site](../development.md#how-to)).

**No globals.** Event, observer, `File`, `DataTransfer` and element-prototype constructors come from the
element's own window (`win(node)`). The engine and drivers run the same in the page, in a jsdom test
environment, and in a jsdom window inside a Node test, which is how the companion's e2e tests drive them.

## The site definition (`SiteDefinition`)

| Part | Says |
|---|---|
| `info` | The site's [registry entry](protocol.md#the-site-registry-sitests): id, tenant, its waits |
| `widgets` | Its drivers. A field whose spot names none gets the first that recognises its container, so the more specific go first |
| `fields(doc)` | Every field in page order, as `FieldSpot`s: container, driver (optional), key, prompt (`label`), section title, required, and optionally automation id, help, error, profile hint |
| `addButtons(doc)` | `AddButtonSpot`s: element, key (`add.work-experience`, `save.languages`), label, section, and `kind`: `row` (adds a row of fields), `form` (opens an inline form), `save` (an inline form's Save) |
| `rows(doc, sections)` | Rows the page can delete (a section with its own delete button), and saved items (a section of its own with no fields: Oracle's tiles) |
| `page` | Page kind, step, step key (what changes on a move: index and title, or the URL), errors, notices, page actions and their buttons, next, back, button labels, `isSubmit`, and `job?` (the job the page says it's the application for: its title, a requisition it shows; the engine puts it in `FormSchema.job`, and the companion uses it to tell which posting a tab belongs to when its URL can't: [which posting](../mcp-tools.md#forms)). Every site has `job`: Workday's `jobTitleHeading`, Oracle's flow heading, the one-page sites' own title. A site whose pages show no title leaves it out |
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
([autofill](autofill.md), [checklist](companion.md)), so a new site needs no companion change.

## The API (`api.ts`)
`createAdapter(site, doc, getUrl)` returns `version`, `site`, `setTiming`, `getForm`, `listOptions`,
`searchOptions`, `fill`, `upload`, `remove`, `removeRepeatable`, `addRepeatable`, `next`, `back`, `pageAction`
and `blockedSubmitAttempts`. It keeps the field registry from the last extraction; a lookup whose element left
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
- **`next`:** refuses where `messages.refuseNext` says (review, confirmation; Oracle's sign-in), with no next
  button, and when the forward button submits. Otherwise presses it and waits (`stepMs`) for the step key to
  change or errors to show (only new ones, with `newErrorsOnly`); then the site's `afterStep`. `advanced` = step
  key or page kind changed. Notices go to `messages`, not `errors`.
- **`back`:** refused after submitting; presses the back button and waits for the step key to change.
- **`pageAction`:** presses the site's button for the action, then `afterAction`.

`install(site)` (each bundle's entry) defines `window.__ezapply_<site>` (non-enumerable) unless the same
`ADAPTER_VERSION` is already there. The build stamps that with a hash of the bundle
([builds](extension.md#builds-npm-run-build--w-ezapplyextension)); unbundled, in tests, it's `"dev"`.

## Widget drivers
A `WidgetDriver` is one kind of widget: `kind`, `is(container)`, `value`, and optionally `options`,
`lazyOptions`, `dateParts`, `multiple`, `fill(container, value, { strict })`, `list`, `search`, `remove`,
`upload`. Every fill acts, waits, reads back, and returns `{ ok, readBack, error?, availableOptions?, unmatched? }`.
A `strict` fill matches options only by `strictIndex` ([autofill](autofill.md#strict-matching)); a miss returns
the options seen.

### Shared drivers (`widgets/`)
| Driver | For |
|---|---|
| `textDriver(kind, selector?)` (`native.ts`) | Text, email, tel, url, number inputs and textareas: native setter past React's value tracker, blur, React's own handlers as a fallback. A phone number the page reformats counts when the digits match; a read-only input is refused |
| `passwordDriver` | Recognised so it's never taken for text; never filled |
| `selectDriver()` | A native `<select>`; an option with an empty value ("Select...") is the placeholder, not a choice |
| `radioDriver()`, `checkboxDriver()`, `checkboxGroupDriver()` | By their own labels (`choiceLabel`). A hidden input's label takes the click. The group fills exactly the options named and removes some |
| `dateInputDriver()` | Native `date` and `month` inputs, `YYYY-MM-DD` or `YYYY-MM` |
| `reactSelectDriver()` (`react-select.ts`) | react-select, through its own props ([below](#react-select-through-its-props)) |
| `toggleButtonsDriver(selector)` (`buttons.ts`) | A choice of `aria-pressed` buttons (Ashby's Yes / No), as a radio |
| `comboboxDriver({ input?, options?, value? })` (`combobox.ts`) | A search-as-you-type field (a location): types the value, waits for suggestions that differ from those before, chooses the match. No match → `unmatched` with the suggestions. By default the input is `role=combobox` and the suggestions the `role=option`s of its listbox |
| `fileDriver({ input?, names, removeButton?, multiple? })` (`file.ts`) | A file input (often hidden behind "Attach"): a `File` in a `DataTransfer` on the input, then a drop on the field. Done only when the page shows a **new** file of that name; removed by its own button |

**The combobox types a key too.** Lever's location field searches on keyup, not on input (seen live): setting
the value found nothing. The driver sets the value, then sends the last character as a key event. When a search
brings the same suggestions as the last one, the wait ends without a change and the suggestions on screen are
used; each is matched against the value anyway.

### react-select, through its props
react-select (Greenhouse, many React forms) is driven through the component itself: the fiber of its input leads
up to the component whose props hold `options`, `onChange`, `onMenuOpen` and `getOptionLabel`. `list` reads the
options without opening anything; `fill` calls `onChange` with the matching option (an array for a multi-select);
an async select is searched through `onInputChange`, then its options are read once they change; `remove` calls
`onChange` without the values.

**Why not clicks.** Seen live on Greenhouse: a synthetic mousedown never opens the menu unless the
page has focus, and the user's browser window usually hasn't while they type in their terminal. Choosing
through `onChange` needs no menu and no focus. **Why the alternate fiber.** React keeps two copies of each fiber;
the one stored on the node can be the old one. After a choice the page showed, reading from the stored copy gave
a null value. The node's props are always current, so the walk starts from whichever copy holds them.

### A site's own drivers
A widget no shared driver handles gets a driver in the site's folder: Workday's listbox dropdown, prompt
(typeahead with nested menus), split date and drop zone; Oracle's cx-select, date lists, pills and attachment
buttons. Workday and Oracle wrap their existing fillers and readers as drivers (`sites/<site>/widgets.ts`), so
none of their logic changed in the move.

## Waits, owned by the site
Each site owns its waits. Its registry entry (`SiteInfo.waits`, in `protocol/src/sites.ts`) gives every named wait
a value; today every site starts from `STANDARD_WAITS`, measured on Workday. Its definition's `waits` say what to
wait for after each field, row, step move and page action: `standardWaits` settles the page for as long as the
waits say; Workday's `afterStep` also waits (up to `stepFieldsMs`) for the new step's fields, since Workday moves
the progress bar before the step renders. The engine's loops never sleep on their own; they wait only through
these, and for their conditions as long as `T` says.

`createAdapter` loads the site's waits into `T` (`useSiteWaits`). The companion reads `autofill-timing.yaml` for
the tab's site ([format](../data-formats.md#autofill-timingyaml-companionsrcformstimingts)): a top-level key changes a wait on every site,
a key under the site's name (`workday:`) on that site only. It resolves them against the same site's waits and
sends the result with every call; `setTiming` applies it before the method runs, and `null` or none restores the
site's own. What each wait is for: [Workday's waits](workday-adapter.md#waits-autofill-timingyaml) and
`TIMING_DOCS` in `protocol/src/timing.ts`.

## Never submitting
- `next` never presses a submit control and refuses where the site says; no other call touches one.
- **Submit guard** (`installSubmitGuard(doc, site.page.isSubmit)`, once per document): capture-phase listeners for
  click, mouse and pointer down/up, Enter and Space, and `submit` cancel any **untrusted** (script-generated) event
  aimed at a submit control, and record it (`blockedSubmitAttempts`). Real user clicks are trusted and go through.
- Each site's `isSubmit`: Workday's and Oracle's own tests; Greenhouse, Lever and Ashby use `isSubmitByText`: a
  `type=submit` button or input, or a control reading "Submit", "Send", "Submit (my) application". On a one-page
  site Submit sits beside every field, so the guard's Enter case matters as much as the click.
- The conformance test checks, for every registered site, that the guard blocks a synthetic click and Enter on
  its Submit and that `next` doesn't press it.

## Tests
- **Golden schemas** (`golden.test.ts`, `test/golden/*.json`): `getForm()` of every Workday and Oracle fixture state
  and live snapshot, written before the two moved onto the engine. The ported adapters give the same JSON, apart
  from the new schema facts. `UPDATE_GOLDEN=1` rewrites them after an intended change.
- **Conformance** (`sites.test.ts`), for every registry site on a page of it (Workday's and Oracle's fixtures,
  the others' saved live pages): a definition, a bundle entry and a page exist; every wait is set; every field has
  a prompt and a kind; ids are the same on two reads; the guard blocks Submit by click and by Enter, and `next`
  never presses it.
- **Drivers** (`widgets.test.ts`) on minimal markup: each native control, react-select (with the stale stored
  fiber), toggle buttons, a combobox that searches on keyup, a file field.
- **Sites from live pages** (`sites-live.test.ts`): extraction from each saved Greenhouse, Lever and Ashby
  application.
- The Workday and Oracle behaviour tests and the companion's e2e tests run on `createAdapter` with their
  definitions (`test/adapters.ts`: `createWorkdayApi`, `createOracleApi`).

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

The script hardcodes this machine's paths, so it stays out of the repo until the adapter-building skill
(`todo.md`) gives it a home.
