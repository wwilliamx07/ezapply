# Dayforce (`packages/sites/src/dayforce/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

**Why.** Dayforce (formerly Ceridian) is an HCM suite whose candidate portal hosts many employers' applications.
Its newer portal is one host for every employer, a Next.js app on Ant Design.

**Pages.** `jobs.dayforcehcm.com/<locale>/<client>/<career site>/jobs/<id>` is the posting, and the application is
under it (`…/jobs/<id>/apply/manualApplication?applicationSource=Manual`). The locale (`en-US`, `zh-Hans`, `es-419`:
every locale the portal offers has a dash) is optional; the page's own links sometimes leave it out. `<client>` is the
employer's namespace on Dayforce, and `<id>` its posting id, numbered per client. The URL stays the same through the
steps.

**Registry** (`registry.ts`): the URL rule takes an https `*.dayforcehcm.com` path with `jobs/<digits>`
after the client and career site, with or without a locale. Where `jobs` sits says whether the first segment is a
locale, since a client namespace can be as short as a language code. The older portal
(`<cluster>.dayforcehcm.com/CandidatePortal/…`) is another app with other markup, and its paths don't match. Tenant:
the client namespace, lowercased (on a page known by its body whose path isn't a job's, the first segment after a
locale). Job: the posting id. Canonical path: from the client to the id, without the locale or the application's
path, so the posting and its application are one posting. **Provider hosts:** `dayforcehcm.com`, with no `company`, so
a posting's company comes from its JSON-LD or title, never from the host. **Signature:** the portal's own `test-id` hooks (it uses
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
  [`antSelectDriver`](../adapters.md#ant-designs-select-through-rc-selects-context), through rc-select's context.
  A list that can't be searched keeps a read-only search box, which isn't a read-only field;
- a phone number: a compact group of a dialling-code list and the number, read as two fields (`mobilePhoneCountryCode`
  and `mobilePhone`; the list has no id of its own). The dialling codes' labels are React elements (a flag, `+1`,
  the country), read as "🇨🇦 +1 Canada", which the option match takes "Canada" for
  ([drivers](../adapters.md#widget-drivers));
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

**Its notes** ([`siteNotes`](../../mcp-tools.md#site-notes)): the resume first (Dayforce parses it), Personal
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

**The job** is the header's title (`job-detail-title`) and its "Req #0000" (`job-detail-job-req-id`) without the
prefix, as `reqId`.

**Other pages.** The confirmation is told by the page's own text (`main`), never the body's: the page's scripts
carry every message of the portal, "your application has been submitted" included. The posting's Apply is found by
its words ("Apply", or `aria-label` "Apply for …"), since the posting page wasn't saved.

## What was verified
- **Dayforce**: built from one saved page of a live application, the Candidate Info step of a new candidate who
  had signed in and has no records yet, as it first shows (Personal Information open; saved as
  `dayforce-candidate-info.html`, employer, job and candidate details replaced). What that page doesn't show was
  read from the portal's own scripts, saved with it: the questionnaire's field types and ids, the records' forms,
  summaries, Update, Cancel, Edit, Delete and its dialog, Personal Information's summary, the Submit step's
  acknowledgement and Submit, the upload list, and every message the portal shows. The definition has run only in
  jsdom: on the saved page, and on records built from those scripts' markup inside it. The Ant Design driver is
  tested on a model of rc-select's context.

**Not yet tried:** everything live. The driver choosing from rc-select's context (and the context found at all: it's
rc-select's internals), uploads and the resume's parse, whether Next goes on with Personal Information or a record
still open, the Update and delete flows, the questionnaire, the Submit step, the posting page and its Apply, the
confirmation page, and a signed-out application (whose email is editable, with a confirmation).
