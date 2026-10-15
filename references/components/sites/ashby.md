# Ashby (`packages/sites/src/ashby/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

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

## What was verified
Built from a live application page rendered by headless Edge, then checked on live public forms with fake values,
never submitting ([how the boards were verified](../sites.md#what-was-verified-and-how)):
- **Ashby** (one company's posting): text, the Yes/No buttons, a textarea, and the location by its full name; a city's
  name alone matched several places and came back with their suggestions, as intended. The consent field's selector came
  from this run.
- **Ashby, a real application** (through the extension): text fields, the location (after the
  city alone matched several places and the agent searched), the Yes/No buttons, the resume upload. Every radio
  and checkbox group was missing (above); after the fix, filling a radio group and two
  checkbox groups on the live page (fake values, never submitted) took and read back. The graduation date is a
  date picker read as text: the agent typed a month and year and the page showed the first of that month.

**Not yet tried:** the confirmation page.
