# Notify the user when the agent needs them

**What.** A notification when the agent stops for the user: a question, a review to answer, a hand-off on a form, a
failed turn.

**Why.** A tailoring or an application runs for minutes; the user looks away and doesn't see that it's waiting.

**Plan.**
1. List the points where a turn ends waiting on the user.
2. Notify from the extension (`chrome.notifications`) when the panel isn't in view; clicking it brings the panel or
   tab forward.
3. A setting to turn it off.

[details](details.md)
