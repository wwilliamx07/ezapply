# The UI fuzzer: rules for changing it

Read "The UI fuzzer" in `references/development.md` first: what each part does and why. Its input is the map in
`references/ui-map/`.

- **Node runs it as TypeScript** (type stripping), as the harness: erasable syntax only, relative imports end in
  `.ts`. `panel/main.tsx` is the exception: esbuild bundles it for the browser.
- **Scenarios are hand-written with the protocol's types** (`lib/scenarios.ts`), placeholder people and employers
  only (`Jane Doe`, `jane@example.com`, Acme, `example-tenant`): their screenshots are committed as goldens. A new
  condition in the map needs a scenario that shows it; list it in the map section's README.
- **The fakes answer like the companion** (`lib/fakes.ts`): a call the fake doesn't have is an error, not a silent
  `{}`, so a new bridge call shows up here. Nothing leaves the machine: requests to any other origin are blocked,
  and a click on a `mailto:` or `tel:` link is cancelled, since the browser would hand it to the system's own app.
- **Goldens are per platform** (`goldens/<platform>/`). Look at every new or changed one before committing it.
- **Tests:** `test/map.test.ts` needs no browser; `test/fuzz.test.ts` walks the quick scenarios and skips without a
  browser or a built UI.
