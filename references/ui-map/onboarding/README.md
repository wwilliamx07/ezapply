# The setup page

The onboarding page ([ui.md](../../components/ui.md#the-onboarding-page-onboard)): the steps in a list down the
left, the one shown in the middle, the agent's tasks on the right. The [frame](frame.md) (the header, the list of
steps, Back and Next) is there on every step.

| Page | The screen |
|---|---|
| [frame.md](frame.md) | On every step: Finish, the list of steps, Back and Next |
| [changes.md](changes.md) | The Changes list, while anything is out of date |
| [tex.md](tex.md), [extension.md](extension.md), [github.md](github.md), [repos.md](repos.md), [knowledge.md](knowledge.md) | The setup steps |
| [resume.md](resume.md), [profile.md](profile.md), [cover.md](cover.md), [answers.md](answers.md), [preferences.md](preferences.md), [library.md](library.md) | The document and profile steps |
| [import.md](import.md), [build-failed.md](build-failed.md), [preview.md](preview.md) | Importing a LaTeX template, a build that failed, a template's preview |
| [finished.md](finished.md) | Setup finished, or paused |

**Scenarios** (`scripts/fuzz/lib/scenarios.ts`): `onboard-fresh` (nothing set up), `onboard-most` (the required
steps done, a repository not read, workspace changes, builds that fail), `onboard-finished`.
