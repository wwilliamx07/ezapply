# Library

A drop zone (or the browser's picker) for transcripts, certificates and samples, and the files there.

**Marker:** `css=.ob-step >> role=heading[name=/^Library$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Choose… | | `css=.ob-drop >> role=button[name=/Choose…/]` | The browser's picker: each file `POST library?name=` | the file chooser |
| Delete (a file) | the library has files | `role=button[name=/^Delete /]` | Asks first, then `deleteLibrary { name }` | stays |
