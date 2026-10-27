# The document requests menu

Opened from Tailor documents' arrow (upwards): the requests for one document. Each is `panel.send` to the
Documents conversation, after the same workspace changes check as Tailor documents. Empty while Tailor documents is
disabled. A request sent, the menu closes.

**Marker:** `css=details.ez-split-menu[open]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| More document requests | | `css=details.ez-split-menu[open] > summary` | Closes the menu | [A conversation](chat.md) |
| Resume only | Tailor documents can send | `role=button[name="Resume only"]` | `/ezapply-resume …` | [A conversation](chat.md) |
| Cover letter only | as above | `role=button[name="Cover letter only"]` | `/ezapply-cover-letter …` | [A conversation](chat.md) |
| Put them in one PDF | as above | `role=button[name="Put them in one PDF"]` | A request naming `bundle_build` | [A conversation](chat.md) |
