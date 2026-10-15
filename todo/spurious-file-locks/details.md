# "Locked by another program" when nothing holds the file: details

- The agent then asks the user to close a file they don't have open, or retries the same call, which may fail again
  while the panel is reading.
- Every `writeJsonAtomic` path is exposed (`conversations.json`, `state.json`, a review's files), not only
  `meta.json`; the retry goes in `writeFileAtomic`, so all of them get it.
- Reading under the postings service's queue as well would remove the collision with the companion's own reads but
  not with other programs; the retry covers both, so the queue isn't needed for this.
- A PDF a viewer really holds still fails after the retries, with today's hint.

**References when built:** `components/companion.md` (`util/fs.ts`).
