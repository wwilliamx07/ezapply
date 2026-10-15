# Form calls on a tab run out of order

**What.** Tool calls Claude makes in parallel on one tab are meant to run one at a time, in the order they came
(`FormsService.onTab`). They run one at a time, but not always in order: CI has caught three option reads on one tab,
made as gender, disability, veteran, running as veteran, disability, gender.

**Why.** `onTab` awaits `debug.settings()` (a file read) and `target(tabId)` (a bridge call) before it joins the
tab's `KeyedQueue`, so calls join in the order those resolve, not the order they arrived. A read still gets its
own field (each call names it), but a fill sent after a `go_next` can run before it, on the step before the one it
was meant for.

**Plan.**
1. Take the call's place in order before the first await: one queue entry per arrival that resolves the target
   inside it, or a per-tab "arrival" chain the target resolution waits on.
2. The existing test in `companion/test/forms.test.ts` ("run one at a time and in order") then passes every time;
   run it in a loop to check.

[details](details.md)
