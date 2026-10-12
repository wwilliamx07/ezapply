# Sites (`packages/extension/src/adapters/sites/`)

Eight sites, each a definition on the [adapter engine](adapters.md): a `site.ts` and a `main.ts` (its bundle entry), on
the shared drivers. This page holds only what each site does differently; what every site does the same (the API,
extraction, filling, option matching, moving, the submit guard, the waits, the shared drivers) is in
[adapters](adapters.md).
- [Workday](#workday-sitesworkday): steps, rows added and deleted, a review page; a dropdown, prompt and date of its
  own, so its definition is split over several files.
- [Oracle Recruiting Cloud](#oracle-recruiting-cloud-sitesoracle): one page or one section per page, items saved through
  inline forms; a list and date of its own, split the same way.
- Three hosted job boards, [Greenhouse](#greenhouse-sitesgreenhouse), [Lever](#lever-siteslever) and
  [Ashby](#ashby-sitesashby) (about 150 lines each), whose applications are **one page with Submit at the end**: no
  steps, rows or inline forms, `next` always refuses (Submit is the only way on), `back` has nowhere to go, and the
  schema says `lastPage: true`, so the agent fills the page and hands over to the user
  ([the hand-off](../flows.md#7-filling-the-application-fill-out-the-application)).
- [Phenom](#phenom-sitesphenom), an employer's careers site whose application has steps and rows, like Workday's.
- [Dayforce](#dayforce-sitesdayforce), a candidate portal whose application has steps and records saved one by one,
  like Oracle's items.
- [SAP SuccessFactors](#sap-successfactors-sitessuccessfactors), a career site whose application is one page, with
  rows of lists like Workday's and documents, and two widgets of its own (`widgets.ts`).

## Workday (`sites/workday/`)
**Pages.** `*.myworkdayjobs.com` and `*.myworkdaysite.com` (`isWorkdayUrl`, `protocol/src/workday.ts`). The
signature is Workday's UI widgets (`[data-uxi-widget-type]`) and the chrome every candidate page has
(`data-automation-id` `utilityButtonBar`, `accessibilitySkipToMainContent`), checked on every saved Workday page.
The **tenant** is the host's first label on myworkdayjobs.com, the segment after `recruiting` on myworkdaysite.com
(whose first label is just `wd5`). A multi-step application: a progress bar, Save and Continue, a review page.

| File | Holds |
|---|---|
| `site.ts` | The definition: the step key (index and title), rows, the wait for a new step's fields, messages |
| `page.ts` | Page kinds, fields (`workdayFields`), rows, add buttons, step, errors and notices, page actions, `isSubmitControl`, next and back |
| `widgets.ts` | `WORKDAY_WIDGETS`, in the order a field's kind is decided: file, date, prompt, dropdown, then the shared radio, checkbox group, checkbox, textarea, password, number and text drivers (labels by `optionLabel`, React's `onChange` as the fallback) |
| `dropdown.ts`, `typeahead.ts`, `date.ts` | Workday's own widgets (below) |
| `remove.ts` | Taking chips and attached files off (`removeItems`), confirming a delete dialog (`confirmRemoval`, the rows' too) |
| `selectors.ts` | Every Workday string of the adapter: `data-automation-id` hooks (several candidates each, since tenants and releases vary) and `PROFILE_HINTS` (`legalNameFirstName` → `identity.firstName`) |

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
  "success(fully)" and nothing like fail, error, could not, invalid or required go to `messages`. Workday announces
  "resume.pdf successfully uploaded" in the same region; read as an error, it showed in `go_next` and on the file
  field, and ended `next`'s wait before the page had moved.
- **Removable rows:** a section whose first field sits in a row with its own delete button, outside any field, in
  an ancestor holding no other section's fields (so a file's delete button doesn't count, nor a page-wide one). Live,
  that button is a plain "Delete" with a trash icon in a `role="group"` labelled by the row's heading, with no
  automation id or label, so it's found by the icon (`button:has(.wd-icon-trash)`); `panel-set-delete-button`,
  `deleteButton` and "Delete…" were guesses that matched nothing live, kept as fallbacks. Removing a row renumbers
  the rows after it.

**Moving.** Live step titles are often all "Application", so the step key is the progress bar's index and title:
comparing titles alone reported every move as none, and Back waited out 12 s each time. After a move the definition
waits (up to `stepFieldsMs`, 3 s) for the new step to show a field, since Workday moves the progress bar before it
renders the step: a read straight after the move (now `go_next`'s own `form`) found an empty step, which with `onlyEmpty` looks like a step
with nothing left to fill. The review page has no fields and isn't waited for. Back (`bottom-navigation-previous-button`,
`pageFooterBackButton`, `wd-CommandButton_back`, else a button reading Back or Previous) works from any step,
review included, to correct an answer; what Workday keeps of unsaved entries on the step left isn't known, so the
skill re-checks steps when coming forward. `isSubmitControl`: "Submit" / "Submit Application", or the forward
button while the active step is Review, whatever it reads; `next` refuses on review and confirmation.

**Files and removal.** The shared file driver, with Workday's drop zone (through React's `onDrop` first) and its
attached files: the `file-upload-item-name` elements with their row, or the rows when a tenant has no name
element (a row and its name both match the file hooks, which listed every file twice). Workday pre-fills skills
and files from the candidate's last application, so prompts and file fields can be cleared: each item's remove
control (`DELETE_charm` or a delete/remove button on a chip, `delete-file` in a file row), then a delete/remove
dialog's confirm, then React's `onClick`, then Delete and Backspace on the focused chip, each confirmed by the
count dropping. Those hooks haven't been pressed live; the fixture has chips with charms, one removable only by
keyboard, and a file and rows whose delete asks for confirmation.

### Workday's dropdown: finding its listbox
A button opening a listbox rendered as a portal under `body` (`dropdown.ts`). Live Workday gives the button no
usable `aria-controls`, and a closed listbox stays on screen while it animates away, so "the visible listbox" right
after one dropdown was the previous one's: in the first real application almost every first attempt read the
wrong options. So:
- Only listboxes outside any `formField-` container count (a list of selected items inside a field isn't one).
- Before opening, wait (up to `dropdownOthersClosedMs`) for none to be visible, pressing Escape on any left.
- After the press, take `aria-controls`' target, else a listbox that wasn't visible before, or one whose options
  changed (a reused portal); none → React's `onClick`; still none → wait for the page to go quiet and open once more.
- The choice is checked against the button's label, with React's `onClick` on the option as the fallback.
- **Closing.** After a choice the list closes by itself and the driver waits until it's gone. Without one
  (`list_options`, a miss) it must be closed: Escape on the button, then, if the button has no `aria-expanded` and the
  list is still there after `dropdownEscapeCloseMs`, a press on the button, as a person would. A button without
  `aria-expanded` is never pressed after a choice: a list still animating away would open again.

**Why the press and the second open.** Live buttons have no `aria-expanded` and Escape doesn't close a live
listbox, so a list read without a choice stayed open and the next dropdown's press only closed it: "Could not open
the dropdown" on 9 fields of one run. With the press, two later runs still failed 12 dropdowns, every one a dropdown
whose own list had been read without a choice, and the agent's next call filled each at once. Why the first open
fails isn't known, so the driver does what worked: it tries again. The fixture models this (`liveDropdowns`:
lingering portals, no `aria-expanded`, Escape closing nothing; `dismissedIgnoresNextPress`), and its tests fail on
the old logic. A dropdown that can't be opened at all costs its open waits twice.

### Workday's prompt: searches and lists
A search-as-you-type multi-select (`multiSelectContainer`, options in a `wd-popup`; `typeahead.ts`), single- or
multi-select, sometimes with nested menus, chosen values shown as chips. Each value is selected on its own: one
matching nothing goes to `unmatched` with the options its search showed while the rest are still selected (a skills
list once stopped at its first miss); one Workday chose itself on Enter (single-select prompts do) goes to
`inexact`; one chosen but not kept is named in the error, not `unmatched`, so the agent doesn't look for other
wordings of an option it found. `"Job Board > LinkedIn"` walks nested menus. Values already selected are skipped.
- **Waiting for results.** Typing waits until the options differ from those before and one of them holds the query
  (`answersQuery`; every 100 ms, up to `typeaheadResultsMs`, then once more after React's Enter handler), or until
  "No Items." has stayed for `typeaheadNoResultsMs` (it also shows while results load). Reading once the DOM went
  quiet returned the previous query's results, one call behind. **Why the query must show:** on a hierarchical
  prompt (a field of study under "All" and "Partial List…") the category menu rendered just after the query was
  typed and was read as the results. Results that hold no part of the query now cost the full wait and its retry,
  about 6 s.
- **Checkbox lists.** Some multi-selects tick each option (`promptLeafNode` with `data-automation-checked`), stay
  open on a press, toggle on every press, and tick a search's only result themselves on Enter; pressing it then
  unticked it (live: skills and a citizenship selected, then unselected). An option already selected (its chip, or
  `Checked`) isn't pressed; the trace notes `selected on Enter`.
- **Each option once.** Both option hooks (`promptOption`, `promptLeafNode`) match one live option, one inside the
  other; the innermost is kept, so matches aren't made ambiguous by duplicates. "No Items." is never an option.

### Dates typed into Workday's split widget
A Month, Day and Year part (any of them), each its own input (`date.ts`). Workday's parts keep their value in their
own state: setting the inputs' values showed the digits while Workday called the date empty, however often it was
filled. So each part is entered as a person does: pressed (its display element when there is one), focused, the
digits typed with `typeChar`, then a browser-style `change`; only if it still doesn't hold the value is it set
directly. **What a part holds** is read from its display element (`…-display`, showing "06" while the input holds
"6"), else `aria-valuenow`, else the input, so a value the widget didn't take reads as empty in the fill result and
in `get_form`. When the field still shows an error after the parts are entered, they're entered once more (a date
was seen taken on the second entry). Parts that don't read back the value fail with the date for the user to type;
parts that do while the field shows an error stay `ok` with "Filled, but the page reports: …". The fixture's
`dateWidget: "keys"` (digits only in keydown) and `"stuck"` (synthetic keys ignored) model both cases.

Typing worked on live tenants, and failed once in a run whose browser window may have been behind the terminal: every
multi-part date read back right while Workday called it required. The next run, with the window in front, took
every date. So the application tab now runs under focus emulation, which gives the page focus wherever its window
is ([the tab at full speed](../mcp-tools.md#forms)), and debug mode records `focused` and the date's `date part set directly` and `date
entered again` branches, to settle it.

**Tests.** The behavioural fixture (`test/workday-fixture.ts`) is the one model of a Workday step: the adapter tests
use it in jsdom, and the companion's e2e tests run the real adapter on it behind a fake extension, so a new
behaviour needs one fixture change, not two fakes. Live snapshots are in `test/fixtures/live/`.

## Oracle Recruiting Cloud (`sites/oracle/`)
**Pages.** Oracle's Candidate Experience, on the employer's Oracle Cloud host
(`<pod>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123`) or, as often, its own domain
(`jobs.example.com/en/sites/CX_1/job/123`). The host says nothing, so the signature is the Candidate Experience's
components (`apply-flow`, `apply-flow-block`, `apply-flow-header`), its dialogs (`.app-dialog__wrapper.oj-dialog-body`)
and its scripts' path (`/hcmUI/CandidateExperience/`). Where no page can be read, `isOracleUrl` goes by the path:
https, an optional `hcmUI/CandidateExperience`, a language, `sites/<site number>`, then `job`, `jobs`,
`requisitions` or `my-profile`. The **tenant** is host plus site number, lowercased (`jobs.example.com/cx_1`);
a page told Oracle's by its body on a URL of another shape has neither tenant nor job, and its tab is matched by its
binding or what the page shows. The pages are Knockout components with React widgets inside.

| File | Holds |
|---|---|
| `site.ts` | The definition: the step key (URL and step), repeat rules (a timeline entry's delete button shown by hovering, an inline form's errors), fill rules (page order, stale errors, scroll before upload, new errors only), messages |
| `page.ts` | Page kinds, fields (`oracleFields`, each row's widget by `rowWidget`), saved items, add and Save buttons, step and job, errors and notices, page actions, `isSubmitControl`, next and back |
| `widgets.ts` | `ORACLE_WIDGETS` by widget name: date, list, pills (the shared toggle buttons, single or several), the shared radio, checkbox group, checkbox, text, number, textarea, password and file drivers with Oracle's labels, leaving and removal, and widgets it can't drive |
| `combo.ts`, `date.ts` | Oracle's own widgets (below) |
| `selectors.ts` | Every Oracle string of the adapter: class hooks, button texts (`TEXT`), `PROFILE_HINTS` (EEO questions by Oracle's codes, `…ORA_GENDER…` → `eeo.gender`) |

**Page kinds**, in order: **confirmation** (no flow, no fields, and a `/thank-you` URL or "thank you for applying",
"application submitted", "you have applied"); **auth** (a password or one-time-code input, the email verification,
or `/apply/email`: applying starts with an email step, then for a known address a code sent to it, both the user's;
`next` refuses there); **start-choice** ("Welcome Back" with Use My Profile); **step** (a section of the flow, or any
fields); **posting** (Apply / Apply Now outside the flow); else **unknown**. There's no review page: the forward
button is Submit on the last section, so no posting reaches `filled` on Oracle. Page actions: `apply`,
`use_last_application` (Use My Profile).

**The flow** is sections (`.apply-flow-section`), each of blocks (`apply-flow-block`: "Contact Information",
"Address"…), each of rows. A site shows either **every section on one page**, with Submit the only button (`step.title`
joins the section titles; `go_next` refuses, the agent fills everything and hands over), or **one section per page**
with Next (`applyFlowPaginationNextButton`) and Previous, and "step 2 of 4" from the flow's hidden heading (from the
page's templates, not seen live). The job is that heading's part before "application, step"; worded otherwise (another
language), none. The "Import your profile" pre-section is left out.

**Fields.** Each visible innermost `.input-row`; the phone row gives `phoneCountryCode` (a list) and `phoneNumber`;
agreement checkboxes outside rows and the attachment buttons are fields too. Keys are the control's id without
Knockout's render counter (`lastName-39` → `lastName`), which changes whenever the form re-renders; screening
questions, keyed by long numbers, take the label's slug. A read-only field (the email from the sign-in) says so in
its help text. **Never offered:** the email step's honeypot, a text field hidden from people (`input-row--invisible`,
`aria-hidden`) that marks whoever fills it as a bot. Widgets it can't drive yet (the preferred-locations multi-select,
Oracle JET comboboxes) are reported as `typeahead`, and filling one says to ask the user: typing into their inputs
chooses nothing. Notices ("Uploading", "Done", the "Saved" after an inline item) go to `messages`; an alert region
whose content is all hidden (a closed dialog's) is skipped.

**Filling** goes in page order (`fill.order: "page"`) whatever order the fills came in, since the address lists
depend on each other (country → province → city → postal code). A list's "required" error lingers until the page
validates again, so fields filled but still showing one get up to `afterFieldMaxMs` for it to clear
(`waitForStaleErrors`). Text is set without React's fallback, and focus really leaves the input: Knockout's bindings
read the input on change and on input. Single-choice pills unselect themselves when pressed again, so a pill is
pressed only when it must change. A date is three lists, the month matched by name ("April", "Apr") or number, the
day with or without its zero.

**Attachments and items.** The resume and cover letter buttons hold one file each; while one is shown its input is
gone, so an upload says to remove it first. Additional documents take several. Files are dropped on their upload
button when setting the input didn't take, and removed by their button, confirming a dialog. Work and education (a
timeline), languages and licenses (tiles) are added through an inline form: `add.language` opens it, the agent fills
it, and `save.languages` presses its Save (`profileItemInlineSaveButton`, `addTimelineItemDialogButton`), which
succeeds once the form closes or returns the block's errors. Add Another Link adds a row at once. A saved item is a
section of its own (`languages.item-1` "Languages: French, Fluent"), deleted by its button; a timeline entry shows
its button only while hovered, so it's hovered first. An empty block shows only its add button, so the apply skill
matches every add button's section to the profile.

**Submit** (`isSubmitControl`): the pagination's submit button (`.apply-flow-pagination__submit-button`) or a control
reading "Submit" / "Submit Application". The email step's Next isn't one. Button texts are matched in English; the
class hooks work in any language, and Submit is also known by its class.

### Oracle's list: searching it
cx-select (`combo.ts`), also each part of a date. Opening focuses and presses the input (the widget loads every
option), else its arrow button, else React's handler; a list that still hasn't shown is searched anyway (a school list
didn't show within the open waits while a search found it). An option matching the value is pressed; else the value
is typed, then its part before the first comma (a postal-code search finds "K2K 3E9" but not "K2K 3E9, Kanata,
Ontario"). The read-back is what the input shows once focus leaves, which may be the start of the option's label
("Kanata, Ontario" shows "Kanata"); leaving also puts back typed text the list didn't take, so what shows is the
choice. Nothing matches: the options go back and the widget restores its value. An auto-suggest field keeps typed text.
- **Its traps,** from the widget's code: Escape on a **closed** list clears the value, so Escape goes only to an open
  one; it searches only while its input has focus; another open list is closed first. And from a live run: choosing a
  province re-renders the city list, replacing its input, so the input is looked up again by id when the one held has
  left the page.
- **Waiting for a search** (`typeQuery`): for options that differ from those before, one holding the value
  (`answersQuery`), or for "no results" not already showing. None → clear the text, wait `typeaheadClearMs`, type it
  again, wait once more (`typeahead search again`). **Why:** the address lists open on "no results" while loading;
  typing re-renders the whole unfiltered list at once and the server search runs about half a second later. Taking
  that re-render for the results closed the list and dropped the search, and since the widget searches only when its
  text changes, every later attempt with the same value searched nothing. The clear's wait must outlast the widget's
  own delay before it searches. Results that don't hold the value cost both waits, about 9 s.

### Oracle: what was verified
- **Live, headless:** a job page (`posting`, Apply, tenant) and the email step (`auth`, honeypot left out), saved as
  `oracle-posting.html` and `oracle-email.html`.
- **A saved single-page application** (`oracle-apply.html`, employer and personal details replaced): all 46 fields
  with kinds, ids, hints and options. The behavioural fixture (`test/oracle-fixture.ts`) is built from it and the
  bundle's templates: every widget, dependent lists, the Escape trap, uploads and removals, inline forms and Save,
  tile and timeline deletes, the multi-page flow, the guard; the companion's e2e tests run on it too.
- **Real applications:** text, pills, native radios, dates, lists, uploads, and education and work entries through
  the inline form were filled. Their failures (a city shown shorter than its option, the re-rendered city input, the
  postal code by its full label, a reformatted phone number, stale errors, "Saved" as an error, then the address and
  school lists' late search) are fixed and reproduced by the fixture, whose tests fail on the old logic. A Cover
  Letter field missing from `get_form` on one page is unexplained.
- **Not yet live:** language and license tiles, deletes, the multi-page flow, the confirmation page.

## Why these three
Sites were chosen by how often employers use them, not by the user's own postings. Published market-share
counts (2025–2026, e.g. voronoiapp's ATS share and ERE's ATS reports) put Workday, Taleo, SuccessFactors, iCIMS,
Greenhouse, SmartRecruiters, Lever and BrassRing at the top, with Ashby rising among newer companies. Of those
that weren't built yet, Greenhouse, Lever and Ashby have public application pages anyone can open, so they could
be built from real markup and checked live without an account. The others couldn't:

| Provider | Why not yet |
|---|---|
| iCIMS | Blocks headless browsers; its application sits behind a candidate account |
| SmartRecruiters | Bot protection (DataDome) on its application pages. Not worked around, on purpose |
| Taleo, BrassRing | The application is behind a candidate account on each employer's site |

Each needs pages the user saves from a real application in their own browser. None is planned yet. SuccessFactors was
in this list too; it was built from such a page ([below](#sap-successfactors-sitessuccessfactors)).

## What the three boards share
- **Registry entries** (`protocol/src/sites.ts`, URL rules in `greenhouse.ts`, `lever.ts`, `ashby.ts`): https
  only; the board's company as tenant and its posting as job, both lowercased. Standard waits.
- **Signatures**, what tells the board's pages by their body ([telling a page's
  site](extension.md#telling-a-pages-site-framests)), each the board's own markup and not the embed script or
  links a careers page around it has: Greenhouse's `.job-post-container` or
  `form#application-form .application--questions`; Lever's `.posting-categories .posting-category`,
  `form#application-form .application-question` or `a.postings-btn`; Ashby's `[class*='ashby-application-form']`
  or `[class*='ashby-job-posting']`. The URL rules still decide where no page can be read, and the boards' own
  hosts match them anyway.
- **Page kinds** (`singlePageKind`): a page with fields is a `step`; without, a page saying thanks is the
  `confirmation`, one with an Apply button is the `posting` (its `apply` action presses it); else `unknown`.
- **Submit** is `isSubmitByText`: a `type=submit` control, or one reading "Submit (application)" or "Send". It's
  the page's `next`, so `nextLabel` shows it, and the guard blocks any synthetic press of it.
- **The job title** is the page's own title, which is also the step's (`titledJob`): Greenhouse's
  `.job__title h1`, Lever's `.posting-header h2` (the application page; `.posting-headline h2` on the posting's),
  Ashby's `h1`. Read on each live snapshot. At first Lever looked only for `.posting-headline`, which
  the application page doesn't have, so its step was titled "Application".
- **Embedded boards:** a company's careers page that names a Greenhouse job in its URL (`?gh_jid=`,
  `hostPageJob`) ties the posting captured there to that job, so its application is told apart from others
  ([which posting](../mcp-tools.md#forms)).
- **Messages** (`singlePageMessages`): `go_next` says the whole application is on this page and the user reviews it
  and presses Submit.
- **Hints** for the fields every board asks: name, email, phone, links. Lever's and Ashby's name is one field;
  its hint `identity.fullName` makes the planner join first, middle and last name. A location hint is
  `contact.address.city`, filled with the adapter's own (loose) match like every city: a city alone can match
  several places, and then nothing is chosen and the suggestions go back to the agent.

## Greenhouse (`sites/greenhouse/`)
**Pages.** `job-boards.greenhouse.io/<board>/jobs/<id>`, the older `boards.greenhouse.io`, the EU hosts
(`job-boards.eu.greenhouse.io`), and the embed a company's careers page loads in a frame
(`…/embed/job_app?for=<board>&token=<id>`). The posting and the form share one page. An embed is Greenhouse
whether it's the tab's own URL or a frame inside a company's careers page; in a frame the form tools act on it
there ([embedded applications](extension.md#embedded-applications)), with its board from `for` and its job from
`token`.

**Fields**, in the form (`form#application-form`), in page order:
- `.text-input-wrapper`: a text input or textarea;
- `.select__container`: a react-select list ([driven through its props](adapters.md#react-select-through-its-props));
  the phone's country list is one. Three load as you type: Location (City) (`candidate-location`, no `loadOptions`:
  the page fetches from its location provider on `onInputChange` and confirms a choice with it), and the education
  block's School and Discipline (`school--N`, `discipline--N`: react-select-async-paginate over the board's
  education API, a 300 ms debounce). Greenhouse's select wrapper holds `menuIsOpen` itself, opened by a key-up in the
  control and closed by Escape, a choice or blur, so the adapter gives the driver `menu`: it calls the props'
  `onKeyUp` with `KeyA` or `Escape` (read from the board's bundle). Without the menu open, School and Discipline
  never load;
- `.file-upload`: resume and cover letter, file names from `.file-upload__filename`, removed by its
  "Remove file" button;
- `fieldset`s (not the phone's): radios, a checkbox group, or a lone checkbox.

Prompts are the controls' labels (`promptOf`), help text the `<id>-description` element, errors `aria-invalid` with
its message or `#<id>-error`. Required: `aria-required`, or a required mark in the label. Ids go through
`cssEscape` before they're put in a selector: a multi-select's id ends in `[]` (`question_38624172002[]`), which
is not a valid CSS identifier as written.

**Ids.** Greenhouse's own fields by control id (`application.first_name`); its custom questions, keyed by long
numbers (`question_38624172002`), by the prompt's slug, which reads better and is as stable. Section: the heading
before the field within the form (the EEO block's "Voluntary Self-Identification"), else "Application".

**Hints** by id: names, email, phone, the phone's country (`contact.phone.countryCode`), and the EEO fields
(gender, Hispanic or Latino, race, veteran status, disability); by prompt: LinkedIn, GitHub, website or
portfolio. The country list's options are "Canada +1": the option match takes "Canada" for it
([drivers](adapters.md#widget-drivers)).

## Lever (`sites/lever/`)
**Pages.** `jobs.lever.co/<company>/<posting id>` (and `jobs.eu.lever.co`), with the application on `…/apply`.
The canonical path drops `/apply`, so a capture of the application is the posting's.

**Fields.** Each `.application-question` in `form#application-form`, its prompt the `.application-label` (a custom
question's `.text`) without the "✱" required mark. A lone checkbox with no question label (a consent) takes its
own label as the prompt. Drivers, in the order that decides a question's kind: file, the location search
(`input.location-input`, suggestions in `.dropdown-results`), native select, radio group, checkbox group,
checkbox, textarea, text. Required: the `.required` mark or the control's `required`.

**Ids.** Lever's own fields by name (`name`, `email`, `urls[GitHub]` as `urls-github`); custom cards and survey questions
(`cards[<uuid>][field0]`, `surveysResponses[<uuid>]…`) by the prompt's slug. Section: the `h4` before the question
(the cards' titles).

**Hints** by name: `name` (full name), `email`, `phone`, `location` (city), and the LinkedIn, GitHub and
Portfolio URLs.

**The location field searches on keyup** (seen live): the combobox driver sends a key after setting the value.

## Ashby (`sites/ashby/`)
**Pages.** `jobs.ashbyhq.com/<organization>/<job id>`, the application under the Application tab
(`…/application`, dropped from the canonical path). A React page with stable class names.

**Fields.** Each element with a `data-field-path` (the outermost, when one sits in another); prompt from its
question title or label. Drivers, in order: file, the location combobox, textarea, text, Yes/No toggle buttons
(`aria-pressed`; they hide a checkbox, so they come before checkboxes), radio group, checkbox group, checkbox.
Required: the control's `required`, a heading label with Ashby's required class (`_required_<hash>`: a group's
inputs carry no `required`), or a trailing `*`.

**Why the path, not the class.** Most questions are `.ashby-application-form-field-entry`, but a radio or
checkbox group is a plain `div[data-field-path]` around a fieldset with classes of its own. The definition first
went by the class, built from one page that had no such groups, and in the first real application
(another employer's form) it missed all seven: "Degree Type", "How many prior internships", the work, cohort and
location choices, sponsorship and the office question. The agent then filled two of them by ids it guessed from a
screenshot, which failed as unknown fields. `ashby-groups.html` (that page, employer details replaced) now keeps it covered.

**Ids.** Ashby's own fields by their path without the prefix (`_systemfield_email` → `application.email`); a board's
questions by the prompt's slug. Everything is in one section, "Application".

**The texting consent.** An entry holding a phone number may also hold "may we text you?" with Yes and No radios.
The entry is the phone field (text comes before radio in the order); the consent is a field of its own,
`application.texting-consent`, its prompt the consent text (`.ashby-application-form-texting-consent-description`).

**Hints** by path: name (full name), email, location (city); by prompt: phone, LinkedIn, GitHub, website.

## Phenom (`sites/phenom/`)
**Why.** Phenom People runs many employers' careers sites on their own domains (`jobs.example.com`). Their
application is Phenom's own multi-step form on that domain, which sends what's entered on to the employer's ATS,
often Workday. It can look like a Workday form, but nothing on the page is a Workday URL, as a tab or a frame, so
the form tools found no application there, and the Workday adapter couldn't have read its markup anyway.

**Pages.** The posting is `…/<region>/<lang>/job/<id>/<slug>` (`/ca/en/`, `/global/en/`…), and its Apply button
(`a[data-ph-at-id=apply-link]`) goes to `…/hvhapply?jobSeqNo=<job>`, which redirects to the flow,
`…/apply?jobSeqNo=<job>&step=<n>&stepname=<id>`.

**Telling it.** Every page of a Phenom site is known by its body ([telling a page's
site](extension.md#telling-a-pages-site-framests)): the signature is its apply flow's containers
(`.phenom-form-container`, `.ph-apply-box`), the `data-ph-at-id` hooks on every page of the site, and its CDN
(`phenompeople.com` scripts and stylesheets). It's checked on every saved Phenom step, and held on live Phenom job
and apply pages under both `/ca/en/` and `/global/en/`. So the job page is `phenom` too, and
the adapter reports it as a `posting` with an Apply action, as on Workday. The URL rule, for where no page can be
read (a captured page's Apply link, canonical URLs), takes an apply page by its last path segment (`apply` or
`hvhapply`) with a `jobSeqNo`, https, any host, whatever comes before it: sites put a region (`global`) where
others put a country, so a rule that expects a two-letter country misses them. The job page's URL shape is too
generic to count. A posting captured on the job page is tied to its application by that Apply link
(`postings/application.ts`), and the canonical URL keeps `jobSeqNo` and treats `hvhapply` as `apply`, so a capture
on any step is the same posting. Tenant: the careers host, on any of its pages. Job: `jobSeqNo`, lowercased, which
only the apply pages name (the job page's own `…/job/<id>/` is another id).

**One job, two ids.** `jobSeqNo` embeds the requisition the job page and the application show
(`EXAMGLOBAL1000001EXTERNALENGLOBAL` holds `1000001`, `GLOBA0001R0000000001EXTERNALENCA` holds `R-0000000001`), so
Phenom's registry entry has its own `sameJob` (`phenomSameJob`): the two are one job when one holds the other's
letters and digits, the shorter has a digit and four characters, and a digit at either end doesn't run on into a
digit of the longer. Verified against a live tenant, where it mattered twice: a job page lists similar jobs with
their own Apply links, so the capture found several applications and, comparing the posting's `reqId` exactly,
chose none; then the apply tab's `jobSeqNo` was compared with that `reqId` and the tab refused as another job's
(`postingMismatch`) until the user bound it. The rule is Phenom's alone: on other sites a loose comparison could
take `jr123` for `r123`.

**Steps.** A step bar of `li[atm-id]`, the current one `aria-current="step"`; seen live: `personalInformation`
(My information), `workAndEducation` (My experience), `jobSpecificQuestions` (Application questions),
`applicationQuestionnaire` (Additional application questions), `applicantAcknowledgment` (Terms & Conditions),
`applicationReview` (Review, the `review` page kind). The step key is the step's id and the URL. Next is
`button#next` and Previous `button#previous`. Opening a step by its URL sends the browser back to step 1, so every
step is reached through Next. Next saves the step to the employer's system before the next one shows (5 to 15 s
live), so Phenom's `stepMs` is 30 s.

**Submit by its words.** Phenom's Next is a `type=submit` button, so `isSubmitByText` (which counts every
`type=submit`) would have made the guard block it. Phenom's `isSubmit` goes by the control's text, `aria-label` or
value ("Submit", "Submit application"). The page's own `submit` event, which a press of Next fires, is trusted, so
the guard lets it through. The Review step's Submit wasn't seen.

**Fields.** Each step is a react-jsonschema-form (`form.rjsf`). Every control has an id that is its path in the
form's data (`cntryFields.firstName`, `experienceData[0].fromTo.startDate`, `jsqData.<questionnaire>.a_dot_a`) and
a `label[for]` (a wrapping label for the language row's "native" box, `aria-label` for "I currently work here").
A field's container is its nearest `.form-group`, except "I currently work here", which sits beside the dates. The
driver goes by the control:
- a react-datepicker month picker (work dates): `monthPickerDriver` ([shared drivers](adapters.md#shared-drivers-widgets)).
  Its input takes no typing: a typed value, even from trusted keys, was put back at once live, so the calendar is
  driven (the year from its header's list, then the month). The years on offer are only those the page allows (from
  the start date to today), and a refusal names them;
- the school (`role=combobox`, react-bootstrap-typeahead): the combobox driver; its suggestions are `role=option`s;
- native selects: the select driver, `settled`. Phenom's lists put the old value back at once and take the new one a
  moment later (seen live), so the driver waits for the read-back rather than calling React's handler, which by then
  reads the old value;
- a native `date` input (the questionnaire's start date), a lone checkbox (an agreement, "I currently work here"),
  text;
- a question with options, radios or several checkboxes: one field, `radioDriver` or `checkboxGroupDriver`, whose
  container is the options' own box (react-jsonschema-form's `.field-radio-group` or `.checkboxes`, else a
  `role=radiogroup` or `role=group`, else the `.form-group` holding them) and whose label is the question (the
  box's `label[for]`, else the group's label that wraps no option, else the fieldset's legend). Its key is the box's
  id when that reads as a name, else the question's slug. Why: read one input at a time, each option was a field
  whose container was the whole `.form-group`, so the checkbox driver read and ticked the first option whatever was
  asked (on a live tenant, an education question answered "High School Diploma/GED" ticked "Doctorate", and every
  option read as ticked), radios fell to the text driver (required text fields labelled "Yes" and "No"), and the
  question was never read. No saved Phenom page has such a question: the markup is react-jsonschema-form's, tested
  on it added to step 3, plus radios straight in the group with ids ending in their option, as the live step 1 read;
- the resume, above the form on every step (`.resume-section`: a hidden file input behind "Upload resume", the file's
  name from its download link `.has-resume a.downloadFile`), and "Additional attachments" on step 2. The name is the
  link's `download` attribute, else the `fileName` in its URL, else its `aria-label` after "Download", else its
  text: a live tenant's link read only "Download", so every upload looked missing (though the page had parsed the
  resume into the fields) and the checklist offered "Download" for removal.

**Ids and sections.** A row's fields are a section of their own, named from the list's description ("Work
experience :", else its "Add …" legend) and the row's place: `work-experience-1`, `education-1`, `languages-1`,
so the checklist matches them to the profile's lists by title, as Workday's. A row with a "−" button
(`button.array-button-remove`) is removable, and each list's "+ Add" (`button.array-button-add`) is
`add.<list>`. Other fields take the nearest legend that reads as a heading ("Skills :"), else the step's title (the
others are data paths: `cntryFields`, `jsqData`). A field labelled by its instruction alone under such a heading
gets the heading in front ("Skills: Separate each skill with a comma."). The key is the id's last part when it
reads as a name (`firstName`, `listening`), else the prompt's slug (a questionnaire's `a`, `a_dot_a`).

**Dependent fields** appear as earlier ones are answered (the region list after the country, a source's details
after "How did you hear about us?", a follow-up after "Yes"), so fills go in page order.

**Hints**, outside rows, by the id's last part: first, middle and last name, address lines, city, region, postal code,
email, country, the phone's country code, number and device type.

**Errors:** the list at the top of the form after a refused Next (`.error-msg .errorList li`), and each field's own
(`#<id>-errorMsg`).

**The resume on step 1.** Step 1 won't go on without one, and says so in a native `alert`, which stops the page (and
any script waiting on it) until it's dismissed. So `next` refuses there while no resume is attached
(`nextBlocked`), and says to upload it first. Attaching it sends it to the employer's system, which parses it into
the fields: the agent checks what the parse filled.

## Dayforce (`sites/dayforce/`)
**Why.** Dayforce (formerly Ceridian) is an HCM suite whose candidate portal hosts many employers' applications.
Its newer portal is one host for every employer, a Next.js app on Ant Design.

**Pages.** `jobs.dayforcehcm.com/<locale>/<client>/<career site>/jobs/<id>` is the posting, and the application is
under it (`…/jobs/<id>/apply/manualApplication?applicationSource=Manual`). The locale (`en-US`, `zh-Hans`, `es-419`:
every locale the portal offers has a dash) is optional; the page's own links sometimes leave it out. `<client>` is the
employer's namespace on Dayforce, and `<id>` its posting id, numbered per client. The URL stays the same through the
steps.

**Registry** (`protocol/src/dayforce.ts`): the URL rule takes an https `*.dayforcehcm.com` path with `jobs/<digits>`
after the client and career site, with or without a locale. Where `jobs` sits says whether the first segment is a
locale, since a client namespace can be as short as a language code. The older portal
(`<cluster>.dayforcehcm.com/CandidatePortal/…`) is another app with other markup, and its paths don't match. Tenant:
the client namespace, lowercased (on a page known by its body whose path isn't a job's, the first segment after a
locale). Job: the posting id. Canonical path: from the client to the id, without the locale or the application's
path, so the posting and its application are one posting. **Signature:** the portal's own `test-id` hooks (it uses
`test-id`, not `data-testid`): the job header (`job-details-header`), the step bar
(`application-progress-step-*`) and Next on the application; the header's Search Jobs link and the session-expiry
dialog on every page; and scripts from `static.dayforcehcm.com`. **Waits**, not measured, longer where Dayforce's
server answers first: `uploadMs` 30 s (a resume is uploaded and parsed before the list shows it, and the file
driver's drop after `uploadMs` would send it a second time), `addRowMs` 15 s (an Update saves the record to the
candidate's profile before its form closes), `stepMs` 30 s (Next checks the step on the server).

**Steps.** A step bar (`[test-id^='application-progress-step-']`, the current one `aria-current="step"`): Candidate
Info, Questionnaire, Submit, from the employer's template (an assessment step can be among them). The step's title is
`application-step-title`; on the questionnaire, "Questionnaire 2 of 3" (`questionnaire-progress`) is added, since
Next goes through its questionnaires one page each. The step key is the current step's hook, that progress and the
URL. Next is `application-next-step`, Previous `application-previous-step`.

**Fields.** Each step is part of one antd form (`#jobPostingApplication`). Every visible `.ant-form-item` with a
control is a field (a control nested in another item, a questionnaire's follow-up, belongs to its own item). Its
prompt is the item's label (or its `title`, the control's `aria-label`, a radio group's legend, a checkbox's own
text); required is antd's `ant-form-item-required` on the label or `aria-required`; its error is
`.ant-form-item-explain-error`. The driver goes by what the item holds:
- an antd Select (every list: prefix, country, province, source, questionnaire dropdowns):
  [`antSelectDriver`](adapters.md#ant-designs-select-through-rc-selects-context), through rc-select's context.
  A list that can't be searched keeps a read-only search box, which isn't a read-only field;
- a phone number: a compact group of a dialling-code list and the number, read as two fields (`mobilePhoneCountryCode`
  and `mobilePhone`; the list has no id of its own). The dialling codes' labels are React elements (a flag, `+1`,
  the country), read as "🇨🇦 +1 Canada", which the option match takes "Canada" for
  ([drivers](adapters.md#widget-drivers));
- radio groups, checkbox groups and single checkboxes (antd's, with native inputs inside their labels), native
  `date` inputs (a record's dates), textareas, antd's number input, text;
- files: the resume ("Resume Upload"), cover letter and additional documents, each an antd Upload under its own
  heading, named by it. A file counts once it's uploaded (an entry that's uploading or failed doesn't), and comes off
  by its delete button. The **Import Resume** above Personal Information is left out: it takes the same file
  (`files.resume`) and only differs in where it sits.

**Ids and sections.** Every control's id is its path in the form (`jobPostingApplication_personalInfo_firstName`,
`…_workHistory_0_title`, `…_sections_0_questionnaire_questions_2_selectedOption`); the key is its last part, unless that
is a questionnaire's answer slot (`selectedOption`, `answerText`…), when the prompt's slug is. A field's section is
the `h2` above it (Personal Information, Resume Upload, a questionnaire's title, Candidate Acknowledgement), or the
step's title; a record's fields are a section of their own.

**Personal Information** is a form of its own (`form#personalInfo`) inside the step, with an Update (`type=submit`)
that saves it to the candidate's profile and a Cancel. Open, its Update is `save.personal-information`; shown as a
summary (a candidate whose profile holds it), its Edit is `edit.personal-information` (kind `edit`). The email is the
account's when signed in, and read-only: it says so in its help, and has no hint.

**Records** (Employment History, Education History, References where asked): a `form[test-id$='-record']` each, with
the id `<list>-<index>`. "Add Employment History" (`add.employment-history`, kind `form`) adds a record in edit mode,
shown first; its Update saves it to the candidate's profile and shows it as a summary with Edit and Delete. So:
- an **open** record is a section of its own named by its list and index ("Employment History 2" for `workHistory-1`),
  which the companion's lists match by title; its Update is `save.<record>`, and its Cancel removes it
  (`remove_repeatable`; for a saved record being edited, Cancel only restores it, and the removal reports it still
  there). Numbering by the index, not the place on the page, keeps the other records' ids when a new one appears at
  the top;
- a **saved** record is a saved item, `employment-history.experience-1` (or `education-history.education-1`, else
  `.item-<n>`), titled by its summary ("Employment History: Analyst Example Corp • Toronto…"), as the companion
  tells work from education among saved items. Its Edit is `edit.<record>` (kind `edit`); deleting it opens a dialog whose OK
  (`*-delete-modal-ok-button`) the removal presses. **Deleting a saved record deletes it from the candidate's
  Dayforce profile**, as the dialog says, not from this application only.

The agent adds the profile's work and education entries through these forms as on Oracle: the Add, the new
record's fields, its Update (the record's own, not Personal Information's, which sits above it while both are open).
A button of kind `edit` never counts as a list's add button in the checklist.

**Its notes** ([`siteNotes`](../mcp-tools.md#site-notes)): the resume first (Dayforce parses it), Personal
Information and records saved with their `save` button, record dates as `YYYY-MM-DD`, deleting a saved record
reaching the candidate's Dayforce profile (ask first), the dialling code filled with the country, and the Candidate
Acknowledgement left to the user.

**Hints**, outside records, by the id's last part: first, middle and last name, the email (when editable) and its
confirmation, LinkedIn, the mobile number and its dialling code (and their confirmations), address lines, city,
postal code, country and province (`countryCode`, `stateCode`). The home phone has none: the profile has one number.
Inside records: work title, company, start, end and "current job", and description; education school, degree,
major, GPA and dates. The records' dates are native date inputs taking `YYYY-MM-DD`, which a profile's `YYYY-MM`
can't fill as stored, so the agent supplies the day.

**Dependent fields** appear as earlier ones are answered (the province list after the country, "Please Provide
Additional Details" after some sources, a questionnaire's follow-up), so fills go in page order. A list that waits
for one is disabled, and a fill says so.

**Errors:** each field's own, with its prompt where the message doesn't name it, and the page's error notices
(antd notifications, messages and alerts). Notices of success ("Record update successful.") go to `messages`.

**Submit by its hook and its words.** The Submit step has the Candidate Acknowledgement and its checkbox, and
Submit (`application-submit`), the `review` page kind: `next` refuses there, and the acknowledgement is left to the
user. `isSubmit` is that hook, or a control whose text, `aria-label` or value reads "Submit" or "Submit
application": the Updates are `type=submit` buttons too, so the type says nothing.

**Other pages.** The confirmation is told by the page's own text (`main`), never the body's: the page's scripts
carry every message of the portal, "your application has been submitted" included. The posting's Apply is found by
its words ("Apply", or `aria-label` "Apply for …"), since the posting page wasn't saved.

## SAP SuccessFactors (`sites/successfactors/`)
**Why.** SuccessFactors is among the most used providers ([why these three](#why-these-three)). Its career site hosts
every employer of a data centre on one host (`career17.sapsf.com`, `career2.successfactors.eu`…), and its application
sits behind a candidate account, so it was built from a page the user saved from their own application.

**Pages.** The application is `…/career?company=<company>&career_job_req_id=<requisition>&career_ns=job_application`
(or the older `…/sfcareer/jobreqcareer?jobId=<requisition>&company=<company>`); once the candidate is signed in it can
be `…/portalcareer?_s.crb=<session token>`, whose URL names neither. It's **one page** of collapsible sections, from
the employer's template: My Documents, Profile Information, background lists (Outside Work Experience, Formal
Education, Certifications/Licenses, Geographic Mobility…), Job-Specific Information, with View Profile, Save and Apply
at the foot. Apply submits it. The employer's own careers site in front of it (SuccessFactors' Recruiting Marketing,
on the employer's domain, where postings are found) is another product with other markup, and isn't this site.

**Registry** (`protocol/src/successfactors.ts`): the URL rule takes an https `career<n>` host on `sapsf.com`,
`sapsf.eu`, `sapsf.cn`, `successfactors.com` or `successfactors.eu`, on the career site's paths (`/career`,
`/careers`, `/portalcareer`, `/sfcareer/…`). Tenant: `company`, lowercased. Job: `career_job_req_id`, else `jobId`.
A signed-in page's URL has neither, so the page's `job` (below) is what ties it to its posting there
([which posting](../mcp-tools.md#forms)). A posting captured on the career site keeps `career_job_req_id` and
`company` in its canonical URL ([postings](postings.md)), since the host is every employer's and requisitions are
numbered per employer. **Signature:** the application's own containers (`#rcmJobApplicationCtr`, its sections'
`.rcmFormSectionContent`) and the career site's form with its hidden company field
(`form#careerform input#career_company`). **Waits:** standard, but `uploadMs` 30 s (not measured): a document is
posted to SuccessFactors' server before the field names it.

**Built with juic.** The page is SuccessFactors' own component framework (juic): each component renders its markup
with ids starting with its own (`141:` gives `141:_input`, `141:_selectButton`), numbered as the page renders, and its
markup calls it with `juic.fire("141:", method, event)`; juic keeps every component in `juic.Component._registry` by
that id. So element ids say nothing stable, and no key or selector uses them. The fields' `name`s, the sections'
titles and the components' classes do.

**Fields.** Each section's content (`.rcmFormSectionContent`, titled by the heading its `aria-labelledby` names) holds
`.RCMFormField`s: a `label.rcmFormFieldLabel` (a question's `label.rcmFormQuestionLabel`; a `.requiredField` star
when required) and one control. A field
counts unless it, or something between it and its section's content, is hidden (`displayNone`, `hidden`, a display of
none); a **collapsed section** still counts, since its fields are the application's and filling them needs no
expanding. A field showing only text (the account's Username) is left out. The driver goes by the control:
- a **paginated picklist** (`input.rcmpaginatedselectinput`, every list: country, province, degree, the questions):
  [its own driver](#the-paginated-picklist-through-its-component);
- a **date** (`[ui5-date-picker]`, a UI5 Web Components date picker under the scoped tag
  `ui5-date-picker-xweb-calendar-widget`): the shared [`ui5DatePickerDriver`](adapters.md#shared-drivers-widgets),
  `MM/DD/YYYY` with a day (`dateParts`), so a profile's `YYYY-MM` doesn't fill it;
- an **attachment field** (`.attachWrapper`): [its own driver](#documents);
- a **question's radio group** (`.radioGroup`, `role=radiogroup`, under a `rcmFormQuestionLabel`: "Are you enrolled
  in a co-op program?"): juic's radios, with no inputs. Each choice is a `span[role=radio]` whose `aria-checked` the
  component keeps, its words in the `.radioLabel` beside it. `radioGroupDriver` (`widgets.ts`) clicks the choice,
  which reaches the component's `_itemSelect` (an `onclick` on the `<id>_radio` span around it, read from its
  script), and reads `aria-checked` back. Answering one can show follow-up questions under it (`cascadedQuestions`),
  read on the next `get_form`. Seen on a live application; before this driver such questions weren't listed at all,
  and the agent couldn't answer them. Where an employer's Fiori setting renders real `input[type=radio]`s instead
  (the same script), the native radio driver takes the field;
- text (`input[data-testid='sfTextField']`, a pay field's `type=currency` too); and textareas, native selects,
  native radios and checkboxes, which SuccessFactors' field factory can render (read from its script) but no page seen
  has, with the native drivers.

**Ids and sections.** A text field's key is its `name` (`firstName`, `cellPhone`, `customExptSal`, the employer's
`conflictEJust`), except a list's numbered fields (`VFLD1`, `VFLD3`), whose key is the prompt's slug, as is every
list's, date's and document's (their markup has no name). A field's section is its section's title; a **row** of a
list is a section of its own named by the list and its place ("Outside Work Experience 2"), which the companion's
lists match by title. Rows are numbered by their place: SuccessFactors renumbers them on a removal, and an Add appends.

**Hints**, outside rows, by `name`: first, middle and last name, preferred name (`prefName`), the candidate's full name
(`candidateName`, "Legal Full Name"), address lines (`address`, `address2`), city, postal code (`zip`), phone
(`cellPhone`) and email (`contactEmail`). A list's field name is only in its component (`getFieldName()`), so on a live
page `country` and `state` are hinted as the address's country and region (both names confirmed on a live page; the
saved page has no components). Rows get no hints: their fields are the employer's numbered ones, whose
meaning only their labels give, and the agent reads row fields by their labels anyway. The typed
signature (`disclaimerAcknowledge`) has none: it's the user's.

**Rows.** A list's rows are its `.rcmSectionComponent`s with a "Row number n" beside them. Each has a Remove
(`[id$='_deleteIcon'] [role='button']`), hidden on the last row of a list the employer requires, so that row isn't
removable. Remove takes the row off at once, without asking (read from the section's script; the change reaches the
employer's system with Save or Apply). A list's Add (`.addRowButton`, kind `row`, `add.<list>`) appends a row and is
hidden once the list is full.

### The paginated picklist, through its component
`RCMPaginatedPicklistSingleSelect`: a text input that opens a list fetched from SuccessFactors' server 100 options a
page, filtered as you type. The driver finds its component in juic's registry (`141:` from `141:_input`) and:
- **lists and searches** by asking the server as the component's own list does
  (`RCMPaginatedPicklistModel.fetchItems`): `getPicklistByPageWithExcludeOption` on the model's controller, with the
  picklist's id, the option chosen in the list it depends on (`_parentOptionId`: a country for provinces) and the
  page, filtered `contains` the query when searching. Up to five pages; "No Selection" (no value) and disabled options
  dropped. A search's results are filtered again here, in case the server answered with the whole list;
- **fills** by searching for the value first (one request), then the whole list for a wording the value doesn't
  contain, matching, and calling the component's `setValue({ value, label })`, which is what
  choosing an option in its list does (`itemSelected`): it shows the label, sets the hidden value, and tells the lists
  that depend on it (`paginatedPicklistMgr` enables Province/ State and loads it) and the form. A list waiting for an
  earlier answer is disabled (`input.disabled`) and refused. Fills go in page order, so a country comes before its
  provinces.

**Why not clicks.** The list is built in a popup only when opened, from the server's pages, and that popup's markup
wasn't saved. The component needs neither, and lists every option. **The risk:** these are juic's internals (the
registry, the model's controller and its argument order), read from the page's scripts. They have since worked on a
live application: lists listed, searched and chosen, and read back.

### Documents
My Documents holds the Resume/CV, Cover Letter and Additional Documents, each an `.RCMFormField.attachmentField` with
one `.attachWrapper` per attachment (the V12 attachment view, `RCMV12AttachmentView`). An uploaded one shows its file
name (`[id$='_attachDownloadLabelLink']`, with `_attach` marked `successBtn`); its icon (`[id$='_attachIcon']`) is a
pencil on a required document (it replaces it) and a bin on an optional one (it deletes it). Additional Documents
keeps an empty slot with a plus beside what it holds, so it takes several (`multiple`; on a live page the view's
`attachmentType` says so, `MULTIATTACHMENTS`).
- **Upload:** the driver presses the slot's icon (the empty slot, or a required document's pencil), which opens a popup
  (`RCMV12AttachmentPopUpContent`) with a file input (`input.fileUpload`, "Upload from my computer"); it puts the file
  in that input and fires its change. The page moves the input into a form of its own and posts it to SuccessFactors
  through a hidden frame (the slot shows "Uploading..."); once the server answers, the field names the file and the
  slot shows a tick ("File is uploaded successfully"). Done when a new name shows, failed with the field's own message
  when one shows. A **replacement under the same name** (a new `resume.pdf` over the old one) adds no name, so for a
  replacement the slot's own signs decide: it names the file, isn't uploading, and either shows a tick it didn't have
  before or was seen uploading. Counting names alone reported such a replacement as failed. An optional document
  already there has to be removed first: its icon would delete it, not replace it.
- **The page can re-render.** Seen live: a couple of seconds into an upload to Additional Documents, right after a
  cover letter's, SuccessFactors rendered the whole application again. Every element was new, answers filled before
  it were gone, the cover letter just uploaded no longer showed in its field, and neither did the new document,
  though SuccessFactors had kept it (it showed on a later visit). What sets it off isn't known; the next upload to the
  same field didn't do it. The driver stops waiting once its field leaves the page and finds the field again by its
  label. If the new field shows the file, the result is `ok` with an `error` telling the agent to read the form again
  and refill what's empty. If it doesn't, the upload fails with a message to upload again once the form is read, and
  to remove a duplicate if one shows later. Before this, the driver waited the full `uploadMs` on the detached field
  and only said the upload didn't appear. That's also why the notes say to upload documents first, one at a time.
- **Remove:** presses the bin, then OK in the confirmation dialog where the employer has one ("Are you sure you want to
  delete this file?"); the document is deleted on SuccessFactors' side at once (`deleteResumeOrCoverLetter`,
  `deleteAttachment`). A required document can't be removed, only replaced, and the removal says so.

Built from the attachment handler's script and the saved fields, then corrected against a live application, where
the popup, the upload, the tick and the re-render were seen.

**Its notes** ([`siteNotes`](../mcp-tools.md#site-notes)): the page comes filled from the candidate's profile with this
employer, so correct what's there rather than adding rows beside it; upload documents first, one at a time, then read
the form and fill the rest, since the page can re-render after an upload and drop what isn't saved (above);
documents go to the employer's site as soon as they're chosen, and removing one deletes it there (ask first); a
required document (the resume) is replaced by uploading onto it, while an optional one is removed first (without
this, an agent tries to remove the resume and is refused); a typed signature or disclaimer acknowledgement is the
user's.

**Errors:** each field's own (`.rcmValidationMsgArea`, shown), with its prompt where the message doesn't name it, and
the page's notice area (`#confirmationMsg`) when what it shows is an error; otherwise its notices ("… uploaded
successfully") go to `messages`.

**Apply by its hook and its words.** `isSubmit` is Apply's hook (`[id$='_submitBtn']`, a `span role=button`) or a
control reading "Apply" or "Submit" (with "now" or "application"). Save (`_saveBtn`) keeps a draft and isn't Submit,
but nothing presses it either. Apply is the page's `next`, so `nextLabel` says Apply, `lastPage` is set, and `go_next`
refuses.

**The job** is the page's heading ("Operations Analyst (1000)") without the requisition, which comes from the
hidden `#career_job_req_id` (else the heading's parenthetical). **Other pages:** a page with a password field and no
form is `auth`; a confirmation is told by the page's own text, without its notes (the welcome above the form thanks
the candidate "for your interest", which `CONFIRMATION_TEXT` would take for one). Neither was seen. There's no posting
page on this site to act on: postings are on the employer's careers site.

## What was verified, and how
Each definition was built from a live application page rendered by headless Edge (saved, without scripts and
styles, as `test/fixtures/live/greenhouse-apply.html`, `lever-apply.html`, `ashby-apply.html`, and later
`ashby-groups.html`, employer details replaced; `sites-live.test.ts` reads them), then checked on live public forms with fake values, never submitting
([how](adapters.md#checking-a-site-live)):
- **Greenhouse** (one company's board): text fields, the phone's country list ("Canada" → "Canada +1"), the
  sponsorship and EEO lists, a dummy file attached and removed (Greenhouse keeps it in the page until Submit),
  `go_next` refusing Submit. Two fixes came from it: react-select chosen through `onChange` (synthetic clicks
  don't open it without page focus) and read from the current fiber.
- **Lever** (one company's posting): every kind on the page, after the location field's key fix; the consent checkbox's
  prompt and the survey questions' ids came from this run.
- **Ashby** (one company's posting): text, the Yes/No buttons, a textarea, and the location by its full name; a city's
  name alone matched several places and came back with their suggestions, as intended. The consent field's selector came
  from this run.
- **Ashby, a real application** (through the extension): text fields, the location (after the
  city alone matched several places and the agent searched), the Yes/No buttons, the resume upload. Every radio
  and checkbox group was missing ([above](#ashby-sitesashby)); after the fix, filling a radio group and two
  checkbox groups on the live page (fake values, never submitted) took and read back. The graduation date is a
  date picker read as text: the agent typed a month and year and the page showed the first of that month.

- **Phenom** (one employer's careers site): steps 1 to 3 were read and filled on the live page, with placeholder
  values and a placeholder resume (which the page requires, and which went to the employer's system with the
  rest of those steps), by a script driving the page directly rather than through the adapter. That's where the
  behaviour above was seen: the selects' late read-back, the month picker refusing typing, the alert on step 1,
  Next's wait, dependent fields. The pages were saved after each step (`phenom-step1.html`, `phenom-step2.html`,
  `phenom-step2-errors.html` after Next with required fields empty, `phenom-step3.html`; employer details
  replaced) and the definition was built from them. Steps 4 to 6 weren't reached. The definition itself has run
  only on the saved pages.

- **Dayforce**: built from one saved page of a live application, the Candidate Info step of a new candidate who
  had signed in and has no records yet, as it first shows (Personal Information open; saved as
  `dayforce-candidate-info.html`, employer, job and candidate details replaced). What that page doesn't show was
  read from the portal's own scripts, saved with it: the questionnaire's field types and ids, the records' forms,
  summaries, Update, Cancel, Edit, Delete and its dialog, Personal Information's summary, the Submit step's
  acknowledgement and Submit, the upload list, and every message the portal shows. The definition has run only in
  jsdom: on the saved page, and on records built from those scripts' markup inside it. The Ant Design driver is
  tested on a model of rc-select's context.

- **SAP SuccessFactors**: built from one saved page of a live application, a signed-in candidate's, with the
  profile, two lists and the documents filled from an earlier application (saved as `successfactors-application.html`,
  employer, job and candidate details replaced; the shadow roots' templates and the inline `juic.fire` handlers removed). What it doesn't show was read
  from the page's own scripts, saved with it: the picklist's component and its server request, the attachment view,
  its upload popup and deletion, the rows' Add and Remove, the date picker's change event, and the field types the
  field factory can render. In jsdom it runs on the saved page, with juic's registry, the picklists, the upload popup,
  the delete dialog and the question radios modelled from those scripts. It has also run against a live tenant with
  debug mode on. There, the application was read and tied to its posting by the page's requisition; lists were listed,
  searched and chosen through the component (country and province hinted by their field names); row dates were
  taken; documents went in through the popup, a second one into Additional Documents included; and an optional
  document was removed after its dialog, while the required resume's removal was refused. The live run also found
  three gaps, now fixed in jsdom only: question radios weren't read, a same-named replacement was reported as failed,
  and an upload waited out its time on a field the page had re-rendered ([documents](#documents)).

**Not yet tried:** uploads on Lever, the confirmation page of any of them, and a real application on
Greenhouse or Lever. On Phenom: the definition on a live page (through the extension), steps 4 to 6 (their
markup, and the Review step's Submit), removing a row, adding one, and the posting page's own markup beyond its
Apply link. On Dayforce: everything live. The driver choosing from rc-select's context (and the context
found at all: it's rc-select's internals), uploads and the resume's parse, whether Next goes on with Personal
Information or a record still open, the Update and delete flows, the questionnaire, the Submit step, the posting
page and its Apply, the confirmation page, and a signed-out application (whose email is editable, with a
confirmation). On SuccessFactors: the question radio driver, a same-named replacement and the re-render handling
live; the province list enabled and loaded after a country is chosen in the same call; adding and removing a row;
Apply's errors; a signed-out application; the confirmation and sign-in pages; and an employer whose template has
textareas, checkboxes, native radios or native selects.
