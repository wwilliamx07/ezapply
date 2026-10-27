# Screening questions

How many are answered; the unanswered ones, eight at a time, a suggestion filled in (a sensitive one's too); then,
read-only, the questions answered from the profile, with what it holds.

**Marker:** `css=.ob-step >> role=heading[name=/^Screening questions$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| A question's answer | a question is unanswered | `css=.ob-questions input` | The answer (empty: asked every time) | stays |
| Save these | a question is unanswered | `role=button[name=/^Save (these \d+\|this answer)$/]` | `answers { answers }` | stays |
