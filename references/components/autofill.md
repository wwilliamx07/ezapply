# Deterministic autofill (`autofill_step`)

The companion fills what the profile and the answer bank settle on an application step, without the model,
and hands the model only the rest. The planner is `companion/src/forms/autofill.ts` (`planStep`,
`checkReadBack`, `strictMatch`, `normLabel`). The tool is `autofill_step` in `mcp/tools/forms.ts`, run by
`FormsService.autofillStep`.

**Why.** In the four applications of 2026-09-30 and 2026-10-01, 87 of 128 fills copied a profile value
(`source: profile` in `form-log.jsonl`), 7 came from the answer bank, and 34 needed the user, judgment or a
computation. The model read each step's whole schema and wrote every value back out, and every turn re-sends
the conversation. Filling the settled fields in the companion saves those tokens and turns, and gives the same
answer every time. The model stays the reviewer: it sees every value that went in.

This is phase 1. Rows, answers computed from the profile, strict matching inside the adapter, and wider
coverage are planned in `todo.md` (item 1).

## The call
`autofill_step { tabId? }` replaces the first `get_form` of a step (the `ezapply-apply` skill starts every
step with it):
1. Read the page (`form.get`). If it isn't a `step` page, if the tab belongs to another posting
   (`postingMismatch`), if `forms.autofill` is `"off"`, or if `profile.yaml` is missing or invalid, nothing is
   filled. The result is then `get_form`'s, with `filled: []` and a `note` saying why.
2. Plan the step (`planStep`), and send every planned fill in one `form.fill`.
3. Check each read-back (`checkReadBack`) and log each fill.
4. Read the step again and plan once more, skipping the fields already handled. This fills fields that
   appeared because of a fill (a province list after the country). There is never a third pass.
5. Return `get_form`'s view of the page (including the status moves and `notAttached` at review, `posting`,
   `postingMismatch`, `tabHidden` and `timingIssues`), with:
   - `sections`: only the fields left, each with `reason`. Rows marked `removable` stay even when they have
     no fields left;
   - `filled`: `{ fieldId, label, value, rule, was? }`, where `was` is a value it replaced (left from a previous
     application);
   - `failed`: `{ fieldId, label, value, rule, error?, availableOptions?, inexact? }`, where `inexact` is the
     near match the page now holds;
   - `kept`: how many fields already held the planned value.

It runs inside the tab's queue like every form call, and its fill uses `fillTimeoutSeconds`.

## Rules (`planStep`)
For each field, the first rule that applies decides.

1. **Never automatic:**
   - `password` and `file` fields;
   - a typeahead with `multiple` (which skills to list is judgment, and filling only adds);
   - a typeahead that already holds an entry other than the planned one (`multi-select`).
2. **Profile hint** (`hint.profileKey`, set by the adapters' `PROFILE_HINTS`), with a section check:
   - `work[]` and `education[]` keys are rows. They're left as `row` in phase 1, and as `section-mismatch`
     outside a `work…-N` or `education…-N` section. Workday's "Available Start Date" under Application
     Questions has the hint `work[].start`.
   - Identity and contact keys are left as `section-mismatch` in a section about someone else (references,
     emergency contacts, relatives, a supervisor).
   - `contact.phone.countryCode` takes the profile's country. Workday lists "Canada (+1)", and Canada and the
     US share +1.
   - `contact.phone.type` is capitalised (`mobile` → "Mobile").
   - `eeo.*` fills only from the profile. It's left as `eeo-unset` when the value is missing, and as
     `eeo-decline` when the profile says decline (the model picks the form's wording).
   - Any other key is the profile value as stored, or `not-in-profile` when it's unset.
   - `answers.<id>` keys use that answer-bank entry, as in rule 3.
3. **Answer bank by wording.** The label, normalised by `normLabel` (NFKC, lowercase, punctuation, a trailing
   "*" and "(required)" removed, spaces collapsed), must equal an entry's `canonical` or one of its
   `variants`. Equality only.
   - `sensitive` entries are left as `sensitive`, `answer: null` as `ask-user`, and entries with `source`
     (computed from the profile) as `from-profile`.
   - The value is `byCompany` for the posting's company (case and spacing aside), else `default`, else the
     plain answer.
   - **Reversed wordings:** a variant whose count of negations ("not", "no", "never", "without", "…n't") has
     the other parity from the canonical question's is a question asked the other way round. The skill saves a
     form's wording as a variant, and only the model flips yes and no for it. So the planner leaves it as
     `reversed-wording` and never fills it.
4. **Already right:** a field whose current value equals the planned one is kept. Text is compared trimmed;
   options with `strictMatch`, or by the last part of a nested path ("Job Board > LinkedIn" against
   "LinkedIn").
5. Anything else is `no-rule`. A typeahead holding entries with no rule is `multi-select`.

**Widgets.** Text, textarea, number, dropdown and typeahead get the value as is. Radios and checkbox groups
list their options in the schema, so the option is chosen here with `strictMatch` and sent as its exact text
(a checkbox group as a one-entry list); no match is `no-strict-match`. Dates and single checkboxes have no
phase 1 rule.

**Strict matching.** `strictMatch` accepts the exact option, the option without its trailing parenthetical,
or the parenthetical alone, with case and spacing aside. The adapters' `matchOption` also accepts a unique
prefix or substring, so "Yes" can pick "Yes, I will require sponsorship". That's fine for the model, which
reads the read-back, but not for a pass nobody checks field by field. Dropdowns and typeaheads list options
only when opened, so `checkReadBack` checks what the page selected. A loose pick, or the adapter's own
`inexact` and `unmatched`, goes to `failed` with what got selected. The page holds that value until the model
sets the right one.

## Logging
Each automatic fill is a normal `fill` event in `form-log.jsonl`, with `source` (`profile` or `answer-bank`),
`answerId`, `auto: true` and `rule` (`hint:contact.email`, `answer:how_heard`). A fill that took a loose match
is logged `ok: false` with `error: "inexact: <selected>"`.

## Turning it off
`forms.autofill` in `ezapply.config.json`: `"on"` (default) or `"off"`. When it's off, `autofill_step` returns
the whole step with a note, so a run can be compared with and without autofill.

## Tests
- `companion/test/autofill.test.ts`, the planner: hints, kept and replaced values, the phone country,
  rows and section checks, wording equality, reversed wordings, `byCompany`, sensitive, null and computed
  answers, strict options, EEO, files, passwords and lists, skipping handled fields, `checkReadBack`.
- `companion/test/e2e.test.ts` ("autofills what the profile and answer bank decide"), over MCP on the Workday
  behavioural fixture: the fills, the reasons left, the page's values, the log, a second call keeping
  everything, and the switch off.

Not yet seen live (see [status.md](../status.md)).
