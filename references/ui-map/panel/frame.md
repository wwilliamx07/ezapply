# The panel's frame

On every screen of the panel: the header's menu, the banners under the header, and the agent settings at the
foot. When ezapply isn't running or the extension isn't paired, a banner says so and the rest is disabled.

**Marker:** `css=.ez-panel-head`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Menu | | `css=summary[aria-label="Menu"]` | Opens the menu | [Menu](menu.md) |
| Continue setup | setup isn't finished | `role=button[name="Continue setup"]` | `panel.open { what: "setup" }`: the setup page in a tab | stays |
| Dismiss | an error is shown | `role=button[name="Dismiss"]` | Hides the error | stays |
| Agent | more than one agent is installed | `role=combobox[name="Agent"]` | `savePrefs`: the agent from the next message | stays |
| Permission mode | | `role=combobox[name="Permission mode"]` | `savePrefs`: the agent's permission mode | stays |
| Model | | `role=combobox[name="Model"]` | `savePrefs`: the agent's model | stays |
| Effort | the agent takes one (Claude Code, Codex) | `role=combobox[name="Effort"]` | `savePrefs`: the agent's effort | stays |
