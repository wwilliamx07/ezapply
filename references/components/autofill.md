# Deterministic autofill (`autofill_step`)

The companion fills what the profile and the answer bank settle on an application step, without the model,
and hands the model only the rest. The planner is `companion/src/forms/autofill.ts` (`planStep`,
`rowsToAdd`, `missingItems`, `checkReadBack`, `normLabel`), with the profile lists in `forms/lists.ts` and
strict option matching in `protocol/src/match.ts` (shared with the adapters). The tool is `autofill_step` in
`mcp/tools/forms.ts`, run by `FormsService.autofillStep`.

**Why.** In the four applications of 2026-09-30 and 2026-10-01, 87 of 128 fills copied a profile value
(`source: profile` in `form-log.jsonl`), 7 came from the answer bank, and 34 needed the user, judgment or a
computation. The model read each step's whole schema and wrote every value back out, and every turn re-sends
the conversation. Filling the settled fields in the companion saves those tokens and turns, and gives the same
answer every time. The model stays the reviewer: it sees every value that went in.

It was built in three phases (`todo.md` had the plan): profile hints and literal answers (2026-10-01, run live
once), then rows, strict matching in the adapters and computed answers, then link fields, language rows,
education years and Oracle's item forms (2026-10-02, not yet run live).

## The call
`autofill_step { tabId? }` replaces the first `get_form` of a step (the `ezapply-apply` skill starts every
step with it):
1. Read the page (`form.get`). If it isn't a `step` page, if the tab belongs to another posting
   (`postingMismatch`), if `forms.autofill` is `"off"`, or if `profile.yaml` is missing or invalid, nothing is
   filled. The result is then `get_form`'s, with `filled: []` and a `note` saying why.
