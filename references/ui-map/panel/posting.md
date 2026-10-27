# The posting popover

Open from an application's header: the role, company, site and deadline, the requirement chips, each document
(approved, or waiting for your review), and what can be done to the posting. A click elsewhere closes it.

**Marker:** `css=details.ez-panel-details[open]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Posting and documents | | `css=details.ez-panel-details[open] > summary` | Closes the popover | [Application](application.md) |
| A document | the posting has documents | `css=.ez-panel-doc .ez-linklike` | `panel.open { what: "file" }`: the PDF in a tab | stays |
| Delete (a document) | an approved document | `role=button[name=/^Delete .+\.pdf$/]` | Asks first, then `panel.deleteDocument` (its LaTeX source stays) | stays |
| Review | a document waits in an open review | `role=button[name=/^Review$/]` | `panel.open { what: "review" }`: the review's tab again | stays |
| Mark submitted | the posting isn't submitted or archived | `role=button[name="Mark submitted"]` | `panel.markSubmitted`: to Done | stays |
| Mark open | the posting is submitted | `role=button[name="Mark open"]` | `panel.markOpen`: back to Open | stays |
| Reset Conversation | | `role=button[name="Reset Conversation"]` | Asks first, then `panel.reset` for the conversation shown | stays |
| Delete posting | | `role=button[name="Delete posting"]` | Asks first, then `panel.deletePosting` (disabled while an agent works in it) | [List](list.md) |
