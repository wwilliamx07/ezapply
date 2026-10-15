# ezapply: todo

Only work that isn't built. Whatever is built, in whole or in part, is described in `references/` (what still needs
a live run is in `references/status.md`) and in git history.

Each item has its own directory: `overview.md` says what, why and the plan in a few lines; `details.md` holds the
rest. Refer to items by title, not by their place in this list.

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
| — | [Cut the tokens a panel conversation spends](token-use/overview.md) | — | ~M | The token cuts' live run in `references/status.md` |
| — | [Panel and review-page fixes](panel-fixes/overview.md) | — | ~S | — |
| — | [Form-filling fixes](form-agent-fixes/overview.md) | — | ~M | — |
| — | [Tailoring edits that fit the page and the text](tailoring-edits/overview.md) | — | ~M | — |
| — | [Notify the user when the agent needs them](agent-notifications/overview.md) | — | ~S | — |
| — | [A harness that runs the user flows](flow-harness/overview.md) | — | ~L | — |
| 1 | [Remove the onboarding and repos skills](remove-onboarding-repos-skills/overview.md) | — | ~M | — |
| 2 | [Refactor the skills for agent performance](refactor-skills/overview.md) | — | ~L | Remove the onboarding and repos skills |
| 3 | [A writing spec for claims and repo documentation](claims-writing-spec/overview.md) | — | ~S–M | Refactor the skills |
| 4 | [Agents that try to break a new adapter](adapter-breakers/overview.md) | Medium | M–L | — |
| 5 | [Application forms on an employer's own page](employer-page-forms/overview.md) | Medium | M–L | A page saved from a real one |
| 6 | [Everything happens in the browser](browser-only/overview.md) | — | ~XL | — |
| 7 | [The side panel's later parts](side-panel-later-parts/overview.md) | Medium | M–L | — |
| 8 | [Compatibility with various agents](agent-compatibility/overview.md) | — | ~L | Refactor the skills |
| 9 | [Run multiple applications in parallel](parallel-applications/overview.md) | — | ~L | — |
| 10 | [Application tracker: progress and outcomes](application-tracker/overview.md) | Medium | M | — |
| 11 | [Job search across the boards ezapply knows](job-search/overview.md) | Medium | L | — |
| 12 | [Job alerts](job-alerts/overview.md) | Medium | M | Job search |
| 13 | [Auto mode](auto-mode/overview.md) | High if trusted, else Low | XL | Tracker, job search, alerts; a change to `philosophy.md` |
| — | [Remove the upgrade shims](remove-upgrade-shims/overview.md) | — | ~S | No older install left (any time after that) |

Why this order:
- **The agent's footing first.** The skills are what agents apply from, so improving them pays off on every
  later item. Removing the onboarding and repos skills comes before refactoring the rest, which moves every other
  mechanical step into code.
- **Application forms on an employer's own page** waits for a saved careers page whose application is its own form,
  with no frame.
- **The application manager** (tracker, job search, alerts, auto mode) is built in that order, each on the one
  before; auto mode last, and only once the rest has shown the quality holds without the user watching. Running
  applications in parallel comes before it, since auto mode fills many at once.

## Groups

- **The agent:** Cut the tokens a panel conversation spends, Remove the onboarding and repos skills, Refactor
  the skills, A writing spec for claims, Compatibility with various agents, Form-filling fixes, Tailoring edits
  that fit the page and the text.
- **Adapter building:** Agents that try to break a new adapter, Application forms on an
  employer's own page.
- **The browser as the only interface:** Everything happens in the browser, The side panel's later parts, Run
  multiple applications in parallel, Panel and review-page fixes, Notify the user when the agent needs them.
- **Application manager:** one place for the user's job search: the postings they might apply to, where each
  application stands, and what to do next. ezapply already keeps each application's record (the posting folder:
  `meta.json`, `form-log.jsonl`), so the manager reads and extends those; it adds no database. Tracker, Job
  search, Job alerts, Auto mode.
- **Upkeep:** Remove the upgrade shims, A harness that runs the user flows.
