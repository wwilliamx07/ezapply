---
name: ezapply-answers
description: Review, change or tidy the user's stored screening-question answers.
---

# Answer bank review

1. `answers_check`, and read `profile/answers.yaml`.
2. Show a compact table: id, question (shortened), answer, sensitive; the unanswered ones separately, with their
   suggestions.
3. Apply the user's changes, then `answers_check` until clean:
   - `answer: null` means "ask me every time", unless the entry has a `source`: then it's answered from that
     profile path, and a change belongs in `profile.yaml`.
   - `sensitive: true` means asked on every application. An answer the user says to use from now on gets
     `sensitive: false`.
   - Company-specific answers: `{ default, byCompany: { "Example Co": "Yes" } }`.
   - **Your judgement:** merge duplicate entries (keep the clearer `canonical`, the other's wordings as
     `variants`), and move a wording that landed on the wrong entry to the one it means.
   - A new entry needs a snake_case `id`, a `canonical` question, and `answer` or `null`.
