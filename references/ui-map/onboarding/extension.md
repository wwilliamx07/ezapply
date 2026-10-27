# Browser extension

Connected in which browser; else the steps to load it in a Chromium browser, the folder to load (copyable), and the
button that opens the pairing window (Waiting for the extension… while it's open). A warning when the extension
isn't built.

**Marker:** `css=.ob-step >> role=heading[name=/^Browser extension$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Copy | not connected, and the folder is known | `css=.ob-step >> role=button[name=/^(Copy\|Copied)$/]` | Copies the extension's folder | stays |
| I've loaded it: connect | not connected | `role=button[name=/^(I've loaded it: connect\|Waiting for the extension…)$/]` | `pair`: the 15-minute pairing window | stays |
