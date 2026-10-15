# Oracle Recruiting Cloud (`packages/sites/src/oracle/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

**Pages.** Oracle's Candidate Experience, on the employer's Oracle Cloud host
(`<pod>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123`) or, as often, its own domain
(`jobs.example.com/en/sites/CX_1/job/123`). The host says nothing, so the signature is the Candidate Experience's
components (`apply-flow`, `apply-flow-block`, `apply-flow-header`), its dialogs (`.app-dialog__wrapper.oj-dialog-body`)
and its scripts' path (`/hcmUI/CandidateExperience/`). Where no page can be read, `isOracleUrl` goes by the path:
https, an optional `hcmUI/CandidateExperience`, a language, `sites/<site number>`, then `job`, `jobs`,
`requisitions` or `my-profile`. The **tenant** is host plus site number, lowercased (`jobs.example.com/cx_1`),
and the **job** the id after `job/`; a page told Oracle's by its body on a URL of another shape has neither tenant
nor job, and its tab is matched by its binding or what the page shows. The canonical path drops the language segment
and whatever follows the job id (`/apply/section/1`), so a capture on the application is the job page's posting.
`oraclecloud.com` hosts are provider hosts (the pod names Oracle's data centre), with no `company`: there, a
posting's company comes from its JSON-LD or title, never the host. The pages are Knockout components with React widgets inside.

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
page's templates, not seen live). The job's title is that heading's part before "application, step"; worded otherwise (another
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

## Oracle's list: searching it
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

## Oracle: what was verified
- **Live, headless:** a job page (`posting`, Apply, tenant) and the email step (`auth`, honeypot left out), saved as
  `oracle-posting.html` and `oracle-email.html`.
- **A saved single-page application** (`oracle-apply.html`, employer and personal details replaced): all 46 fields
  with kinds, ids, hints and options. The behavioural fixture (`test/fixture.ts`) is built from it and the
  bundle's templates: every widget, dependent lists, the Escape trap, uploads and removals, inline forms and Save,
  tile and timeline deletes, the multi-page flow, the guard; the companion's e2e tests run on it too.
- **Real applications:** text, pills, native radios, dates, lists, uploads, and education and work entries through
  the inline form were filled. What they showed (a city shown shorter than its option, the re-rendered city input,
  the postal code by its full label, a reformatted phone number, stale errors, "Saved" as an error, the address and
  school lists' late search) is handled above and reproduced by the fixture's tests. A Cover Letter field missing
  from `get_form` on one page is unexplained.
- **Not yet live:** language and license tiles, deletes, the multi-page flow, the confirmation page.
