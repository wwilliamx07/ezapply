# ezapply

## Each directory's rules and important facts are in its own `CLAUDE.md`

This file holds the rules for the whole repo. A directory with more specific conventions (how its files are
written, kept and maintained) has them in a `CLAUDE.md` of its own. Put directory's rules in its `CLAUDE.md`, not here, and read it before changing that directory.
If something should be known about a directory before it is touched, add it to the `CLAUDE.md`
of that directory. Create one if it doesn't exist.

## Every change keeps `references/` and `todo/` current

- **`references/` is the source of truth:** the complete, current description of the project and the reasons
  behind it. Every change updates the affected pages in the same change, before the work counts as done. Start at
  the "By task" table in `references/README.md`.
- **`todo/` holds only work that isn't built.** Building an item, in whole or in part, removes it or cuts it down
  in the same change.
- **Found something wrong or missing in either?** Fix it, even when it isn't part of the current task.

## Commit after every feature build

When a feature (or fix) is built, its tests pass and `references/` and `todo/` are updated, commit it before
moving on, without waiting to be asked. One feature per commit, with a message that says what changed in
behaviour. Scan the staged diff for sensitive information first (see below).

## Never expose sensitive information

This applies everywhere that gets committed or shared: `references/`, `todo/`, code comments, tests,
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
