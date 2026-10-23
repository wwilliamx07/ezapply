# ezapply: todo

Only work that isn't built, one directory per item; how items are written and kept is in [CLAUDE.md](CLAUDE.md).

- **Value:** how much the item helps one person apply faster without lowering quality or honesty: High, Medium or
  Low. Items not yet rated show "—".
- **Size:** S (a day or less), M (a few days), L (one to two weeks), XL (more). Sizes marked `~` are first guesses
  for items not yet worked out.

Anything that changes an adapter follows "One adapter change per live run" in `references/development.md`.

## Order of execution

First, the live runs in `references/status.md` ("Not yet verified for real"): a Workday run with debug mode off
whose timings match the earlier runs' (the adapter trace's no-op path), which also presses a row's Delete and binds
a job-board posting's tab; then runs with debug on, the two comparing the browser behind and in front among them; a
Greenhouse application embedded in a careers page; then an Oracle run.

| # | Item | Value | Size | Needs first |
|---|------|-------|------|-------------|
| — | [The panel's agent stops when ezapply's tools aren't connected yet](mcp-not-ready/overview.md) | High | S | — |
| — | [CI timeouts on Windows](ci-timeouts/overview.md) | Low | S | — |
| — | [Cut the tokens a panel conversation spends](token-use/overview.md) | — | ~S | The token cuts' live run in `references/status.md` |
| — | [A harness that runs the user flows](flow-harness/overview.md) | — | ~L | — |
| 1 | [Refactor the skills for agent performance](refactor-skills/overview.md) | — | ~L | — |
| 2 | [A writing spec for claims and repo documentation](claims-writing-spec/overview.md) | — | ~S–M | Refactor the skills |
| 3 | [Agents that try to break a new adapter](adapter-breakers/overview.md) | Medium | M–L | — |
| 4 | [Employer's own forms beyond plain HTML](employer-page-forms/overview.md) | Medium | M | A page saved from a real one |
| 5 | [Everything happens in the browser](browser-only/overview.md) | — | ~XL | — |
| 6 | [The side panel's later parts](side-panel-later-parts/overview.md) | Medium | M–L | — |
| 7 | [Compatibility with various agents](agent-compatibility/overview.md) | Medium | L | Refactor the skills |
| 8 | [Application tracker: progress and outcomes](application-tracker/overview.md) | Medium | M | — |
| 9 | [Job search across the boards ezapply knows](job-search/overview.md) | Medium | L | — |
| 10 | [Job alerts](job-alerts/overview.md) | Medium | M | Job search |
| 11 | [Auto mode](auto-mode/overview.md) | High if trusted, else Low | XL | Tracker, job search, alerts; a change to `philosophy.md` |
| — | [Keep the agent's edits to the files its task may touch](agent-edit-scope/overview.md) | Medium | ~M | — |
| — | [Lint for broken Markdown links and stale comments](repo-lint/overview.md) | Low | S | — |
| — | [Remove the upgrade shims](remove-upgrade-shims/overview.md) | — | ~S | No older install left (any time after that) |

Why this order:
- **Bugs first**, in the table's order: the agent stopping at its first tool call breaks a session outright; the
  rest cost turns or quality on every run.
- **The agent's footing first.** The skills are what agents apply from, so improving them pays off on every
  later item. Refactoring them moves every mechanical step left in them into code.
- **Employer's own forms beyond plain HTML** waits for a saved careers page whose application is its own form,
  with no frame: its widgets decide what's worth reading.
- **The application manager** (tracker, job search, alerts, auto mode) is built in that order, each on the one
  before; auto mode last, and only once the rest has shown the quality holds without the user watching.

## Groups

- **Bugs:** The panel's agent stops when ezapply's tools aren't connected yet, CI timeouts on Windows.
- **The agent:** Cut the tokens a panel conversation spends, Keep the agent's edits to the files its task may
  touch, Refactor the skills, A writing spec for claims, Compatibility with
  various agents.
- **Adapter building:** Agents that try to break a new adapter, Employer's own forms beyond plain HTML.
- **The browser as the only interface:** Everything happens in the browser, The side panel's later parts.
- **Application manager:** one place for the user's job search: the postings they might apply to, where each
  application stands, and what to do next. ezapply already keeps each application's record (the posting folder:
  `meta.json`, `form-log.jsonl`), so the manager reads and extends those; it adds no database. Tracker, Job
  search, Job alerts, Auto mode.
- **Upkeep:** Remove the upgrade shims, A harness that runs the user flows, Lint for broken Markdown links and stale
  comments.
