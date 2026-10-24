# Sites: rules for changing them

Read first: `references/building-adapters.md` for a new site, `references/components/sites.md` for this package and
the registry, `references/components/adapters.md` for the engine (`packages/engine`) and the shared drivers, and the
site's own page, `references/components/sites/<site>.md`. What the next live run of each site has to check is in
`references/status.md`.

- **One adapter change per live run** (why: `references/development.md`, "Conventions"). Don't bundle adapter
  changes; a change that only moves code (equal golden schemas and behaviour tests) is the exception, and the
  commit says so.
- **Everything about a site lives in its directory** (`src/<site>/`: `registry.ts`, `definition/`, `notes.ts`,
  `reader.ts` and `clone.ts` if it has them, `test/`, `fixtures/`), listed in `src/registry.ts`, `definitions.ts`,
  `notes.ts`, `readers.ts` and `clones.ts`. Nothing else names a site: not the engine, the companion, the extension,
  the tool descriptions, the skills or `EZAPPLY.md` (`test/knowledge.test.ts` checks the code). What the agent must
  know about a site goes into a schema fact first, else into its `notes.ts`.
- **Build from what was seen.** Every selector comes from a saved page or the site's own scripts, never a guess.
  A saved page is scrubbed before it's committed (`references/development.md`, "Live snapshots are scrubbed").
- **No zod in the bundles.** A definition, and the registry entries it imports, use the protocol only through its
  import-free subpaths (`@ezapply/protocol/sites`, `/timing`) or as types.
- **Tests:** every site's URL rules (`src/<site>/test/url.test.ts`), extraction on its saved pages
  (`src/<site>/test/live.test.ts`) and its conformance page (`src/<site>/test/page.ts`, for
  `test/conformance.test.ts`); where a site has them (Workday, Oracle), fillers on the behavioural fixture
  (`src/<site>/test/fixture.ts`) and `golden.test.ts` for what the agent sees. A golden diff is a change to the agent's view of the page; explain it.
- `use…` functions here aren't React hooks (Biome's `useHookAtTopLevel` is off for this package and the engine).
