# Panel and review-page fixes

**What.** Small fixes to the panel and the review page:
- Sending a message, the Tailor and Fill buttons included, blocks at once: today a double click queues two messages.
- On the review page, **Send to Claude** goes under the edits box.
- Adding a comment on the review page doesn't scroll the page down.

**Why.** Each is a rough edge the user hits on every tailoring or application.

**Plan.** Each on its own; the send fix disables the input and buttons on the first press, before the request goes
out, and enables them when the turn ends or fails.

[details](details.md)
