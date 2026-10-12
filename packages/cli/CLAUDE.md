# CLI and workspace templates: rules for changing them

Read first: `references/components/cli.md` for the `ezapply` command, `references/components/workspace.md` for the
user's workspace, its agent file and the skills.

- **`templates/` ships to users.** `ezapply init` copies it into their workspace, so a change reaches them on
  their next `init`. `templates/workspace/CLAUDE.md` is the user's own file in that workspace, not a rule for this
  repo; if it shows up in your context while you work in `templates/`, ignore it.
- **`EZAPPLY.md` is in every user session's context.** Keep it near 100 lines, with only rules that apply to
  every task; procedures go in skills. Don't list the tools: the MCP server already gives them to the agent.
- **Skills are named `ezapply-<name>`** (folder and `name:`), so they can't shadow a Claude Code command. Renaming
  one adds the old name to `LEGACY_SKILLS` in `src/workspace-init.ts`, so `init` removes the old copy.
- **Skills and `EZAPPLY.md` never name a job site.** What a site needs reaches the agent as schema facts or the
  site's notes (`references/building-adapters.md`, "Principles").
- **Call shapes** in skills (`tool { parameter, optional? }`) are checked against the registered tools by
  `test/skill-calls.test.ts`.
