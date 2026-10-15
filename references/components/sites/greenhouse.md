# Greenhouse (`packages/sites/src/greenhouse/`)

One of [the sites](../sites.md): only what this site does differently from [the engine](../adapters.md).

**Pages.** `job-boards.greenhouse.io/<board>/jobs/<id>`, the older `boards.greenhouse.io`, the EU hosts
(`job-boards.eu.greenhouse.io`), and the embed a company's careers page loads in a frame
(`…/embed/job_app?for=<board>&token=<id>`). The posting and the form share one page. An embed is Greenhouse
whether it's the tab's own URL or a frame inside a company's careers page; in a frame the form tools act on it
there ([embedded applications](../extension.md#embedded-applications)), with its board from `for` and its job from
`token`.

**Fields**, in the form (`form#application-form`, or `form.application--form`), in page order:
- `.text-input-wrapper`: a text input or textarea;
- `.select__container`: a react-select list ([driven through its props](../adapters.md#react-select-through-its-props));
  the phone's country list is one. Three load as you type: Location (City) (`candidate-location`, no `loadOptions`:
  the page fetches from its location provider on `onInputChange` and confirms a choice with it), and the education
  block's School and Discipline (`school--N`, `discipline--N`: react-select-async-paginate over the board's
  education API, a 300 ms debounce). Greenhouse's select wrapper holds `menuIsOpen` itself, opened by a key-up in the
  control and closed by Escape, a choice or blur, so the adapter gives the driver `menu`: it calls the props'
  `onKeyUp` with `KeyA` or `Escape` (read from the board's bundle). Without the menu open, School and Discipline
  never load;
- `.file-upload`: resume and cover letter, file names from `.file-upload__filename`, removed by its
  "Remove file" button;
- `fieldset`s (not the phone's): radios, a checkbox group, or a lone checkbox.

Prompts are the controls' labels (`promptOf`), help text the `<id>-description` element, errors `aria-invalid` with
its message or `#<id>-error`. Required: `aria-required`, or a required mark in the label. Ids go through
`cssEscape` before they're put in a selector: a multi-select's id ends in `[]` (`question_1000000172[]`), which
is not a valid CSS identifier as written.

**Ids.** Greenhouse's own fields by control id (`application.first_name`); its custom questions, keyed by long
numbers (`question_1000000172`), by the prompt's slug, which reads better and is as stable. Section: the heading
before the field within the form (the EEO block's "Voluntary Self-Identification"), else "Application".

**Hints** by id: names, email, phone, the phone's country (`contact.phone.countryCode`), and the EEO fields
(gender, Hispanic or Latino, race, veteran status, disability); by prompt: LinkedIn, GitHub, website or
portfolio. The country list's options are "Canada +1": the option match takes "Canada" for it
([drivers](../adapters.md#widget-drivers)).

## What was verified
Built from a live application page rendered by headless Edge, then checked on live public forms with fake values,
never submitting ([how the boards were verified](../sites.md#what-was-verified-and-how)):
- **Greenhouse** (one company's board): text fields, the phone's country list ("Canada" → "Canada +1"), the
  sponsorship and EEO lists, a dummy file attached and removed (Greenhouse keeps it in the page until Submit),
  `go_next` refusing Submit. Two fixes came from it: react-select chosen through `onChange` (synthetic clicks
  don't open it without page focus) and read from the current fiber.

**Not yet tried:** the confirmation page, and a real application.
