# Sites (`packages/sites/`)

Eight sites, each a directory of `@ezapply/sites` holding everything about it: its registry entry with its URL rules
(`registry.ts`), its definition on the [adapter engine](adapters.md) (`definition/`: a `site.ts` and a `main.ts`, its
bundle entry, on the shared drivers), its notes for the agent (`notes.ts`), its posting reader if it has one
(`reader.ts`), its tests (`test/`) and its saved pages (`fixtures/`). How the package is laid out, and why, is in
[the package](#the-package). Each site's page holds only what it does differently; what every site does the same (the
API, extraction, filling, option matching, moving, the submit guard, the waits, the shared drivers) is in
[adapters](adapters.md), and what each registry entry says in [the registry](#the-registry).
- [Workday](sites/workday.md): steps, rows added and deleted, a review page; a dropdown, prompt and date of its
  own, so its definition is split over several files.
- [Oracle Recruiting Cloud](sites/oracle.md): one page or one section per page, items saved through
  inline forms; a list and date of its own, split the same way.
- Three hosted job boards, [Greenhouse](sites/greenhouse.md), [Lever](sites/lever.md) and
  [Ashby](sites/ashby.md) (about 150 lines each), whose applications are **one page with Submit at the end**: no
  steps, rows or inline forms, `next` always refuses (Submit is the only way on), `back` has nowhere to go, and the
  schema says `lastPage: true`, so the agent fills the page and hands over to the user
  ([the hand-off](../flows.md#7-filling-the-application-fill-out-the-application)).
- [Phenom](sites/phenom.md), an employer's careers site whose application has steps and rows, like Workday's.
- [Dayforce](sites/dayforce.md), a candidate portal whose application has steps and records saved one by one,
  like Oracle's items.
- [SAP SuccessFactors](sites/successfactors.md), a career site whose application is one page, with
  rows of lists like Workday's and documents, and two widgets of its own (`widgets.ts`).

## The package
```
packages/sites/                 @ezapply/sites
  src/<site>/
    registry.ts                 its URL rules and registry entry (`<site>Info`)
    definition/                 site.ts, main.ts (the bundle entry), and its own widgets, pages, selectors
    notes.ts                    its notes for the agent
    reader.ts                   its posting reader, where it has one
    test/                       its URL rules, its saved pages read, its behavioural tests and golden schemas,
                                page.ts (the page the conformance test checks it on)
    fixtures/                   its saved, scrubbed pages
  src/registry.ts               SITES, in detection order, and what asks it
  src/definitions.ts            SITE_DEFINITIONS: the extension's side
  src/notes.ts, src/readers.ts  SITE_NOTES, POSTING_READERS: the companion's side
  test/                         what every site must pass (conformance), and the shared test helpers
packages/engine/                @ezapply/engine: the adapter engine and its drivers (src/widgets/)
```
- **Everything about a site is in its directory,** so reviewing or changing one site means one directory, and a
  missing piece shows there. Code elsewhere asks the registry or the lists and names no site: `knowledge.test.ts` scans
  every other package's source (comments stripped by TypeScript's scanner) for a site's id, so knowledge can't creep
  back into shared code. Its reference page stays here in `references/` (a page per site under `sites/`), not in its
  directory, so there's one place to keep current.
- **The lists stay per side.** The extension's bundles import only their own definition (and the registry), never
  notes or readers; the companion imports the registry, the notes and the readers, never a definition. Each list is
  keyed by every registry site, so a site missing from one doesn't compile, and `conformance.test.ts` checks that the
  directories, `SITES` and every list name the same sites, that each directory has its files and saved pages, that
  every wait of every site is a number, and that only a site with a `reader.ts` is in `POSTING_READERS`.
- **Dependencies:** `protocol` ← `engine` ← `sites` ← `extension`, `companion`. The engine is a package of its own
  because the definitions import it and the extension imports the definitions. The protocol keeps the entry's shape
  (`SiteInfo`), the waits' (`Timing`, `STANDARD_WAITS`) and `HOST_PERMISSIONS`, and knows no site: the wire takes a site
  as a string ([protocol](protocol.md#bridge-handshake)).
- **Two builds.** The companion runs under Node, so `tsc` builds the registry, the notes and the readers to `dist/`
  (the package's exports: `.`, `./notes`, `./readers`); the definitions are left out of it and stay source, which
  `esbuild` bundles from TypeScript (`extension/build.mjs` builds `src/<site>/definition/main.ts` for each of `SITES`).
  `tsconfig.definitions.json` typechecks everything with the browser's types. The engine is source only (its exports
  point at `src/`); nothing runs it under Node but the tests.

## The registry
Every job site whose application forms ezapply fills has one entry (`SiteInfo`, its shape in the protocol's
`sites.ts`), in its own `registry.ts`, and everything that knows the list of sites derives from `SITES`
(`src/registry.ts`), in detection order:

| Field | Meaning |
|---|---|
| `id` | `FormSiteId`, derived from `SITES`: `workday`, `oracle`, `greenhouse`, `lever`, `ashby`, `phenom`, `dayforce`, `successfactors` |
| `name` | As the user knows it ("Oracle Recruiting Cloud"); the form tools' messages (the supported sites, a tab on another site) and the panel use it |
| `signature` | What the site's own pages render, as a CSS selector list: a page (or frame) is the site's when its document matches any part. How the extension tells a site, before the URL ([telling a site](extension.md#telling-a-pages-site-framests)). Each part is the provider's own markup (its widgets' attributes, class names, script host), never a link to it or its embed script, which an employer's careers page has too |
| `isUrl(url)` | A posting or application page of the site by its URL alone: what decides where no page can be read (a captured page's links, the companion's canonical URLs, a tab the extension can't read) |
| `tenant(url)`, `job(url)` | The employer's space and the job, lowercased, read from a URL of the site's (by `isUrl`, or a tab whose page showed the site) |
| `canonicalPath?(pathname)` | The posting's identifying path, when the site varies it for the same job (a locale segment, an application page) |
| `hostPageJob?(url)` | The site's job that a page on another host names in its URL: a company's careers page embedding the site's board (Greenhouse: `?gh_jid=`). Ties a posting captured there to its application |
| `sameJob?(a, b)` | Whether two of the site's job ids name one job where its pages use different ids for it (Phenom: `jobSeqNo` embeds the requisition the posting shows, [Phenom](sites/phenom.md)). Consulted by `sameJob` only when the caller names the site, so no other site's ids are compared loosely |
| `jobParams?` | Query parameters, lowercased, that name a job on the site's pages or on pages embedding it: a posting's canonical URL keeps them ([postings](postings.md)) |
| `providerHosts?` | Hosts that serve the site for every employer, so they name the provider, not the employer (a board's host, a data centre's): a posting's company never comes from such a host's name, and a frame on one is an embedded job board ([capture](extension.md#capture)) |
| `company?(url)` | The employer a URL on one of its `providerHosts` names (a Workday tenant, a board's first path segment); without it, the page's title says |
| `waits` | The site's own waits ([waits owned by the site](adapters.md#waits-owned-by-the-site)); all start from `STANDARD_WAITS` |

Asking it: `siteInfo(id)`, `siteOfUrl(url)`, `detectSite(url)` (a registry site by its URL alone, else `generic`),
`isFormSite(id)` (a registry site's id, checked on every id from the wire or a stored posting), `siteTenant(url)`,
`siteJob(url)`, `sameJob(a, b, site?)` (equal, or Workday's `-1` posting suffix, or the named site's own rule:
[which posting](../mcp-tools.md#forms)), `siteSignatures()`, `providerOf(host)` and `SITE_JOB_PARAMS`. Derived from it:
the companion's canonical posting URLs (`canonicalPath`, `jobParams`), a posting's company (`providerHosts`,
`company`), which application a posting is tied to and which posting a tab belongs to (`tenant`, `job`,
`hostPageJob`, `sameJob`), the extension's bundles, the site of every tab, frame and capture in the extension
(`siteSignatures`, then `detectSite`), the embedded boards a capture looks for, the site list in the bridge's `hello`,
and `loadTiming`'s per-site sections. `registry.test.ts` checks the registry's own rules and that every site has a
signature; `conformance.test.ts` checks each signature on every saved page of every site.

**Why signatures, and access to every site.** Phenom and Oracle run on employers' own domains, where the URL
is the employer's and its shape varies from one employer to the next: Phenom's apply pages are
`/ca/en/apply` on one site and `/global/en/apply` on another, and a URL rule written from the first missed the
second, so a Phenom application was listed `generic` and the form tools refused it. What every page of a
provider's site has is the provider's own markup, so that's what tells the site. Reading a page needs access to
its host, which for sites on any host means every host: asked for one origin at a time, a tab on an unknown
host stayed unreadable until something already knew its site, which only the URL could say.
`HOST_PERMISSIONS` is `<all_urls>`, which also lets `tab.screenshot` work. The cost is Chrome's broadest
install warning ("Read and change all your data on all websites"), accepted for this; the extension still acts
on a page only for Capture or a call from Claude ([security](../security.md)).

## Why these three
Sites were chosen by how often employers use them, not by the user's own postings. Published market-share
counts (2025–2026, e.g. voronoiapp's ATS share and ERE's ATS reports) put Workday, Taleo, SuccessFactors, iCIMS,
Greenhouse, SmartRecruiters, Lever and BrassRing at the top, with Ashby rising among newer companies. Of those
that weren't built yet, Greenhouse, Lever and Ashby have public application pages anyone can open, so they could
be built from real markup and checked live without an account. The others couldn't:

| Provider | Why not yet |
|---|---|
| iCIMS | Blocks headless browsers; its application sits behind a candidate account |
| SmartRecruiters | Bot protection (DataDome) on its application pages. Not worked around, on purpose |
| Taleo, BrassRing | The application is behind a candidate account on each employer's site |

Each needs pages the user saves from a real application in their own browser. None is planned yet. SuccessFactors,
whose application is also behind a candidate account, was built from such a page ([its page](sites/successfactors.md)).

## What the three boards share
- **Registry entries** (each board's `registry.ts`): https only; the board's company as tenant and its posting as
  job, both lowercased. Their hosts are the provider's, so the company comes from the tenant. Standard waits.
- **Signatures**, what tells the board's pages by their body ([telling a page's
  site](extension.md#telling-a-pages-site-framests)), each the board's own markup and not the embed script or
  links a careers page around it has: Greenhouse's `.job-post-container` or
  `form#application-form .application--questions`; Lever's `.posting-categories .posting-category`,
  `form#application-form .application-question` or `a.postings-btn`; Ashby's `[class*='ashby-application-form']`
  or `[class*='ashby-job-posting']`. The URL rules still decide where no page can be read, and the boards' own
  hosts match them anyway.
- **Page kinds** (`singlePageKind`): a page with fields is a `step`; without, a page saying thanks is the
  `confirmation`, one with an Apply button is the `posting` (its `apply` action presses it); else `unknown`.
- **Submit** is `isSubmitByText`: a `type=submit` control, or one reading "Submit (application)" or "Send". It's
  the page's `next`, so `nextLabel` shows it, and the guard blocks any synthetic press of it.
- **The job title** is the page's own title, which is also the step's (`titledJob`): Greenhouse's
  `.job__title h1`, Lever's `.posting-header h2` (the application page; `.posting-headline h2` on the posting's),
  Ashby's `h1`. Read on each live snapshot. Lever needs both: its application page has no `.posting-headline`,
  and without a title the step is "Application".
- **Embedded boards:** a company's careers page that names a Greenhouse job in its URL (`?gh_jid=`,
  `hostPageJob`) ties the posting captured there to that job, so its application is told apart from others
  ([which posting](../mcp-tools.md#forms)).
- **Messages** (`singlePageMessages`): `go_next` says the whole application is on this page and the user reviews it
  and presses Submit.
- **Hints** for the fields every board asks: name, email, phone, links. Lever's and Ashby's name is one field;
  its hint `identity.fullName` makes the planner join first, middle and last name. A location hint is
  `contact.address.city`, filled with the adapter's own (loose) match like every city: a city alone can match
  several places, and then nothing is chosen and the suggestions go back to the agent.

## What was verified, and how
Each board's definition was built from a live application page rendered by headless Edge (saved, without scripts and
styles, as the board's `fixtures/`: `greenhouse-apply.html`, `lever-apply.html`, `ashby-apply.html` and
`ashby-groups.html`, employer details replaced; each board's `test/live.test.ts` reads them), then checked on live
public forms with fake values, never submitting ([how](adapters.md#checking-a-site-live)). What each run showed, and
what's still untried, is on the board's page; the other sites' are on theirs.
