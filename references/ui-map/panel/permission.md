# An approval card

Under Needs you: what the agent wants to do, named as the one asking ("Claude Code wants to run a command"), its
description, and the command or the file and the change whole. A terminal chat's shows on every screen, labelled
"From a terminal chat".

**Marker:** `css=.ez-pcard-perm:has(> .ez-pcard-actions)`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Allow | | `role=button[name="Allow"]` | `panel.permission { allow: true }`: the card leaves | [A conversation](chat.md), [List](list.md) |
| Deny | | `css=.ez-pcard-perm > .ez-pcard-actions >> role=button[name=/^Deny$/]` | `panel.permission { allow: false }` | [A conversation](chat.md), [List](list.md) |
| Deny with a reason | | `role=button[name="Deny with a reason"]` | A box for why | [Deny with a reason](permission-reason.md) |
