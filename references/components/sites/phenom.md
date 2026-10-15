# Phenom (`packages/sites/src/phenom/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

**Why.** Phenom People runs many employers' careers sites on their own domains (`jobs.example.com`). Their
application is Phenom's own multi-step form on that domain, which sends what's entered on to the employer's ATS,
often Workday. It can look like a Workday form, but nothing on the page is a Workday URL, as a tab or a frame, so
the form tools found no application there, and the Workday adapter couldn't have read its markup anyway.

**Pages.** The posting is `…/<region>/<lang>/job/<id>/<slug>` (`/ca/en/`, `/global/en/`…), and its Apply button
(`a[data-ph-at-id=apply-link]`) goes to `…/hvhapply?jobSeqNo=<job>`, which redirects to the flow,
`…/apply?jobSeqNo=<job>&step=<n>&stepname=<id>`.

**Telling it.** Every page of a Phenom site is known by its body ([telling a page's
site](../extension.md#telling-a-pages-site-framests)): the signature is its apply flow's containers
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
- a react-datepicker month picker (work dates): `monthPickerDriver` ([shared drivers](../adapters.md#shared-drivers-widgets)).
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

## What was verified
- **Phenom** (one employer's careers site): steps 1 to 3 were read and filled on the live page, with placeholder
  values and a placeholder resume (which the page requires, and which went to the employer's system with the
  rest of those steps), by a script driving the page directly rather than through the adapter. That's where the
  behaviour above was seen: the selects' late read-back, the month picker refusing typing, the alert on step 1,
  Next's wait, dependent fields. The pages were saved after each step (`phenom-step1.html`, `phenom-step2.html`,
  `phenom-step2-errors.html` after Next with required fields empty, `phenom-step3.html`; employer details
  replaced) and the definition was built from them. Steps 4 to 6 weren't reached. The definition itself has run
  only on the saved pages.

**Not yet tried:** the definition on a live page (through the extension), steps 4 to 6 (their markup, and the Review
step's Submit), removing a row, adding one, and the posting page's own markup beyond its Apply link.
