# One directory per adapter: details

**Why.** A site is spread over three packages. Its URL rules (`protocol/src/<site>.ts`), registry entry and id
(`protocol/src/sites.ts`, `SiteId` in `postings.ts`, the export in `index.ts`, a `PROTOCOL_VERSION` bump), its
definition (`extension/src/adapters/sites/<site>/`, listed in `sites/index.ts`), its notes
(`companion/src/forms/sites/`, listed in `index.ts`), its posting reader (`companion/src/postings/readers/`), and
its tests and saved pages (`PAGES` and `SAVED` in `extension/test/sites.test.ts`, `sites-live.test.ts`,
`protocol/test/sites.test.ts`, `extension/test/fixtures/live/`). And some of its knowledge sits in shared code:
`JOB_ID_PARAMS` in `postings/service.ts` (Phenom's `jobseqno`, SuccessFactors' `career_job_req_id` and `company`),
`companyFromUrl` and `ATS_HOSTS` in `postings/extract.ts` (Oracle's and SuccessFactors' data-centre hosts, the
boards' hosts). Reviewing a site means opening all of these, and the types catch only some of a missing piece:
nothing notices a site's job parameter left out of `JOB_ID_PARAMS`.

**Layout.** A package of its own, everything about a site in its directory:
```
packages/sites/               @ezapply/sites
  src/<site>/
    registry.ts               SiteInfo: id, name, signature, URL rules, tenant, job, canonical path,
                              hostPageJob, waits, and what shared code knows now: jobParams (query
                              parameters naming its job), providerHosts (hosts that name the provider,
                              not the employer)
    definition/               site.ts, main.ts, and its own widgets.ts, page.ts, fill.ts, selectors.ts
    notes.ts                  its notes for the agent
    reader.ts                 its posting reader, when it has one
    test/                     its URL rules, extraction from its saved pages, its behavioural tests
                              (Workday's, Oracle's) and golden schemas
    fixtures/                 its saved, scrubbed pages
  src/registry.ts             SITES, in detection order
  src/definitions.ts          SITE_DEFINITIONS (the extension's side)
  src/notes.ts, readers.ts    SITE_NOTES, POSTING_READERS (the companion's side)
  src/conformance.test.ts     every site: today's conformance and signature tests
packages/engine/              @ezapply/engine: today's extension/src/adapters/engine/ and widgets/
```
- **The lists stay per side,** so the extension's bundles never pull in notes or readers and the companion never
  pulls in the drivers. A test fails when a directory is missing from any list, or a list names one that's gone.
- **Dependencies:** `protocol` ← `engine` ← `sites` ← `extension`, `companion`. The engine leaves the extension
  because the definitions import it and the extension imports the definitions. Protocol keeps the types
  (`SiteInfo`, `Timing`, `STANDARD_WAITS`) and stops knowing the sites: `SITES`, `FormSiteId` (now derived from
  `SITES`), `detectSite` and `isFormSite` move to `@ezapply/sites`, and the wire schemas take a site as a string
  each peer checks against `SITES` (`generic` stays protocol's).
- **No `PROTOCOL_VERSION` bump per site:** `hello` carries the extension's site ids, and the companion reports a
  mismatch as an extension built from another version, with the rebuild hint a version mismatch gets. Today the
  bump is how an older peer rejects a new id; the list says which site is missing.
- **Shared code loses site knowledge:** `JOB_ID_PARAMS` becomes the generic parameters plus every site's
  `jobParams`, and `companyFromUrl` and `ATS_HOSTS` ask the sites' `providerHosts` and hosts. A test scans the
  other packages' sources, comments stripped with TypeScript's scanner, for any site id, so knowledge can't creep
  back.
- **The build:** `extension/build.mjs` builds `sites/src/<site>/definition/main.ts` for each of `SITES`; vitest
  picks up `packages/sites/**/test/`.
- **References stay in `references/`:** a site's reference page doesn't move into its directory. The
  directory gets no README of its own, so there's one place to keep current. But `components/sites.md` (about
  70 KB, read whole for a change to one site) splits into a page per site under `references/components/sites/`,
  plus one for what they share; the "By task" table in `references/README.md` and the site check in
  `test/references.test.ts` follow. `packages/extension/src/adapters/CLAUDE.md` moves with the code.

**Doing the move.** In three steps, each with every test passing:
1. A pure move: files and imports only. Golden schemas unchanged, and the built bundles compared with the
   previous build's (paths in comments and the version hash aside) to show the code is the same. So no live run is
   spent on it.
2. The site knowledge in shared code moves into registry entries, with tests that canonical URLs and companies
   from captures come out as before.
3. The site list in `hello` replaces the per-site protocol bump.

**References when built:** `building-adapters.md` (the table "What, where" and the process become the one
directory and its files; the checklist), `components/adapters.md`, `protocol.md`, `extension.md`, `companion.md`,
`postings.md`, `architecture.md`, `development.md` (packages, tests), `README.md`.

**Challenge.** Workday's and Oracle's fixtures and helpers (`test/adapters.ts`) are shared with the companion's
e2e tests. They move with the sites, and the e2e tests import them from there.
