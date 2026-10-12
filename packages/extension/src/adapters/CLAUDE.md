# Adapters: rules for changing them

Read first: `references/building-adapters.md` for a new site, `references/components/adapters.md` for the engine and
the shared drivers, and the site's section of `references/components/sites.md` for one site. What the next live
run of each site has to check is in `references/status.md`.

- **One adapter change per live run.** Fixtures are built from what the adapter expects, so only a live run shows
  a slower or broken fill. Don't bundle adapter changes; a change that only moves code (equal golden schemas and
  behaviour tests) is the exception, and the commit says so.
- **Site strings live in the site's folder** (`sites/<site>/`) and its URL module in `packages/protocol/src/`.
  Nothing else names a site: not the engine, the companion, the tool descriptions, the skills or `EZAPPLY.md`.
  What the agent must know about a site goes into a schema fact first, else into the site's notes
  (`packages/companion/src/forms/sites/<site>.ts`).
- **Build from what was seen.** Every selector comes from a saved page or the site's own scripts, never a guess.
  A saved page is scrubbed before it's committed (`references/development.md`, "Live snapshots are scrubbed").
- **No zod in the bundles.** In-page code imports the protocol only through its import-free subpaths
  (`@ezapply/protocol/workday`, `/oracle`, `/sites`, `/timing`) or as types.
- **Tests:** fillers on the behavioural fixtures (`extension/test/*-fixture.ts`), extraction on live snapshots, and
  `golden.test.ts` for what the agent sees. A golden diff is a change to the agent's view of the page; explain it.
- `use…` functions here aren't React hooks (Biome's `useHookAtTopLevel` is off for this folder).
