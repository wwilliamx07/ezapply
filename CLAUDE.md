# ezapply

## `references/` is the source of truth, and must stay current and complete

`references/` holds the complete reference for this project: its philosophy, architecture, every
component, the MCP tools, data formats, flows, security, development practices and status. Planned work
lives in `todo.md`.

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
  that describes that part.
- **Found something wrong or missing?** Fix the reference, even when it isn't part of the current task.
- Start at `references/README.md`; it indexes every page. Keep that index current too.

## `todo.md` holds only work that isn't built

Keep `todo.md` as lean as possible. Anything implemented, in whole or in part, is already described in
`references/`, so it doesn't belong in the todo as well.

- **When an item is built, delete it from `todo.md`** in the same change that documents it in `references/`.
  What still needs a live run goes into `references/status.md`, and open questions about the built behaviour go
  on the reference page for that part, or into `status.md`.
- **When part of an item is built, cut the item down to what's left.** No "built on…" notes, struck-through
  steps, progress history or "Left:" lists of verification.
- **Refer to items by title, not number,** from `references/` and code, so renumbering the todo breaks nothing.

## Never expose sensitive information

This applies everywhere that gets committed or shared: `references/`, `todo.md`, code comments, tests,
fixtures, golden files, commit messages and PR descriptions.

- **Don't mention the user's own runs against real sites.** Write "verified against a live Workday tenant",
  not which company, which posting, when, or what happened on the user's account. Describe behaviour, not the
  session that revealed it.
- **Redact anything that could identify the user or the employers they apply to.** That means names, emails,
  phone numbers, addresses, account or candidate IDs, tenant and company subdomains, job titles and requisition
  IDs from real postings, real URLs, resume contents, and local paths containing a username.
- **Use obvious placeholders** such as `example-tenant.myworkdayjobs.com`, `Jane Doe`, `jane@example.com` and
  `REQ-0000`. Captured pages and fixtures must be scrubbed before they are committed.
- **Found something already exposed?** Redact it, even when it isn't part of the current task, and tell the user,
  since it may already be in git history.
