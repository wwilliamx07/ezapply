# Editing a comment

A comment in the panel with its note in a box.

**Marker:** `css=.ez-comment textarea`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Comment N | | `css=.ez-comment textarea` | The note | stays |
| Cancel | | `css=.ez-comment >> role=button[name="Cancel"]` | Keeps the note as it was | [The review](page.md) |
| Save | | `css=.ez-comment >> role=button[name="Save"]` | The new note (disabled while empty) | [The review](page.md) |
