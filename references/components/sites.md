# Greenhouse, Lever and Ashby (`packages/extension/src/adapters/sites/`)

Three hosted job boards, each a definition on the [adapter engine](adapters.md) using shared drivers only: a
`site.ts` of about 150 lines and a `main.ts`. Each application is **one page with Submit at the end**: there are
no steps, rows or inline forms, `next` always refuses (Submit is the only way on), `back` has nowhere to go, and
the schema says `lastPage: true`, so the agent fills the page and hands over to the user
([the hand-off](autofill.md)). Workday and Oracle have pages of their own: [Workday](workday-adapter.md),
[Oracle](oracle-adapter.md).

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
| SuccessFactors, Taleo, BrassRing | The application is behind a candidate account on each employer's site |

Each needs pages the user saves from a real application in their own browser (`todo.md`, item 7).

## What they share
- **Registry entries** (`protocol/src/sites.ts`, URL rules in `greenhouse.ts`, `lever.ts`, `ashby.ts`): https
  only; the board's company as tenant and its posting as job, both lowercased; access **per origin**, asked for
  at Set posting on a page of the site, as Oracle's is ([site access](oracle-adapter.md#site-access)). One grant
  covers the host's every board. Standard waits.
- **Page kinds** (`singlePageKind`): a page with fields is a `step`; without, a page saying thanks is the
  `confirmation`, one with an Apply button is the `posting` (its `apply` action presses it); else `unknown`.
- **Submit** is `isSubmitByText`: a `type=submit` control, or one reading "Submit (application)" or "Send". It's
  the page's `next`, so `nextLabel` shows it, and the guard blocks any synthetic press of it.
- **Messages** (`singlePageMessages`): `go_next` says the whole application is on this page and the user reviews it
  and presses Submit.
- **Hints** for the fields every board asks: name, email, phone, links. Lever's and Ashby's name is one field;
  its hint `identity.fullName` makes the planner join first, middle and last name. A location hint is
  `contact.address.city`, filled with the adapter's own (loose) match like every city: a city alone can match
  several places, and then nothing is chosen and the suggestions go back to the agent.

## Greenhouse (`sites/greenhouse/`)
**Pages.** `job-boards.greenhouse.io/<board>/jobs/<id>`, the older `boards.greenhouse.io`, the EU hosts
(`job-boards.eu.greenhouse.io`), and the embed a company's careers page loads in a frame
(`…/embed/job_app?for=<board>&token=<id>`). The posting and the form share one page. An embed is recognised as
Greenhouse when it's the tab's own URL; inside another site's page the form tools can't reach it yet (`todo.md`,
item 2).

**Fields**, in the form (`form#application-form`), in page order:
- `.text-input-wrapper`: a text input or textarea;
- `.select__container`: a react-select list ([driven through its props](adapters.md#react-select-through-its-props));
  the phone's country list is one;
- `.file-upload`: resume and cover letter, file names from `.file-upload__filename`, removed by its
  "Remove file" button;
- `fieldset`s (not the phone's): radios, a checkbox group, or a lone checkbox.

Prompts are the controls' labels (`promptOf`), help text the `<id>-description` element, errors `aria-invalid` with
its message or `#<id>-error`. Required: `aria-required`, or a required mark in the label.

**Ids.** Greenhouse's own fields by control id (`application.first_name`); its custom questions, keyed by long
numbers (`question_38624172002`), by the prompt's slug, which reads better and is as stable. Section: the heading
before the field within the form (the EEO block's "Voluntary Self-Identification"), else "Application".

**Hints** by id: names, email, phone, the phone's country (`contact.phone.countryCode`), and the EEO fields
(gender, Hispanic or Latino, race, veteran status, disability); by prompt: LinkedIn, GitHub, website or
portfolio. The country list's options are "Canada +1": strict matching takes "Canada" for it
([strict matching](autofill.md#strict-matching)).

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
went by the class, built from one page (Stark's) that had no such groups, and in the first real application
(Wayne, 2026-10-04) it missed all seven: "Degree Type", "How many prior internships", the work, cohort and
location choices, sponsorship and the office question. The agent then filled two of them by ids it guessed from a
screenshot, which failed as unknown fields. `ashby-groups.html` (that page) now keeps it covered.

**Ids.** Ashby's own fields by their path without the prefix (`_systemfield_email` → `application.email`); a board's
questions by the prompt's slug. Everything is in one section, "Application".

**The texting consent.** An entry holding a phone number may also hold "may we text you?" with Yes and No radios.
The entry is the phone field (text comes before radio in the order); the consent is a field of its own,
`application.texting-consent`, its prompt the consent text (`.ashby-application-form-texting-consent-description`).

**Hints** by path: name (full name), email, location (city); by prompt: phone, LinkedIn, GitHub, website.

## What was verified, and how
Each definition was built from a live application page rendered by headless Edge (saved, without scripts and
styles, as `test/fixtures/live/greenhouse-apply.html`, `lever-apply.html`, `ashby-apply.html`, and later
`ashby-groups.html`; `sites-live.test.ts` reads them), then checked on live public forms with fake values, never submitting
([how](adapters.md#checking-a-site-live)), on 2026-10-03:
- **Greenhouse** (Vandelay's board): text fields, the phone's country list ("Canada" → "Canada +1"), the
  sponsorship and EEO lists, a dummy file attached and removed (Greenhouse keeps it in the page until Submit),
  `go_next` refusing Submit. Two fixes came from it: react-select chosen through `onChange` (synthetic clicks
  don't open it without page focus) and read from the current fiber.
- **Lever** (Wonka): every kind on the page, after the location field's key fix; the consent checkbox's
  prompt and the survey questions' ids came from this run.
- **Ashby** (Stark): text, the Yes/No buttons, a textarea, and the location by its full name; "Toronto" alone
  matched several places and came back with their suggestions, as intended. The consent field's selector came
  from this run.
- **Ashby, a real application** (Wayne, 2026-10-04, through the extension): text fields, the location (after the
  city alone matched several places and the agent searched), the Yes/No buttons, the resume upload. Every radio
  and checkbox group was missing ([above](#ashby-sitesashby)); after the fix, filling a radio group and two
  checkbox groups on the live page (fake values, never submitted) took and read back. The graduation date is a
  date picker read as text: the agent typed "April 2030" and the page showed 04/01/2030.

**Not yet tried:** uploads on Lever, the confirmation page of any of them, and a real application on
Greenhouse or Lever.
