# ezapply: todo

Only work that isn't built, one directory per item; how items are written and kept is in [CLAUDE.md](CLAUDE.md).

- **Value:** how much the item helps one person apply faster without lowering quality or honesty: High, Medium or
  Low. Items not yet rated show "—".
- **Size:** S (a day or less), M (a few days), L (one to two weeks), XL (more). Sizes marked `~` are first guesses
  for items not yet worked out.

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

## Order of execution

First, the live runs in `references/status.md` ("Not yet verified for real"): a tailoring and a Workday run with
debug mode off, measured as the skills refactor's and the token cuts' entries ask, whose timings match the earlier
runs' (the adapter trace's no-op path), which also presses a row's Delete and binds a job-board posting's tab; the
same on Antigravity; then runs with debug on, the two comparing the browser behind and in front among them; a
Greenhouse application embedded in a careers page; an employer's own frameless form, saved for the generic reader;
then an Oracle run.

| # | Item | Value | Size | Needs first |
|---|------|-------|------|-------------|
| — | [CI timeouts on Windows](ci-timeouts/overview.md) | Low | S | — |
| — | [Cut the tokens a panel conversation spends](token-use/overview.md) | — | ~S | The token cuts' and the skills refactor's live runs in `references/status.md` |
| 1 | [An adapter harness: local clones of real application forms](adapter-harness/overview.md) | — | L | — |
| 2 | [A writing spec for claims and repo documentation](claims-writing-spec/overview.md) | — | ~S–M | — |
| 3 | [Agents that try to break a new adapter](adapter-breakers/overview.md) | Medium | M | The adapter harness |
| 4 | [Employer's own forms beyond plain HTML](employer-page-forms/overview.md) | Medium | M | A page saved from a real one |
| 5 | [Everything happens in the browser](browser-only/overview.md) | — | ~XL | — |
| 6 | [Compatibility with opencode](agent-compatibility/overview.md) | Medium | M | — |
| 7 | [Application tracker: progress and outcomes](application-tracker/overview.md) | Medium | M | — |
| 8 | [Job search across the boards ezapply knows](job-search/overview.md) | Medium | L | — |
| 9 | [Job alerts](job-alerts/overview.md) | Medium | M | Job search |
| 10 | [Auto mode](auto-mode/overview.md) | High if trusted, else Low | XL | Tracker, job search, alerts; a change to `philosophy.md` |
| — | [A UI fuzzer with a map of the UI](ui-fuzzer/overview.md) | — | ~L | — |
| — | [Keep the agent's edits to the files its task may touch](agent-edit-scope/overview.md) | Medium | ~M | — |

Why this order:
- **Bugs first**, in the table's order: they cost turns or quality on every run.
- **The adapter harness first:** every later adapter change, and every new site, is tested on a clone instead of
  waiting for the user's next real application.
- **The agent's footing next.** The claims are what documents are written from, so their spec pays off on every
  later tailoring.
- **Employer's own forms beyond plain HTML** waits for a saved careers page whose application is its own form,
  with no frame: its widgets decide what's worth reading.
- **The application manager** (tracker, job search, alerts, auto mode) is built in that order, each on the one
  before; auto mode last, and only once the rest has shown the quality holds without the user watching.

## Groups

- **Bugs:** CI timeouts on Windows.
- **The agent:** Cut the tokens a panel conversation spends, Keep the agent's edits to the files its task may
  touch, A writing spec for claims, Compatibility with opencode.
- **Adapter building:** The adapter harness, Agents that try to break a new adapter, Employer's own forms beyond
  plain HTML.
- **The browser as the only interface:** Everything happens in the browser.
- **Application manager:** one place for the user's job search: the postings they might apply to, where each
  application stands, and what to do next. ezapply already keeps each application's record (the posting folder:
  `meta.json`, `form-log.jsonl`) and the panel lists every application, so the manager reads and extends those; it
  adds no database. Tracker, Job
  search, Job alerts, Auto mode.
- **Upkeep:** A UI fuzzer with a map of the UI.
