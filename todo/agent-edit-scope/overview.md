# Keep the agent's edits to the files its task may touch

**What.** A panel conversation can edit any file in the workspace: templates, `profile/`, `capture/`, another
posting's documents, `EZAPPLY.md`, `.claude/settings.json` and the skills. Only `repo-cache/` is denied.

**Why.** The rules that it mustn't ("never edit templates while tailoring", "`capture/` never edit", the filling
conversation doesn't write documents) are prose in `EZAPPLY.md` and `PART_PROMPTS`. In Auto mode, the default,
Claude Code's classifier allows edits inside the working directory, so nothing stops an edit the prose forbids,
including one a posting's text talks the agent into. Bash can write files too (`sed -i`, `>`), past any Edit rule.

**Plan.**
1. Per conversation, deny rules passed with the process (`--settings`): a posting's tailoring conversation may
   Edit/Write only `postings/<id>/` (not `capture/` or `meta.json`); the filling one writes no files; the general
   conversation keeps today's rules (setup writes the profile and templates through tools anyway).
2. Always denied: `.claude/**`, `.mcp.json`, `EZAPPLY.md`, `CLAUDE.md`, `ezapply.config.json`.
3. File writes through Bash: a `PreToolUse` hook, or denying the shell's write forms, decided once the first two
   are in; measure what the agent uses Bash for first.
4. Tests on `agentArgs` for each part.

[details](details.md)
