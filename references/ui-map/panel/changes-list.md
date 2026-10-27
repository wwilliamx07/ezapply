# The list of changes

The workspace changes card, open: each change's summary ("this work uses it" when the work shown needs it), its
buttons by kind, or "Being updated…" while it's worked on; what each press did; the repos put off; what couldn't be
checked. Every button is `panel.workspaceChange { key, ids, action, … }`, and the change leaves the list.

**Marker:** `css=details.ez-panel-changes[open] .ez-changes`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Update now | a template's source changed, or the profile's name or contact | `role=button[name="Update now"]` | `action: update` | stays |
| Keep the current copy | a template's source changed | `role=button[name="Keep the current copy"]` | `action: done` | stays |
| Choose the file I edit | a template imported from a copy nothing edits | `role=button[name="Choose the file I edit"]` | `action: update, pick: tex`: the system's file dialog | stays |
| Choose the folder | as above | `role=button[name="Choose the folder"]` | `action: update, pick: folder` | stays |
| I keep none | as above | `role=button[name="I keep none"]` | `action: done` | stays |
| It's my resume | a LaTeX document in `library/` | `role=button[name="It's my resume"]` | `action: update, kind: resume` | stays |
| It's my cover letter | as above | `role=button[name="It's my cover letter"]` | `action: update, kind: cover` | stays |
| Neither | as above | `role=button[name="Neither"]` | `action: done` | stays |
| Update my profile | an edited resume | `role=button[name="Update my profile"]` | `action: update`: a task for the agent | stays |
| Nothing to change | an edited resume | `role=button[name="Nothing to change"]` | `action: done` | stays |
| Read it again | a repo's new commits | `role=button[name="Read it again"]` | `action: update`: a task for the agent | stays |
| Put off for | a repo's new commits | `role=combobox[name="Put off for"]` | How long Put off puts it off | same |
| Put off | a repo's new commits | `role=button[name="Put off"]` | `action: later, hours` | stays |
| Select it again | a repo no longer selected | `role=button[name="Select it again"]` | `action: update` | stays |
| Delete its knowledge | a repo no longer selected | `role=button[name="Delete its knowledge"]` | Asks first, then `action: done, confirm` | stays |
| Later | any change but a repo's new commits | `role=button[name="Later"]` | `action: later`: hidden in this conversation until ezapply stops | stays |
| Update all N | more than one change needs no choice | `role=button[name=/^Update all \d+$/]` | `action: update` for those | stays |
| Go on anyway | Tailor documents or Fill form waits on a needed change | `role=button[name=/^Go on/]` | Sends the request held back | [A conversation](chat.md) |
| Cancel | as above | `css=.ez-changes-actions >> role=button[name="Cancel"]` | Drops the request | [A conversation](chat.md) |
