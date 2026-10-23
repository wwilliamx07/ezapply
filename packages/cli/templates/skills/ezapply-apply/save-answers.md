# Save what got resolved

When a stored answer matched none of the field's options and the user (or your judgment, which the user then
confirms) picked one, or the user answered a question the bank didn't have, offer to save it, in the same message
as the hand-off or the question. Saved answers are for the next form, so the user isn't asked again:
- Edit the entry that already covers the question: put the form's wording in its `variants` and the option chosen
  under `byCompany` for this company (`{ default, byCompany }`) when it's the form's own wording (a how-did-you-hear
  list), or as the `answer` when it holds everywhere. A new entry only for a question no entry covers. Never a
  second entry for the same question.
- An answer the user tells you to save is meant to be used: set `sensitive: false` unless they say to keep asking.
- Don't add `source`: it names a profile path an answer is computed from, not who gave it.
- Edit `answers.yaml` with the Edit tool (not a shell append), then `answers_check`.
- On an `ask_user` card, `remember: { answerId, question }` (question: the form's wording) makes this offer, and
  ezapply writes what the user saves, a new entry included (`savedToAnswerBank`). Edit by hand only what that
  can't: an option under `byCompany`, or `sensitive`.
