---
name: answers
description: Review and tidy the screening-question answer bank (profile/answers.yaml), including answers learned while filling applications. Use when the user wants to see, change or clean up their stored answers.
---

# Answer bank review

1. Run `answers_check` and read `profile/answers.yaml`.
2. Show a compact table: id, question (shortened), answer, sensitive. List unanswered ones separately with
   their suggestions.
3. Apply the user's changes. Rules:
   - `answer: null` means "ask me every time". `sensitive: true` means always ask, even if answered.
   - Company-specific answers use `{ default: ..., byCompany: { "Acme": "Yes" } }`.
   - New wordings seen on forms go into `variants` of the matching entry, not into new entries.
   - Merge duplicates, keeping the clearer `canonical`.
   - New entries need a snake_case `id`, a `canonical` question, and `answer` or `null`.
4. Run `answers_check` after editing, and fix any errors it reports.
