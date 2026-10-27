# Writing a comment's note

The quoted words and a box for what should change there, the selection kept highlighted. Ctrl+Enter adds it,
Escape cancels.

**Marker:** `role=dialog[name="Comment on the selected text"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| What should change here? | | `role=textbox[name="What should change here?"]` | The note | stays |
| Cancel | | `role=dialog >> role=button[name="Cancel"]` | Drops it | [The review](page.md) |
| Add comment | | `role=button[name="Add comment"]` | Adds it to the document's comments, the active one (disabled until there's a note) | [The review](page.md) |
