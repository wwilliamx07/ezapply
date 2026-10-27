# Preferences

Whether a document is shown before it's attached, how the agent writes (tone, emphasis, never mention, targets,
cover letters) and Save preferences; below, saved the moment it's changed, whether to notify.

**Marker:** `css=.ob-step >> role=heading[name=/^Preferences$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Show it to me first | | `role=radio[name=/Show it to me first/]` | Approval before attaching (the default) | same |
| Attach it as soon as it's built | | `role=radio[name=/Attach it as soon/]` | Attaching at once | same |
| A preference | | `css=.ob-step textarea` | Its words | stays |
| Save preferences | | `role=button[name="Save preferences"]` | `preferences { … }` | stays |
| Notify me | | `role=checkbox[name=/^Notify me/]` | `notifications { turnEnd }`, at once | stays |
