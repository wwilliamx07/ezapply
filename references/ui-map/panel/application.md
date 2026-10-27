# An application

A posting's conversation: its role, company and site in the header, the button of the posting popover (with how
many documents it has, amber while one waits for review), and the switch between its two conversations. The rest
is [a conversation](chat.md).

**Marker:** `role=tablist[name="Conversation"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Posting and documents | | `css=summary[aria-label^="Posting and documents"]` | Opens the posting popover | [Posting popover](posting.md) |
| Documents | | `role=tab[name=/^Documents/]` | Shows the conversation that tailors its documents | same |
| Application | | `role=tab[name=/^Application/]` | Shows the conversation that fills its application | same |
