# Denying with a reason

The approval card with a box for why not, or what to do instead.

**Marker:** `role=textbox[name="Reason for denying"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Reason for denying | | `role=textbox[name="Reason for denying"]` | The reason | stays |
| Deny | | `css=.ez-pcard-reply >> role=button[name=/^Deny$/]` | `panel.permission { allow: false, reason }` | [A conversation](chat.md), [List](list.md) |
| Back | | `css=.ez-pcard-reply >> role=button[name=/^Back$/]` | The card's buttons again | [Approval card](permission.md) |
