# Panel and review-page fixes: details

- **Blocking sends.** Whatever starts a turn (the message box, Tailor, Fill) is disabled synchronously on the
  press, not once the companion answers, so a second press can't queue a second message.
- **Send to Claude** placement: under the edits box, so it follows what the user just wrote
  ([the review page](../../references/components/ui.md)).
- **Commenting doesn't scroll.** Find what moves the page when a comment is added (focus on the new note, the list
  growing above the viewer) and keep the scroll position.

**References when built:** `components/ui.md`.
