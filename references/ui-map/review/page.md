# The review

"Review before attaching" and the posting; the documents on the left, each with its pages, whether it changed
since the last review, and Approved, Changes or To decide; the selected one in the middle (in
[the viewer](document.md), or why it can't be shown); its panel on the right; the counts along the bottom. Drafts
are kept in the tab's session storage.

**Marker:** `role=heading[name="Review before attaching"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| A document | | `css=button.ez-doc` | Selects it | same |
| A link | the document has web or mail links | `css=.ez-linklist a` | Opens it | a new tab |
| A change since the last review | the document changed and its text then was kept | `css=button.ez-change` | Shows it on the page, the changes marked | stays |
| A comment's quote | the document has comments | `css=button.ez-comment-quote` | Shows it on the page | same |
| Edit comment N | the document has comments | `role=button[name=/^Edit comment \d+$/]` | Its note in a box | [Editing a comment](comment-edit.md) |
| Remove comment N | the document has comments | `role=button[name=/^Remove comment \d+$/]` | Removes it (the document is to decide again) | stays |
| Anything else to change? | | `role=textbox[name="Anything else to change?"]` | A request for the whole document (takes back an approval) | stays |
| Approve Document | the document is to decide, and another is left | `role=button[name="Approve Document"]` | Approves it; on to the next document to decide | stays |
| Request Changes | the document asks for changes, and another is left | `role=button[name="Request Changes"]` | On to the next document to decide | stays |
| Undo approval | the document is approved | `role=button[name="Undo approval"]` | To decide again | stays |
| Send to the agent | the last document to decide, or every one decided | `role=button[name=/^Send to /]` | `POST answer`; the tab closes, or says it was sent | [Sent](sent.md) |
