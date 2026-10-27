# A document in the viewer

A readable PDF: the toolbar (page n of m, zoom, Fit width, Changes when there's an earlier version, Download), its
pages drawn by pdf.js with their text layer, links over the text, the changes since the last review marked, and
each comment's highlight with its number in the margin. Keys outside a text field: ← → a page, + − zoom, 0 fit.

**Marker:** `css=.ez-main >> role=toolbar[name="Viewer"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Zoom out | | `css=.ez-main >> role=button[name="Zoom out"]` | A step smaller | stays |
| Zoom in | | `css=.ez-main >> role=button[name="Zoom in"]` | A step larger | stays |
| Fit width | | `css=.ez-main >> role=button[name="Fit width"]` | The widest page across the viewer (the default) | same |
| Changes | there's an earlier version to compare | `css=.ez-main .ez-toolbar >> role=button[name="Changes"]` | Shows or hides what changed | stays |
| Download | | `css=.ez-main >> role=link[name="Download"]` | This version's bytes | a download |
| A link on the page | the page has a web or mail link | `css=.ez-main a.ez-link` | Opens it | a new tab |
| A link within the document | the page links to another page | `css=.ez-main button.ez-link` | Scrolls to that page | same |
| A comment's number | the document has comments | `css=.ez-main button.ez-margin-n` | Makes it the active comment | same |
| A line of its text | | `css=.ez-main .textLayer span` *(triple-click)* | Selects it | [Comment button](comment-button.md) |
