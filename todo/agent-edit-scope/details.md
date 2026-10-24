# Keep the agent's edits to the files its task may touch: details

- The rules go in with `--settings`. Tailoring: Edit/Write only `postings/<id>/`, not its `capture/` or `meta.json`.
  Always denied: `.claude/**`, `.mcp.json`, `EZAPPLY.md`, `CLAUDE.md`, `ezapply.config.json`. Bash writes
  (`sed -i`, `>`): a `PreToolUse` hook or deny rules for the write forms. Tests on `agentArgs` for each part.
- Deny rules hold in every permission mode, Auto included, and beat allow rules; that's why they're the tool
  here rather than the classifier or `permission_ask` (which only runs when something would prompt).
- The conversation key names its posting, and a conversation never works on another, so the rules are per
  process.
- Writes the tools make (`posting_update_meta`, `tex_compile`'s PDF, `pdf_merge`) are the companion's and stay
  checked by `Workspace.resolveAllowed`; only Claude Code's own Edit, Write and shell (Bash, or PowerShell where
  Git Bash is missing: `panelShell`) are in scope here.
- Antigravity takes no per-process settings: its permissions live only in the user's own settings
  (`components/agent.md`), so its conversations need another way, or keep today's rules.
- The workspace's `Read(/debug/**)` deny already makes Claude Code refuse some `cd … && cat …` commands (a `cd` it
  can't resolve, then a read a deny rule might cover); check new deny rules for the same effect before adding them.
- Note the rules in `security.md`'s table.

**References when built:** `components/agent.md`, `security.md`, `components/workspace.md` (settings written by
`init`).
