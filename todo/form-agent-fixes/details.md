# Form-filling fixes: details

- **Clearing an input.** Check whether the text driver's empty value is refused, ignored by the site, or never
  sent; clearing should read back empty.
- **Back on the review page.** Find whether the adapter finds no back button there or `back` refuses it.
- **Refilling after back and forward.** The fields read as empty though the page shows values: a read that runs
  before the page has put them back, or a value the reader doesn't see. `get_form` should report them as filled.
- **Certification checkboxes.** A rule in the apply skill (or the answers) that an attestation the user's answers
  make true is always ticked, so the choice doesn't vary between runs.

**References when built:** `components/adapters.md`, the site's page under `components/sites/`, `mcp-tools.md`,
`status.md`.
