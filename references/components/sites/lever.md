# Lever (`packages/sites/src/lever/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

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

## What was verified
Built from a live application page rendered by headless Edge, then checked on live public forms with fake values,
never submitting ([how the boards were verified](../sites.md#what-was-verified-and-how)):
- **Lever** (one company's posting): every kind on the page, after the location field's key fix; the consent checkbox's
  prompt and the survey questions' ids came from this run.

**Not yet tried:** uploads, the confirmation page, and a real application.
