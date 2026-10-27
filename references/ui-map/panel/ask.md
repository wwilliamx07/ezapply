# A question card

Under Needs you, at the conversation's end: the agent's questions (`ask_user`), each by its type (radios, checkboxes
with Other, a text field or box), the suggestion filled in and marked, why it's asked, "(optional)" ones,
sensitive ones flagged, and Save for next time where offered. One from the other conversation is labelled with it.

**Marker:** `css=section.ez-pcard:not(.ez-pcard-perm):not(.ez-handoff)`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| A question's answer | | `css=.ez-pcard .ez-q input, .ez-pcard .ez-q textarea` | The answer: an option, Other's text, the text, Save for next time | same |
| Send answers | not replying in words | `role=button[name="Send answers"]` | Checks the answers (each problem under its question), then `panel.answer`: the card leaves | [A conversation](chat.md) |
| Reply in chat instead | not replying in words | `role=button[name="Reply in chat instead"]` | A box for words in place of the answers | [Reply](ask-reply.md) |
