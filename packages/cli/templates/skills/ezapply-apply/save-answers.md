# Save what got resolved

When a stored answer matched none of a field's options and the user (or your judgment, then confirmed) picked
one, or the user answered a question the bank lacks, the answer is for the next form too:
- On the `ask_user` card, `remember: { answerId, question }` (the form's wording) offers **Save for next time**.
  What the user saves is written for you (`savedToAnswerBank`): the answer, the wording as a variant, or a new
  entry. Use the id of the entry that already covers the question; a new id only for a question none covers.
- Edit `answers.yaml` yourself only for what that doesn't do, then `answers_check`: the option chosen under
  `byCompany` when it's that form's own wording (a how-did-you-hear list), or `sensitive: false` on an answer the
  user says to stop asking. Never add `source`: it names a profile path an answer is computed from.
