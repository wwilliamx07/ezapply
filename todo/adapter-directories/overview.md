# One directory per adapter

**Value** Medium · **Size** M–L · **Needs first** — (before the next new site, and before Application forms on an
employer's own page)

**What.** Everything about a site in one directory, in a new `@ezapply/sites` package, with the engine in its own
`@ezapply/engine`.

**Why.** A site is spread over three packages and some shared code; reviewing one means opening all of them, and
the types catch only some of a missing piece.

**Plan.** Three steps, each with every test passing:
1. A pure move: files and imports only, proven by unchanged bundles.
2. The site knowledge in shared code moves into registry entries.
3. The site list in `hello` replaces the per-site protocol bump.
