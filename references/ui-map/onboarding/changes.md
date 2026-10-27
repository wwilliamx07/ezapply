# The Changes list

Above the step while anything in the workspace is out of date: the list the panel's
[workspace changes card](../panel/changes-list.md) shows, each press `change { ids, change, … }`, and the change
leaves the list (the list goes with the last one).

**Marker:** `role=region[name="Changes"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Update now | a template's source changed, or the profile's name or contact | `css=.ob-changes >> role=button[name="Update now"]` | `change: update` | [Changes](changes.md), [the step](frame.md) |
| Keep the current copy | a template's source changed | `css=.ob-changes >> role=button[name="Keep the current copy"]` | `change: done` | [Changes](changes.md), [the step](frame.md) |
| Read it again | a repo's new commits | `css=.ob-changes >> role=button[name="Read it again"]` | `change: update` | [Changes](changes.md), [the step](frame.md) |
| Put off for | a repo's new commits | `css=.ob-changes >> role=combobox[name="Put off for"]` | How long Put off puts it off | same |
| Put off | a repo's new commits | `css=.ob-changes >> role=button[name="Put off"]` | `change: later, hours` | [Changes](changes.md), [the step](frame.md) |
| Later | any change but a repo's new commits | `css=.ob-changes >> role=button[name="Later"]` | `change: later` | [Changes](changes.md), [the step](frame.md) |
| Update all N | more than one change needs no choice | `css=.ob-changes >> role=button[name=/^Update all \d+$/]` | `change: update` for those | [Changes](changes.md), [the step](frame.md) |
