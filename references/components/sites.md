# Greenhouse, Lever, Ashby and Phenom (`packages/extension/src/adapters/sites/`)

Four sites, each a definition on the [adapter engine](adapters.md) using shared drivers only: a `site.ts` and a
`main.ts`. Three are hosted job boards (Greenhouse, Lever, Ashby; about 150 lines each), and each of their
applications is **one page with Submit at the end**: there are no steps, rows or inline forms, `next` always refuses (Submit is the only way on), `back` has nowhere to go, and
the schema says `lastPage: true`, so the agent fills the page and hands over to the user
([the hand-off](autofill.md)). The fourth, [Phenom](#phenom-sitesphenom), is an employer's careers site whose
application has steps and rows, like Workday's. Workday and Oracle have pages of their own:
[Workday](workday-adapter.md), [Oracle](oracle-adapter.md).

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

Each needs pages the user saves from a real application in their own browser. None is planned yet.

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
- a native `date` input (the questionnaire's start date), checkboxes, text;
- the resume, above the form on every step (`.resume-section`: a hidden file input behind "Upload resume", the file's
  name in `.has-resume a.downloadFile`), and "Additional attachments" on step 2.

**Ids and sections.** A row's fields are a section of their own, named from the list's description ("Work
experience :", else its "Add …" legend) and the row's place: `work-experience-1`, `education-1`, `languages-1`,
so autofill and the checklist match them to the profile's lists by title, as Workday's. A row with a "−" button
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

**Not yet tried:** uploads on Lever, the confirmation page of any of them, and a real application on
Greenhouse or Lever. On Phenom: the definition on a live page (through the extension), steps 4 to 6 (their
markup, and the Review step's Submit), removing a row, adding one, and the posting page's own markup beyond its
Apply link.
