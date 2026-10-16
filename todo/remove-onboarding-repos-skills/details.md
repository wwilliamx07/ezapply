# Remove the onboarding and repos skills: details

`ezapply-onboard` has two halves: **Onboarding**, a shim around the setup page's task loop, and **Keeping the
workspace current**, the agent's triage of `workspace_changes`. `ezapply-repos` repeats the setup page's
Repositories step in chat. Done in two stages; each ships on its own.

What stays the agent's, as setup tasks with their `how` (`HOW` in `onboarding/service.ts`), not as a skill:
updating the profile from the resume's diff, re-indexing a repo, fixing a template that fails to build, and
filling the cover's identity fields in a template that isn't ezapply's default. Nothing here decides for the user:
each update still waits on their yes, now given on a card or the page instead of in chat.

## 1. The repos skill and the onboarding half (S)
- **The page adds a repo by URL.** The Repositories step keeps sources added with `source: "public-url"` but
  can't add one. Add a field for a public repository's URL (one the user contributed to but doesn't own) that
  calls `repos_selection_set`'s logic with that source, refusing what `github_list_repos` already lists.
- **Opening the page at a step.** `onboarding { step? }` opens or focuses the page on that step (`repos`,
  `resume`, …); the page reads it from the URL's hash. "Add repo X" or "use another resume" in chat becomes that
  call; the tool's description says so.
- **The task message is the instruction.** It already carries `how` and the report call. `onboarding`'s
  description keeps the one line on reporting; the skill's "never ask in chat for what the page collects" moves
  into the description too.
- **Freshness hints that name the skill.** `repo-deselected`'s detail (`freshness/service.ts`) names
  `ezapply-repos`: point to `onboarding { step: "repos" }` instead.
- **`EZAPPLY.md`.** "New user, set me up, or `workspace_check` shows missing steps: call `onboarding {}`."
- **Removing the files.** `ezapply init` copies the skills with `cp … force` and never deletes, so existing
  workspaces keep both folders. Add `ezapply-repos` (and `ezapply-onboard` in stage 2) to a removal list beside
  `LEGACY_SKILLS` in `cli/src/workspace-init.ts`, with the same guard: remove a folder only when its `SKILL.md`
  uses ezapply's tools. Test it in `workspace-init.test.ts`, whose expected names lose `ezapply-onboard`.

## 2. Keeping the workspace current (M)
**The companion raises the changes, not the agent.** `FreshnessService` already checks in the background from
the conversation's start. When a panel conversation opens (or the background check finishes) with changes listed,
the panel shows a **Workspace changes** card above the conversation: one line per change (its `summary`), the ones
the request in hand needs marked (below), and per change **Update now**, **Later** and, for `repo-pushed`, a
duration (a day, a week, a month; at most `DEFER_MAX_HOURS`). Nothing listed, no card. The agent's call at the
start of every session goes, and with it the two lines in `EZAPPLY.md`.

**Which ones the request needs.** `affects` is computed now from the change kind; the card marks it against
the conversation: a posting's `tailor` conversation needs template, profile and repo changes, `fill` needs the
profile's. Pressing Tailor documents or Fill form with a needed change pending shows the card first, with
**Go on anyway**.

**Per kind, on Update now:**
| Kind | Done by | How |
|---|---|---|
| `template-source` | Code | `template_import { replace: true }` from the recorded source, then `tex_compile`. A failed build becomes a `fix-template-build` task (which carries over the font path or engine line the old copy had: `HOW` says to compare with `templates/.old/`) |
| `template-untracked` | Code | The OS dialog (`util/dialog.ts`) for the file or folder they edit, preselected to a `library-template` match if there is one; **I keep none** marks it done |
| `library-template` | Code | **It's my resume / my cover letter / neither**: import (which ends any `template-untracked` of that kind) or mark done |
| `profile-identity` | Code, else agent | Replace `\myname` and `\mycontact` in `templates/cover/` and compile; a template without both macros becomes a `fill-cover-identity` task |
| `resume-edited` | Agent | A new `update-profile` task; its `how` is the skill's rules (from the diff alone, keep what the resume never held, ask before dropping a job or degree, `profile_check`, mark done) |
| `repo-pushed` | Agent | The `index-repos` task, with the repos chosen |
| `repo-deselected` | Code | **Delete its knowledge** (after a confirm on the card) or **Select it again** |

**Order.** Code-done updates run first, in the skill's order (templates, then profile identity); agent tasks
are queued after them, so `update-profile` reads the newly imported resume.

**Tasks outside setup.** Generalise `OnboardTask` into workspace tasks that `PanelService` sends to the general
conversation as setup tasks are sent now ("Workspace task t7 (update-profile) …"), reported with the same call.
Rename the report to `task_report { taskId, result }` if the onboarding name reads wrong there; keep
`onboarding { taskId }` working for a release.

**Routes.** `panel.workspaceChanges` (the list with `affects` for a conversation key) and
`panel.workspaceChange { ids, action: update | later | done, hours? }` beside the other `panel.*` methods
(`agent/panel.ts`), each `as` going to `FreshnessService.mark`. "Hidden for this chat" becomes "for this panel
conversation".

**The tools.** `workspace_changes` stays, read-only, for "what did I put off?" and for an agent without the
panel. `workspace_change_mark` goes from MCP: marking is the card's, so the agent can't mark a change done the
user never saw. Its `repo-deselected` deletion is no longer reachable from the agent at all.

**Without the panel** (the terminal mode the tests use, and other agents later: "Compatibility with various
agents"), the setup page shows the same list under a **Changes** heading with the same buttons, so nothing
depends on the panel's UI alone.

Then delete `ezapply-onboard` (and add it to init's removal list).

## Tests
- `freshness`: `affects` per conversation kind; the order of a mixed update.
- The `panel.workspaceChange` route: `later` with `hours` capped, `done` on `repo-deselected` deleting only
  after the confirm flag, unknown ids refused before any is marked.
- `profile-identity` by code on the default cover template; falls back to a task without the macros.
- `skill-calls.test.ts` still passes with `EZAPPLY.md` rewritten (the shapes it shows).
- UI: the card renders, hides when empty, blocks Tailor/Fill with a needed change pending.

## References
`workspace.md` (the skills table loses two rows; `EZAPPLY.md`'s setup lines), `flows.md` (setup, and "at the
start of every session" becomes the card), `companion.md` ("Keeping the workspace current": who acts on the list),
`ui.md` (the page's URL field, its step hash, its Changes list; the panel's card), `agent.md` (workspace tasks in
the general conversation), `mcp-tools.md` (`onboarding { step? }`, `workspace_change_mark` removed), `cli.md`
(the skills list, init's removal), and a line in `status.md`'s decisions: why triage is UI, not a skill (consent
given on a button can't be skipped, and it costs no call per session). The live run in `status.md`: an edited
resume and a pushed repo, from the card through the agent's tasks.
