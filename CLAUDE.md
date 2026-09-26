# ezapply

## `references/` is the source of truth, and must stay current and complete

`references/` holds the complete reference for this project: its philosophy, architecture, every
component, the MCP tools, data formats, flows, security, development practices and status. It supersedes
`plan.md` where they disagree; `plan.md` is kept only as the original design plan.

- **Every change updates the reference in the same change.** Anything that alters behaviour, a component,
  an interface, a tool, a command, a file format, a flow, a security property, the build or tests, or the
  project's status must be reflected in the affected `references/` pages before the work counts as done.
- **Complete means complete.** A new component, tool, command, file, setting or flow gets documented. Nothing
  in the code should be missing from the reference, and nothing in the reference should describe code that
  no longer exists.
- **Describe what is built, not what was planned.** Write from the code. Check details against it rather
  than from memory.
- **Record the why with the what.** There is no separate decision log. When a choice isn't obvious from the
  code (a rejected alternative, a platform constraint, a security argument), state the reason on the page
  that describes that part. Where the build departs from `plan.md`, add a row to the table in
  `references/status.md`.
- **Found something wrong or missing?** Fix the reference, even when it isn't part of the current task.
- Start at `references/README.md`; it indexes every page. Keep that index current too.
