# The list of applications

The panel's first screen: ezapply's mark, the status dot, "Applications" and **Capture** in the header; the general
card pinned under it; then the applications grouped as Needs you, Working, Open and Done, each row saying what it
waits on, what the agent is doing in it, or where it stands. Cards from a terminal chat wait here too.

**Marker:** `role=heading[name="Applications"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Capture | | `role=button[name="Capture"]` | `capture`: the current tab as a posting, then opens it; a capture that fails shows why | [Application](application.md), [List](list.md) |
| An application's row | there are applications | `css=.ez-app-open` | Opens its conversation | [Application](application.md) |
| Stop (an application) | an agent works in it | `css=.ez-app button[aria-label^="Stop "]` | `panel.stop` for each of its conversations an agent works in | stays |
| General | connected | `css=.ez-general-open` | Opens the general conversation | [General](general.md) |
| Stop (General) | an agent works in it | `css=.ez-general-card button[aria-label="Stop General"]` | `panel.stop { key: "general" }` | stays |
