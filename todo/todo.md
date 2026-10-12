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
| 1 | [Minimal reliance on agent performance](less-agent-reliance/overview.md) | — | ~L | — |
| 2 | [Remove the onboarding and repos skills](remove-onboarding-repos-skills/overview.md) | — | ~M | Minimal reliance on agent performance |
| 3 | [Refactor the skills for agent performance](refactor-skills/overview.md) | — | ~M | Remove the onboarding and repos skills |
| 4 | [A writing spec for claims and repo documentation](claims-writing-spec/overview.md) | — | ~S–M | Refactor the skills |
| 5 | [One directory per adapter](adapter-directories/overview.md) | Medium | M–L | — |
| 6 | [Agents that try to break a new adapter](adapter-breakers/overview.md) | Medium | M–L | — |
| 7 | [Application forms on an employer's own page](employer-page-forms/overview.md) | Medium | M–L | One directory per adapter; a page saved from a real one |
| 8 | [Everything happens in the browser](browser-only/overview.md) | — | ~XL | — |
| 9 | [The side panel's later parts](side-panel-later-parts/overview.md) | Medium | M–L | — |
| 10 | [Compatibility with various agents](agent-compatibility/overview.md) | — | ~L | Minimal reliance on agent performance; Refactor the skills |
| 11 | [Run multiple applications in parallel](parallel-applications/overview.md) | — | ~L | — |
| 12 | [Application tracker: progress and outcomes](application-tracker/overview.md) | Medium | M | — |
| 13 | [Job search across the boards ezapply knows](job-search/overview.md) | Medium | L | — |
| 14 | [Job alerts](job-alerts/overview.md) | Medium | M | Job search |
| 15 | [Auto mode](auto-mode/overview.md) | High if trusted, else Low | XL | Tracker, job search, alerts; a change to `philosophy.md` |
| — | [Remove the upgrade shims](remove-upgrade-shims/overview.md) | — | ~S | No older install left (any time after that) |

Why this order:
- **The agent's footing first.** The skills are what agents apply from, so improving them pays off on every
  later item. Making flows mechanical comes before refactoring the skills, since it removes some
  of them (onboarding, repos) and shrinks the rest.
- **One directory per adapter before the next new site, and before Application forms on an employer's own page**,
  so neither is built in the old layout and then moved. The generic form also waits for a saved careers page whose
  application is its own form, with no frame.
- **The application manager** (tracker, job search, alerts, auto mode) is built in that order, each on the one
  before; auto mode last, and only once the rest has shown the quality holds without the user watching. Running
  applications in parallel comes before it, since auto mode fills many at once.

## Groups

- **The agent:** Minimal reliance on agent performance, Remove the onboarding and repos
  skills, Refactor the skills, A writing spec for claims, Compatibility with various agents.
- **Adapter building:** One directory per adapter, Agents that try to break a new adapter, Application forms on an
  employer's own page.
- **The browser as the only interface:** Everything happens in the browser, The side panel's later parts, Run
  multiple applications in parallel.
- **Application manager:** one place for the user's job search: the postings they might apply to, where each
  application stands, and what to do next. ezapply already keeps each application's record (the posting folder:
  `meta.json`, `form-log.jsonl`), so the manager reads and extends those; it adds no database. Tracker, Job
  search, Job alerts, Auto mode.
- **Upkeep:** Remove the upgrade shims.
