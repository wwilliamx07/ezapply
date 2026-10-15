# Form calls on a tab run out of order: details

- The tab isn't known until `target` resolves (a call without `tabId` picks the best-matching tab), so the queue
  key isn't known at arrival. Simplest: a single queue for target resolution, entered synchronously, that hands
  each call on to its tab's queue in arrival order. Resolution is quick, so one queue for it costs nothing.
- Different tabs must still run side by side; the same test checks that.
- The test failed on Linux CI only; it's a race, so it fails rarely anywhere.

**References when built:** `mcp-tools.md` (forms: calls on one tab), `components/companion.md` if the queue moves.
