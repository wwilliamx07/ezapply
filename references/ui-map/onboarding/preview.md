# A template's preview

A built template's PDF under its step (resume, cover letter), in the review page's viewer without comments; it
reloads when the PDF is built again.

**Marker:** `css=.ob-preview >> role=toolbar[name="Viewer"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Zoom out | | `css=.ob-preview >> role=button[name="Zoom out"]` | A step smaller | stays |
| Zoom in | | `css=.ob-preview >> role=button[name="Zoom in"]` | A step larger | stays |
| Fit width | | `css=.ob-preview >> role=button[name="Fit width"]` | The page's width across the preview (the default) | same |
| Download | | `css=.ob-preview >> role=link[name="Download"]` | The PDF | a download |
| A link on the page | the PDF has one | `css=.ob-preview a.ez-link` | Opens it | a new tab |
