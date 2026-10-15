# Fill form is missing where the posting and the form share a page: details

- The cause is read from the code, not yet confirmed on the page that showed it: check that the tab's site came
  through as `greenhouse` (`browser_status`). If it was `generic`, the signature missed the page and this is a
  detection bug in the Greenhouse site instead.
- An embedded Greenhouse form on a careers page has the same shape: the posting's URL is the careers page, the
  form is in a frame. `tab` looks only at the tab's own site, not its `frames`, so check that case with it.

**References when built:** `components/ui.md` ("This tab" and Fill form), `components/companion.md` if the panel
service's description changes.
