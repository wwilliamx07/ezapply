# The adapter harness: rules for changing it

Read `references/harness.md` first: what each part does and why.

- **Generic, like the engine.** No site's name or URLs here (`packages/sites/test/knowledge.test.ts` checks): what a
  site's server does goes in its `packages/sites/src/<site>/clone.ts`; what the explorer can't reach through
  `get_form`'s facts goes in that description's `explorer` options, added there for every site.
- **Node runs it as TypeScript** (type stripping): erasable syntax only (no parameter properties, enums or
  namespaces; `tsconfig.json` checks), and relative imports end in `.ts`.
- **Clones are never committed.** They hold a third party's pages and the answers its server gave, under
  `.clones/` (git-ignored). Nothing identifying goes into one: placeholder values only (`lib/profile.ts`), never the
  user's, and no cookies, auth headers or tokens (`normalise.ts`).
- **Never submits, never works around a bot challenge,** as in "Checking a site live" (`references/components/adapters.md`).
- **Tests:** the engine and anything else that needs no browser in `test/standin.test.ts`; what needs one in
  `test/harness.test.ts`, on the hand-written site, skipped without a browser or a built extension.
