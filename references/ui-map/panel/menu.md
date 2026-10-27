# The menu

The header's menu, open over any screen. A click anywhere else closes it.

**Marker:** `css=details.ez-panel-menu:not(.ez-panel-details)[open]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Setup | | `role=button[name=/^Setup$/]` | `panel.open { what: "setup" }`: the setup page in a tab (disabled while not connected) | stays |
| Extension settings | | `role=button[name="Extension settings"]` | `openSettings`: the extension's options page | stays |
