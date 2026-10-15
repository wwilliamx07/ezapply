# SAP SuccessFactors (`packages/sites/src/successfactors/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

**Why.** SuccessFactors is among the most used providers ([why these three](../sites.md#why-these-three)). Its career site hosts
every employer of a data centre on one host (`career17.sapsf.com`, `career2.successfactors.eu`…), and its application
sits behind a candidate account, so it was built from a page saved from a real application.

**Pages.** The application is `…/career?company=<company>&career_job_req_id=<requisition>&career_ns=job_application`
(or the older `…/sfcareer/jobreqcareer?jobId=<requisition>&company=<company>`); once the candidate is signed in it can
be `…/portalcareer?_s.crb=<session token>`, whose URL names neither. It's **one page** of collapsible sections, from
the employer's template: My Documents, Profile Information, background lists (Outside Work Experience, Formal
Education, Certifications/Licenses, Geographic Mobility…), Job-Specific Information, with View Profile, Save and Apply
at the foot. Apply submits it. Some employers' career sites still serve an **older application layout** on the same
URLs (seen on `…/sfcareer/jobreqcareerpvt?…`, then `…/portalcareer?_s.crb=…`): fields straight inside
`form#careerform` (inputs named by the profile's fields, the same paginated picklists, questions as
`fbjq_question_*` radios, Apply and Save as `button#fbja_apply` / `#fbja_draft`), with no `#rcmJobApplicationCtr`. The
signature matches it, but the definition reads only the layout above, so `get_form` there gives `pageKind: unknown`
and no fields: the agent can't fill it. The employer's own careers site in front of it (SuccessFactors' Recruiting Marketing,
on the employer's domain, where postings are found) is another product with other markup, and isn't this site.

**Registry** (`registry.ts`): the URL rule takes an https `career<n>` host on `sapsf.com`,
`sapsf.eu`, `sapsf.cn`, `successfactors.com` or `successfactors.eu`, on the career site's paths (`/career`,
`/careers`, `/portalcareer`, `/sfcareer/…`). Tenant: `company`, lowercased. Job: `career_job_req_id`, else `jobId`.
A signed-in page's URL has neither, so the page's `job` (below) is what ties it to its posting there
([which posting](../../mcp-tools.md#forms)). A posting captured on the career site keeps `career_job_req_id` and
`company` in its canonical URL ([postings](../postings.md)), since the host is every employer's and requisitions are
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
  `ui5-date-picker-xweb-calendar-widget`): the shared [`ui5DatePickerDriver`](../adapters.md#shared-drivers-widgets),
  `MM/DD/YYYY` with a day (`dateParts`), so a profile's `YYYY-MM` doesn't fill it;
- an **attachment field** (`.attachWrapper`): [its own driver](#documents);
- a **question's radio group** (`.radioGroup`, `role=radiogroup`, under a `rcmFormQuestionLabel`: "Are you enrolled
  in a co-op program?"): juic's radios, with no inputs. Each choice is a `span[role=radio]` whose `aria-checked` the
  component keeps, its words in the `.radioLabel` beside it. `radioGroupDriver` (`widgets.ts`) clicks the choice,
  which reaches the component's `_itemSelect` (an `onclick` on the `<id>_radio` span around it, read from its
  script), and reads `aria-checked` back. Answering one can show follow-up questions under it (`cascadedQuestions`),
  read on the next `get_form`. Without this driver such questions aren't listed at all (seen on a live
  application). Where an employer's Fiori setting renders real `input[type=radio]`s instead
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

## The paginated picklist, through its component
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
registry, the model's controller and its argument order), read from the page's scripts. They work on a live
application: lists listed, searched and chosen, and read back.

## Documents
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
  before or was seen uploading. Counting names alone would report such a replacement as failed. An optional document
  already there has to be removed first: its icon would delete it, not replace it.
- **The page can re-render.** Seen live, a few seconds into an upload (one following another), SuccessFactors can
  render the whole application again: every element is new, answers not yet saved are gone, and the documents just
  uploaded don't show in their fields, though SuccessFactors has kept them. What sets it off isn't known; it doesn't
  happen on every upload. So the driver stops waiting once its field leaves the page (rather than waiting out
  `uploadMs` on the detached field) and finds the field again by its label. If the new field shows the file, the
  result is `ok` with an `error` telling the agent to read the form again and refill what's empty. If it doesn't,
  the upload fails with a message to upload again once the form is read, and to remove a duplicate if one shows
  later. That's also why the notes say to upload documents first, one at a time.
- **Remove:** presses the bin, then OK in the confirmation dialog where the employer has one ("Are you sure you want to
  delete this file?"); the document is deleted on SuccessFactors' side at once (`deleteResumeOrCoverLetter`,
  `deleteAttachment`). A required document can't be removed, only replaced, and the removal says so.

Built from the attachment handler's script and the saved fields, then corrected against a live application, where
the popup, the upload, the tick and the re-render were seen.

**Its notes** ([`siteNotes`](../../mcp-tools.md#site-notes)): the page comes filled from the candidate's profile with this
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
fields of the application is `auth`; a confirmation is told by the page's own text, without its notes (the welcome above the form thanks
the candidate "for your interest", which `CONFIRMATION_TEXT` would take for one). Neither was seen. There's no posting
page on this site to act on: postings are on the employer's careers site.

## What was verified
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
  document was removed after its dialog, while the required resume's removal was refused. The question radios, a
  same-named replacement and the re-render ([documents](#documents)) are handled from what that run showed, and
  checked in jsdom only.

**Not yet tried:** the question radio driver, a same-named replacement and the re-render handling live; the province
list enabled and loaded after a country is chosen in the same call; adding and removing a row; Apply's errors; a
signed-out application; the confirmation and sign-in pages; and an employer whose template has textareas, checkboxes,
native radios or native selects.
