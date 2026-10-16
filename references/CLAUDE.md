# references/: rules for writing it

This folder holds the complete reference for this project: its philosophy, architecture, every component, the MCP
tools, data formats, flows, security, development practices and status. Start at the "By task" table in
`README.md`, which says what to read for each kind of change, and keep it and the index current.

- **Every change updates the reference in the same change.** Anything that alters behaviour, a component,
  an interface, a tool, a command, a file format, a flow, a security property, the build or tests, or the
  project's status must be reflected in the affected pages before the work counts as done.
- **Complete about behaviour and the why, not a copy of the code.** Every component, tool, command, file,
  setting and flow is documented: what it does, how it fits with the rest, and why it is that way. Don't restate
  what the code already says plainly, such as each parameter's type, the cases in each test, file-by-file
  listings or constants; name the file instead. Nothing the code does should be missing from the reference, and
  nothing in the reference should describe code that no longer exists. `test/references.test.ts` checks what it
  can: links, the index, and that every tool, site and skill is documented.
- **One place per fact.** State a fact on the page that owns it and link to it from elsewhere, so a change
  updates one page.
- **Describe what is built, not what was planned.** Write from the code. Check details against it rather
  than from memory. Planned work belongs in `todo/`.
- **Record the why with the what.** When a choice isn't obvious from the code (a rejected alternative, a
  platform constraint, a security argument), state the reason on the page that describes that part.
  `status.md`'s Decisions gives each such choice a line, linking to that page.
- **Rules, not history.** A page states how things are now and why. Which commit did what, and when, is in git;
  a past incident stays only as the reason for a rule, in a sentence. `status.md` names the changes a live run
  still has to check, until it has.
- **Found something wrong or missing?** Fix the reference, even when it isn't part of the current task.
