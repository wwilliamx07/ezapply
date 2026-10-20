# Keep the agent's edits to the files its task may touch: details

- Deny rules hold in every permission mode, Auto included, and beat allow rules; that's why they're the tool
  here rather than the classifier or `permission_ask` (which only runs when something would prompt).
- The conversation key names its posting, and a conversation never works on another, so the rules are per
  process.
- Writes the tools make (`posting_update_meta`, `tex_compile`'s PDF, `pdf_merge`) are the companion's and stay
  checked by `Workspace.resolveAllowed`; only Claude Code's own Edit/Write/NotebookEdit/Bash are in scope here.
- The workspace's `Read(/debug/**)` deny already makes Claude Code refuse some `cd … && cat …` commands (a `cd` it
  can't resolve, then a read a deny rule might cover); check new deny rules for the same effect before adding them.
- Note the rules in `security.md`'s table.

**References when built:** `components/agent.md`, `security.md`, `components/workspace.md` (settings written by
`init`).
