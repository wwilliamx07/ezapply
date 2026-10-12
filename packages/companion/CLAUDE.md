# Companion: rules for changing it

Read first: `references/components/companion.md` (startup, HTTP, sessions, bridge), and for a tool
`references/mcp-tools.md`. "How to…" at the end of `references/development.md` has the steps for a new tool, a
bridge method or a stored format.

- **Thin tools, fat services.** A tool in `src/mcp/tools/` validates, calls a service, returns compact JSON. Logic
  lives in services, wired explicitly in `src/main.ts`.
- **Errors carry a fix:** throw `EzError(code, message, hint)`, where the hint says what the agent should do. No
  raw exception reaches a tool result.
- **Validate every boundary with zod:** tool inputs, bridge params and results, files read from disk. Paths from
  the agent go through `Workspace.resolveAllowed` with the narrowest folder list.
- **Use the shared helpers** in `src/util/` (`writeFileAtomic`, `writeJsonAtomic`, `KeyedQueue`, `run()`,
  `which()`, the `Opener`) instead of redefining them.
- **Tool descriptions and results cost context in every session:** keep them short, never name a site (a site's
  knowledge goes into its notes in `src/forms/sites/`), and name a new tool `<noun>_<verb>` (the form tools read
  as commands). Every tool has its row in `references/mcp-tools.md`; `test/references.test.ts` fails otherwise.
- **The skills spell out tool and parameter names.** Renaming one means updating them;
  `cli/test/skill-calls.test.ts` fails until then. Rules that must hold even without `EZAPPLY.md` go in the
  server's instructions (`src/mcp/server.ts`).
- **A stored format change** bumps its `schemaVersion`, adds a migration run by `ezapply init`, and updates
  `references/data-formats.md`.
- New tools and bridge methods are tested in `test/e2e.test.ts` or the service's own test.
