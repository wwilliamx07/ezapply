# Employer's own forms beyond plain HTML: details

The generic definition (`packages/sites/src/generic/`, `references/components/sites.md`, "Employer's own forms")
reads native controls in a `<form>`, counts what it leaves out in `messages`, and runs only on a tab a call names.
What's left needs real pages: none has been saved yet (`references/status.md` names the live run).

**1. ARIA comboboxes.** `role=combobox` with its listbox (`aria-controls`), through `comboboxDriver`, prompted by
`promptOf`. Today they're counted as left out (`CUSTOM` in `generic/definition/site.ts`); take them out of that
count once read. Other home-made widgets (date pickers, styled dropdowns without ARIA): only what saved pages show.

**2. A form without `<form>`** (a React app): the smallest element holding an email input and a submit control,
counted as an application by the same rule (`isApplication`). Its controls are then the element's own, not
`form.elements`; `isSubmit` can't use the form element, so the guard relies on the button tests alone.

**3. Only if a saved page shows it: a provider's markup on the employer's host**, through a proxy or a copied
render. The signature finds it already, but the tenant and job are read from a URL that isn't the provider's.
`tabSite` (`companion/src/forms/match.ts`) and the engine's `extract` would then fall back to the page's
`hostPageJob`, and to the board and job ids in the page where it carries them.

**Also open.**
- Prompts in neighbouring `div`s with no label: a prompt from the nearest preceding text is tempting but often
  another question's. Decide from saved pages.
- Choices straight inside the form, with no element of their own around them, are left out today (their only
  common ancestor is the form): read them by name with a driver scoped to the group, if real pages do this.
- A form that forwards to Workday or Oracle may send the user there for a later step: that page is then a registry
  site's, and nothing more is needed.

**Tests:** each on the saved page that showed it, plus a synthetic case in `generic/test/generic.test.ts`; the
saved page becomes the conformance page (`generic/test/page.ts`).

**References when built:** `components/sites.md` ("Employer's own forms"), `status.md`.
