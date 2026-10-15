# A harness that runs the user flows: details

**Live.** Build the extension, load it in a browser the harness drives, start the companion, and run each flow end
to end. Real, but slow, spends tokens, and the agent's replies vary from run to run.

**Mocked.** Every UI served with stand-ins for what's slow or varies (the agent's replies, repo indexing, PDF
compiles). Fast, repeatable and free; screenshots can be compared between runs. It misses what only a real agent
or a real site shows.

**Open.** Where the stand-in responses live and how they stay in step with the real ones; whether screenshots are
compared automatically or only looked at.

**References when built:** `development.md`, `components/ui.md`, `status.md`.
