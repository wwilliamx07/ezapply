# Application forms on an employer's own page: details

**Why.** Some careers pages show the application straight in their own page, with no frame. Nothing finds it:
the extension tells a page's site by its body (`references/components/extension.md`, "Telling a page's site"),
and every signature is a provider's own markup.

**What such a page is.** Submitting through Greenhouse's Job Board API, Lever's postings API or Ashby's
`applicationForm.submit` takes the employer's secret API key, so a careers page can't send an application to the
provider from the browser. A frameless application is the employer's own form, posted to its own server, which
forwards it. It has none of the provider's markup, so no per-provider signature (the earlier idea: a `form`
posting to `greenhouse.io`) finds it, and the provider's definition couldn't read it anyway. What fits is one
definition for plain HTML forms, used only when asked for. An embedded application differs: its frame is the
provider's own page, so the provider's signature and definition work there unchanged.

**Part 1: a `generic` definition** (`packages/sites/src/generic/`, outside `SITES`, so the conformance and
knowledge tests need to know it), on the engine, shared drivers only.
- **The form.** Each `<form>`, or for a page without one (a React app), the smallest element holding an email
  input and a submit control. It counts as an application when it has an email input and either a file input or
  at least four labelled fields. A form with a password input never counts (sign-in and account forms stay the
  user's). Among several, the one with the most fields. None → `pageKind: unknown`, no fields.
- **Fields**, in page order, inside the form only:
  - text, email, tel and url inputs and textareas: `textDriver`; number inputs `textDriver("number")`; date
    inputs `dateInputDriver`; native selects: `selectDriver`;
  - radios and checkboxes grouped by `name` (container: their `fieldset`, else their closest common ancestor):
    `radioDriver`, `checkboxGroupDriver`, a lone one `checkboxDriver`;
  - file inputs, visible or hidden behind a label or button: `fileDriver`, names from the input's `files`;
  - `role=combobox` with its listbox (`aria-controls`): `comboboxDriver`;
  - never hidden, password, search, submit or button inputs. A control it can't place (no prompt, a custom
    widget) is left out and counted in a message, so the agent tells the user to fill it.
- **Prompts:** `promptOf` (label `for`, wrapping label, `aria-labelledby`, `aria-label`), else the placeholder;
  a group's from its legend. **Required:** `required`, `aria-required`, or a trailing `*`. **Errors:**
  `ariaError`, else `[role=alert]` inside the form.
- **Ids:** the control's `name`, slugged (`first_name`, `urls[LinkedIn]` → `urls-linkedin`), else its `id`, else
  the prompt's slug. **Section:** the nearest heading or legend before the field within the form, else
  "Application".
- **Hints** from the HTML `autocomplete` tokens first, since they're a standard and many forms set them:
  `given-name`, `additional-name`, `family-name`, `name` (full name), `email`, `tel`/`tel-national`,
  `tel-country-code`, `address-level2` (city), `address-level1` (region), `postal-code`, `country`/`country-name`.
  Then by `name` and by prompt, as the boards do: first and last name, email, phone, LinkedIn, GitHub, website or
  portfolio. Nothing else is guessed; the planner and the agent handle the rest by prompt.
- **One page, Submit at the end**, like the boards: `singlePageKind`, `singlePageMessages`, `lastPage: true`,
  `next` refuses. **Job title** (`titledJob`): the first visible `h1`, else `document.title`.
- **Submit, broadly:** `isSubmit` is `isSubmitByText`, plus any button reading "Apply" inside the form, plus the
  form element itself, so the guard also blocks a synthetic `submit` event. A false positive only blocks a
  press; it never submits.
- **Waits:** the standard ones.

**Part 2: used only when asked, never by detection.** Almost any page has a form, so `generic` has no signature
and no URL rule. It isn't in `SITES`, and `browser.status` never lists a tab as one.
- **Registry:** a `GENERIC: SiteInfo` beside the registry (`packages/sites/src/registry.ts`): tenant the page's host; job
  any registry site's `hostPageJob(url)` (a careers page with `?gh_jid=` still names its Greenhouse job).
  `adapterOf` (`background/forms.ts`) and `build.mjs` know it, so it gets its own `generic-main.js`. `SiteId` already has `generic`.
- **Extension** (`background/forms.ts`): a form call with an explicit `tabId` on a page that's no registry
  site's, where no frame is one either (a framed board always wins), injects the generic adapter instead of
  failing with "not an application page". It still fails, with today's message, when the page has no form that
  counts. Without a `tabId`, `resolveTab` still picks registry sites only.
- **Companion** (`forms/service.ts`): the agent's `tabId` already reaches the extension when the tab has no form
  site (`target()` falls back to `own`). `decide` returns early for a tab that isn't a form site, so nothing would
  be logged or credited: let it go on when the extension's answer says `adapter: "generic"`. Matching then works
  on the binding or the page's title (the URL says nothing); `posting_activate { id, tabId }` binds such a tab
  like any other.
- **Skill** (`ezapply-apply`): when the application is on the employer's own page (Apply opens no known site),
  call `get_form` with that tab's `tabId`. Say to the user that this form isn't from a known site, and check every
  field on the page after filling, since the generic reader may have missed custom widgets.

**Part 3 (only if a saved page shows it): a provider's markup served on the employer's host**, through a proxy or
a copied render. The signature finds it already, but the tenant and job are read from a URL that isn't the
provider's. `tabSite` (`forms/match.ts`) and the engine's `extract` would then fall back to the page's
`hostPageJob`, and to the board and job ids in the page where it carries them.

**Tests.**
- Generic, on synthetic forms: an application form read with its prompts, ids, groups and hints; a newsletter,
  search or sign-in form not counted; a page with two forms picks the application; a custom widget counted and
  reported; Submit blocked when pressed synthetically, including a `submit` event on the form. It also passes
  the conformance test every definition does (`sites/test/conformance.test.ts`), with a saved page from a real one when there is
  one.
- Extension: a page with no site and no frame, asked by `tabId`, gets the generic adapter; without `tabId`, or
  with a framed board, it doesn't.
- Companion: a generic answer is logged and credited by binding or title; nothing changes for registry
  sites.

**References when built:** `components/sites.md` (a Generic section), `components/adapters.md` (replace "No
generic definition"), `components/extension.md` (replace "Not covered"), `protocol.md` (`GENERIC`),
`mcp-tools.md` (which tab), `security.md` (the submit guard on arbitrary pages; password forms excluded),
`status.md`.

**Challenges and open questions.**
- Custom widgets are the employer's own (a home-made dropdown, a date picker). The generic reader finds only what
  standard markup says; the rest is the user's. How much to try, beyond `role=combobox`, needs real pages.
- The forms' quality varies: unlabelled inputs, prompts in neighbouring `div`s. A prompt from the nearest
  preceding text is tempting but often wrong; start strict.
- A form that forwards to Workday or Oracle may still send the user to that site for a later step: it's then a
  registry site from that point on.
