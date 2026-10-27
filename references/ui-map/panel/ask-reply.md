# Replying to a question card in words

The question card with a box in place of its buttons (its questions stay), for answering in the user's own words.

**Marker:** `role=textbox[name="Reply in the chat"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Reply in the chat | | `role=textbox[name="Reply in the chat"]` | The reply | stays |
| Send reply | | `role=button[name="Send reply"]` | `panel.reply` (disabled until there's text): the card leaves | [A conversation](chat.md) |
| Back to the questions | | `role=button[name="Back to the questions"]` | The questions again | [Question card](ask.md) |
