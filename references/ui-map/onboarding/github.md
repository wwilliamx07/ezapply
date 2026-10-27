# GitHub

Logged in as whom; else, without an app, a choice of creating one or connecting one made elsewhere, and Continue on
GitHub. A port mismatch shows as a warning.

**Marker:** `css=.ob-step >> role=heading[name=/^GitHub$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Create a new one | no app yet | `role=radio[name=/Create a new one/]` | The choice (the default) | same |
| I already have one | no app yet | `role=radio[name=/I already have/]` | The choice | same |
| Continue on GitHub | not logged in | `role=button[name="Continue on GitHub"]` | Opens a tab in the click, then `github`, and points the tab at the address given | a new tab |
