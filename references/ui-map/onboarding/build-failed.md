# A build that failed

Under an import or a build: "It didn't build", its first error and the hint, and a button handing the fix to the
agent, which changes only what this computer needs, never the text.

**Marker:** `role=button[name=/to fix the build$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Ask the agent to fix the build | | `role=button[name=/to fix the build$/]` | Task `fix-template-build` | stays |