2. **Add rows** the page lacks (`rowsToAdd`): for each add button that adds a row (`kind` not `form` or
   `save`) whose list has fewer rows (Workday) or link fields (Oracle's Add Another Link) than the profile has
   entries, press it that many times (at most ten),
   reading the page after each press. Each press is logged as `add-row`.
3. **Plan and fill, twice.** Plan the step (`planStep`). A dropdown whose value has several wordings (a degree, a
   language level) needs its options first: they are listed once per option key (`optionKey`: the automation id,
   which Workday repeats in every row) and the step planned again. The fills go out `strict` (except `loose`
   ones, below), in chunks of whole sections of about 25 fields, each chunk one `form.fill`. Each read-back is
   checked (`checkReadBack`) and each fill logged. Then the step is read and planned once more, skipping the
   fields already handled: that fills fields that appeared because of a fill (a province list after the country,
   an end date after "I currently work here" is unticked). There is never a third pass.
4. **Item forms** (`missingItems`; today Oracle's): for each work, education and language entry no saved item
   names, press its add button that opens an inline form (`kind: "form"`: Add Experience, Add Education, Add
   Language), plan the fields that appeared as that
   entry's row, fill them, and press the form's Save (`save.*`). Logged as `add-item`. A form that doesn't open
   skips the rest of its list. A Save the page refuses stops there: the form stays open, its fields are in the
   result, and the Save is in `failed` with the page's error.
5. Return `get_form`'s view of the page (including the status moves and `notAttached` at review, `posting`,
   `postingMismatch`, `tabHidden`, `timingIssues` and `checklist`), with:
   - `sections`: only the fields left, each with `reason`. A dropdown left as `no-strict-match` carries the
     `options` autofill listed for it. Rows marked `removable` stay even when they have no fields left;
   - `filled`: `{ fieldId, label, value, rule, was? }`, where `was` is a value it replaced (left from a previous
     application);
   - `failed`: `{ fieldId, label, value, rule, error?, availableOptions?, inexact? }`, where `inexact` is the
     near match the page now holds. An add or Save the page refused is here too, under the button's id;
   - `added`: what was added, such as `work: 1 row added (add.work-experience)` or `languages: French saved`;
   - `kept`: how many fields already held the planned value.

It runs inside the tab's queue like every form call, and each fill uses `fillTimeoutSeconds`. *Why chunks:* a
step with three work rows plans 40 fields or more, and one live fill of 38 fields took 93 s against the 120 s
timeout.

## Rules (`planStep`)
For each field, the first rule that applies decides.

1. **Never automatic:**
   - `password` and `file` fields;
   - a field the extractor marks read-only (its help text says so: Oracle's email, which comes from the sign-in);
   - a typeahead with `multiple` (which skills to list is judgment, and filling only adds);
   - a typeahead that already holds an entry other than the planned one (`multi-select`).
2. **Rows** (below): a field in a work, education, language or website row takes its part of the row's
   profile entry. A row beyond the profile's entries is `extra-row`; a row of a list autofill doesn't fill
   (certifications) is `row`.
3. **Link fields** outside rows (Oracle's "Link 1", "Link 2": a text field labelled only link, URL, website or
   portfolio, with no hint): a field already holding a profile link keeps it (a trailing slash or "www." aside),
   empty ones take the links not on the page yet, in order. A field holding some other link is `no-rule`; an
   empty one with no link left is `not-in-profile`.
4. **Profile hint** (`hint.profileKey`, set by the adapters' `PROFILE_HINTS`), with a section check:
   - Outside a row, `work[]` and `education[]` keys are `section-mismatch`: Workday's "Available Start Date"
     under Application Questions has the hint `work[].start`.
   - Identity and contact keys are left as `section-mismatch` in a section about someone else (references,
     emergency contacts, relatives, a supervisor).
   - `contact.phone.countryCode` takes the profile's country. Workday lists "Canada (+1)", and Canada and the
     US share +1.
   - `contact.phone.type` is capitalised (`mobile` → "Mobile").
   - `identity.fullName` (one field for the whole name: Lever's and Ashby's) is first, middle and last name
     joined with spaces.
   - `eeo.*` fills only from the profile. It's left as `eeo-unset` when the value is missing, and as
     `eeo-decline` when the profile says decline (the model picks the form's wording).
   - Any other key is the profile value as stored, or `not-in-profile` when it's unset.
   - `answers.<id>` keys use that answer-bank entry, as in rule 5.
5. **Answer bank by wording.** The label, normalised by `normLabel`, must equal an entry's `canonical` or one
   of its `variants`, normalised the same way. Equality only.
   - `normLabel` applies NFKC and lowercases. It removes anything in parentheses, a trailing "*", and
     punctuation, then collapses spaces. Forms add examples in parentheses that saved wordings leave out ("a
     visible minority (including people who are …)"), so those don't decide the question.
   - `sensitive` entries are left as `sensitive`.
   - An entry whose `source` is a profile path is **computed** (below) when the profile settles it, logged with
     `source: computed`. Otherwise its stored answer is used; with none, it's `from-profile`. Any other
     `source` (agents have written `source: user` for an answer the user gave) is ignored, and the answer is
     used.
   - The stored value is `byCompany` for the posting's company (case and spacing aside), else `default`, else
     the plain answer. `answer: null` is `ask-user`.
   - **Reversed wordings:** a variant whose count of negations ("not", "no", "never", "without", "…n't") has
     the other parity from the canonical question's is a question asked the other way round. The skill saves a
     form's wording as a variant, and only the model flips yes and no for it. So the planner leaves it as
     `reversed-wording` and never fills it.
6. **Already right:** a field whose current value equals the planned one is kept. Text is compared trimmed; a
   checkbox by its state (unticked is a value here); options with `strictMatch`, or by the last part of a nested
   path ("Job Board > LinkedIn" against "LinkedIn"). A dropdown already showing any of its value's wordings is
   kept without listing its options.
7. Anything else is `no-rule`. A typeahead holding entries with no rule is `multi-select`.

## Rows
Workday shows each entry of a list as a section `<list>-N` ("Work Experience 2", "Education 1", "Languages 3",
"Websites 1"). `forms/lists.ts` matches a section's title, without its number, to a profile list (`work`,
`education`, `languages`, `certifications`, `links`), the same heuristic the checklist uses. Website rows hold
the profile's links in order (GitHub, portfolio, others), and LinkedIn too when the page has no LinkedIn field of
its own (Workday has one; Oracle's link fields don't).

**Which entry a row takes** (`mapRows`): first the rows that already name an entry (their company, school,
language or URL equals it, case and spacing aside), as on a form pre-filled from the last application; then
the remaining rows in page order take the remaining entries in profile order. Rows beyond the entries are
`extra-row`: nothing is removed, because removing a row is destructive and the user may want an older job on
the form. The model decides with `remove_repeatable`, and the checklist warns about the count.

**Which part of the entry a field takes** (`slotOf`): its hint when there is one (`work[].title`,
`education[].school`), else its label. The hint tables map `startDate` and `endDate` to `work[].start` and
`work[].end` whatever the section, so in another list's row those hints mean that row's own dates. Labels decide what hints can't: Workday's education years ("From",
"To (Actual or Expected)") have no hint, and its language levels are keyed by hashed ids, so only their labels
(Comprehension, Overall, Reading, Speaking, Writing) say what they are.

| List | Part | Value |
|------|------|-------|
| work | title, company, location | as stored; a missing location is `not-in-profile` |
| work | "I currently work here" | ticked when `end` is null, else unticked |
| work | start, end (date) | `YYYY-MM`, or `YYYY` when the field has only a year; a field wanting a day is `no-rule`, and so is a start or end that isn't a date field (its format is unknown). No `end` (the current role) is `not-in-profile` |
| work | role description | the highlights joined by line breaks, as stored (not tailored to the posting) |
| education | school, GPA | as stored |
| education | degree | the stored degree, then the level's usual wordings ("Bachelor of Science": "Bachelor's Degree", "Bachelor's", …) |
| education | field of study | without a trailing parenthetical first ("Physics (Co-op)" → "Physics"), then as stored |
| education | start, end (date) | as for work, by label too: "From", "To (Actual or Expected)", "first year", "graduation" |
| languages | language | as stored |
| languages | native checkbox | ticked for `native`, and for `fluent` when the label says fluent (live: "I am fluent in this language.") |
| languages | level (any other list in the row) | the proficiency's wordings, best first (`LEVELS`): `native` → Native, Native or Bilingual, …, Fluent; `fluent` → Fluent, Full Professional, Advanced; `professional` → Professional, …, Advanced; `conversational` → Conversational, Intermediate, Limited Working; `basic` → Basic, Beginner, Elementary |
| links | the row's text field | the link |

**Several wordings.** A value with more than one wording goes to a dropdown only after its options are known:
the planner returns the field in `needOptions`, the service lists the options (one field per option key), and
the first wording that names an option strictly is sent as that option's exact text. None does:
`no-strict-match`, with the options in the result. Radios and checkbox groups list their options in the schema,
so they're matched at once. A typeahead gets the first wording. *Why list first rather than try each:* a missed
dropdown costs an open, and the live level lists ("1 - Beginner" … "5 - Fluent") hold none of the first
wordings, so trying would cost two opens a field.

## Oracle's item forms
Oracle adds work, education, language and license entries through an inline form with its own Save
([oracle-adapter](oracle-adapter.md#repeatable-items)). The planner knows these by the schema's facts, not the
site's name: a saved item is a section marked `saved`, an add button that opens a form has `kind: "form"`, and a
form's Save has `kind: "save"`, so another site with inline forms would get the same flow. `missingItems`
compares the saved items (sections like
`work-and-education-history.experience-1` and `languages.item-1`, titled "Languages: French, Fluent") with the
profile: an entry is there when a saved item's title contains its company, school or language as whole words
(a company called "A" isn't in every title with an "a"). Each missing one
gets the flow in step 4 above. The add button for a list is found by its label first ("Add Experience", "Add
Education"), because both sit under one section, "Work and Education History". Fields are planned as a row of
that entry (`item` in `PlanInput`), by hint (`employerName`, `jobTitle`, `educationalEstablishment`, …) or
label. Licenses aren't added, and Workday's certification rows aren't filled: no mapping of their fields to
`certifications` was built, since no live run has shown them.

Unverified: only the language form is modelled in the behavioural fixture, and the work and education forms'
date fields have never been seen, so they're matched by label only.

## Answers computed from the profile
An entry with `source: profile.…` is computed when the profile settles it (`computeAnswer`):

| Source | Answer |
|--------|--------|
| `workAuthorization.requiresSponsorshipNow`, `…Future`, `jobPreferences.relocate` | Yes or No from the boolean; unset is left |
| `workAuthorization.authorizedIn` | Yes when the country the question names ("…authorized to work in Canada?"), else the one the posting's location (`meta.json`) names, is one the user may work in. Anything else is left: "No" is a claim about the job's country, which free text can't settle. Two countries named, or one not allowed, are left too |
| `jobPreferences.workMode` | Yes for on-site, hybrid or any; a remote-only preference isn't an inability, so it's left |
| `jobPreferences.willingToTravelPercent` | No at 0, Yes at 100; anything between depends on the role, so it's left |
| `jobPreferences.earliestStart` | the stored date into a date field, or the stored text into a text field |
| `workAuthorization.securityClearance` | Yes when one is stored, No when it says none |
| `languages` | for the language the question names: Yes for native or fluent, No for conversational or basic; professional is left |

`education` (whether a degree is "completed" for this role), `eeo.*` (a yes or no about an EEO value) and
`workAuthorization.citizenship` are never computed: they need judgment. Countries are matched by name, with a
few aliases (USA, U.S., United States of America; UK, Great Britain). Short codes count only in capitals, so
"join us" isn't the United States.

## Strict matching
`strictMatch` (`protocol/src/match.ts`) accepts, with case, spacing, Unicode width and curly apostrophes aside:
the option itself; the option without its trailing parenthetical, or the parenthetical alone ("Canada (+1)",
"Structured Query Language (SQL)"); the option without a leading rank ("5 - Fluent"); and the option without a
trailing dialling code (Greenhouse's "Canada +1"). The adapters'
`matchOption` also accepts a unique prefix or substring, so "Yes" can pick "Yes, I will require sponsorship".
That's fine for the model, which reads the read-back, but not for a pass nobody checks field by field.

So autofill sends every fill with `strict: true`, and the adapters then match options only by `strictMatch`
and fail a miss with the options seen ([protocol](protocol.md)). Dropdowns and typeaheads list options only
when opened, so `checkReadBack` also checks what the page selected. A loose pick, or the adapter's own
`inexact` and `unmatched`, goes to `failed` with what got selected; the page holds that value until the model
sets the right one. This also covers an extension built before `strict`, which ignores it. Workday's
single-select prompts can still select an option themselves on Enter: that comes back as `inexact` and fails.

**Loose fills.** The city and postal code (`contact.address.city`, `contact.address.postalCode`) go without
`strict`: Oracle's city option reads "Toronto, Ontario" and the field shows "Toronto" once chosen, and a postal
code "K2K 3E9, Kanata, Ontario" (both seen live). The adapter's own match picks them, and `checkReadBack`
compares what the field shows.

## Logging
Each automatic fill is a normal `fill` event in `form-log.jsonl`, with `source` (`profile`, `answer-bank` or
`computed`), `answerId`, `auto: true`, `rule` and `was` (a value it overwrote). Rules name what chose the value:
`hint:contact.email`, `answer:how_heard`, `computed:sponsorship_now`, `row:work[1].title`,
`item:languages[0].level`, `link:links[1].url`. A fill that took a loose match is logged `ok: false` with
`error: "inexact: <selected>"`. Rows added are `add-row` events (`addButtonId`, `auto`, `ok`, `error?`), and
Oracle items `add-item` events (`list`, `item`, `auto`, `ok`, `error?`). The review page's `handoff` lists the
automatic fills by section, with what they replaced. The debug report counts fills by rule with row numbers
dropped (`row:work[].title`).

## Turning it off
`forms.autofill` in `ezapply.config.json`: `"on"` (default) or `"off"`. When it's off, `autofill_step` returns
the whole step with a note, so a run can be compared with and without autofill.

## Tests
- `companion/test/autofill.test.ts`, the planner: hints, kept and replaced values, the phone country, section
  checks, wording equality, reversed wordings, `byCompany`, sensitive and null answers, strict options, EEO,
  files, passwords and lists, skipping handled fields, `checkReadBack`, `chunkBySection`. Rows on the live Hooli
  "My Experience" step's schema (its ids, labels, kinds and hints, emptied, with a made-up profile): the rows to
  add, every part of every row, options listed only where wordings differ, education years by label, rows matched
  by company before order, extra rows, a level kept without listing. Oracle's link fields and items (a saved
  item named only by whole words), no date into a text field, and the computed answers with the posting's
  location.
- `companion/test/e2e.test.ts`, over MCP on the behavioural fixtures: the Workday step (the fills, the reasons
  left, the page's values, the log, a second call keeping everything, the switch off); a work row added and both
  rows filled `strict`; on Oracle, a link field added, both links filled, and two languages added through the
  inline form and saved.
- `extension/test/workday.test.ts`, `oracle.test.ts`: `strict` fills refuse a near match and list the options;
  `matchOption`'s strict mode.

## The live runs
**The first (Hooli, 2026-10-01, debug mode on), phase 1 only:**
- **My Information:** 10 fields filled and 2 kept in 4.1 s, with no failures and no loose matches.
- **My Experience:** LinkedIn only. Rows weren't built yet, so the agent filled the step's 38 fields itself.
- **The two question steps:** nothing filled, for two reasons, both fixed the same day:
  - every answer the agent had saved with `source: user` was treated as computed;
  - two labels differed from their saved wording only by a parenthetical.
- **Turns:** 30 with form calls, against 34 in the 2026-09-30 Hooli run. Output tokens: 7.4k, against 9.2k.

**Replayed on that run's recorded pages** (2026-10-02, the planner as built now, with the user's profile and
answer bank): on My Experience, the same seven rows the agent added, and the same 37 row fields the agent
filled, 34 with the same value. The three that differ: one role description the agent reworded for the posting,
and the German reading and writing levels, which the agent judged a step below speaking. The field of study
matches the agent's final value, "Physics", but in that run Workday's search for exactly that found
nothing until the agent searched "Computer", so it may still fail live. On the two question steps, 8 fields,
each with the value chosen in the run. Not yet run live: everything after phase 1, including `strict` in the
adapters.
