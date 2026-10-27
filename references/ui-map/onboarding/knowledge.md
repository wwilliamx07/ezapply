# Your projects, read

Each selected repository, read (and when) or not, and the agent's task while it reads them. Before any is selected,
a line saying to choose them first.

**Marker:** `css=.ob-step >> role=heading[name=/^Your projects, read$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Have the agent read N repositories | a selected repository isn't read | `role=button[name=/^Have .+ read \d+ repositor/]` | Task `index-repos` | stays |
