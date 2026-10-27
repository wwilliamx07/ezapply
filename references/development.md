# Development

## Repo layout

```
ezapply/
  CLAUDE.md                 rules for the whole repo (keep references/ and todo/ current, no sensitive data)
                            (each directory's own rules are in its CLAUDE.md; see "Conventions")
  references/               this reference (source of truth); CLAUDE.md: how its pages are written
  README.md                 quick start
  todo/                     work not yet built: todo.md maps the items in order, one directory per item
  package.json              npm workspaces, scripts
  tsconfig.base.json, tsconfig.tests.json, biome.json, vitest.config.ts, .gitattributes
  .github/workflows/ci.yml
  .claude/                  Claude Code for this repo: skills/garden/ (see "Conventions"), skills/ui-fuzz/ (see "The UI fuzzer")
  test/                     checks on the reference itself (references.test.ts)
  scripts/harness/          the adapter harness: clones of real application forms, fill runs → harness.md
  scripts/fuzz/             the UI fuzzer and its goldens → "The UI fuzzer" below
  .clones/                  the harness's clones and browser profile (git-ignored)
  .fuzz/                    the fuzzer's screenshots and the panel page it builds (git-ignored)
  packages/
    protocol/               shared schemas            → components/protocol.md
    engine/                 the adapter engine and shared widget drivers (sources only) → components/adapters.md
    sites/                  everything about each job site, a directory per site → components/sites.md
    companion/              MCP server, bridge, services, the panel's agent (runs inside `ezapply`) → components/companion.md
    cli/                    the ezapply command, workspace templates, skills → components/cli.md
    extension/              the browser extension and its side panel → components/extension.md
    ui/                     the side panel's components, the review and setup pages (React) → components/ui.md
```
Each package has `src/` and `test/`; all but the engine build to `dist/` (the engine's sources are compiled into
each site's bundle). The sites package also keeps each site's tests beside it, in `src/<site>/test/`.

## Tooling
- **Node** ≥ 22.12 (CI uses 24). npm workspaces; no other package manager. npm was chosen over pnpm because it
  ships with Node, so setup installs nothing extra; switching later would be cheap.
- **TypeScript 7**, strict, project references: `tsc -b packages/protocol packages/sites packages/companion packages/cli`.
  The sites package builds only its registry, notes and readers for Node; its definitions are typechecked with the
  DOM libraries by `tsconfig.definitions.json` ([two builds](components/sites.md#the-package)).
  If type errors look stale after a `tsconfig` change, delete `packages/*/tsconfig.tsbuildinfo`.
- **esbuild** bundles the extension (`packages/extension/build.mjs`) and the UI package's pages
  (`packages/ui/build.mjs`; React 19, pdf.js, [ui](components/ui.md#the-build-npm-run-build--w-ezapplyui)).
- **Biome** lints and formats (2-space indent, 120 columns, double quotes, organized imports, the `recommended`
  rules), and skips what `.gitignore` does. It also skips `dist`, the live HTML snapshots in each site's `fixtures/` (third-party markup), the golden
  schemas in `sites/src/<site>/test/golden/` (written by the test), and `ui/src/review/textlayer.css` (pdf.js's rules,
  kept as they came). Its React rules apply wherever React is a
  dependency, the extension included since it bundles the side panel; the adapter engine's `use…` functions
  aren't hooks, so `useHookAtTopLevel` is off for `packages/engine/` and `packages/sites/`.
- **Line endings:** `.gitattributes` pins LF everywhere (Biome rejects CRLF). On Windows, a working tree
  checked out with CRLF is renormalized with `git rm --cached -r . && git reset --hard` (on a clean tree).
- **Vitest** runs every `packages/*/test/**/*.test.{ts,tsx}`, each site's `packages/sites/src/*/test/**/*.test.ts`,
  the harness's `scripts/*/test/**/*.test.ts` and the repo's own `test/**/*.test.ts` (20 s default
  timeout). A test that needs a DOM says so in its first line (`// @vitest-environment jsdom`); the UI's component
  tests use Testing Library.

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | `npm install`, build, `ezapply init` |
| `npm run build` | tsc build of protocol, sites, companion, cli; then the extension bundles and the UI package's pages |
| `npm test` | build, then vitest |
| `npm run typecheck` | all packages (the engine, the sites' definitions, the extension and UI with their own `tsconfig.json`) `tsconfig.tests.json` (tests), `scripts/harness` and `scripts/fuzz` |
| `npm run lint` / `npm run format` | Biome check / write |
| `npm run ezapply -- <cmd>` | run the CLI |
| `npm run clone -- <posting-url>` / `npm run fill -- <site>` | clone a site's application / fill its clone ([harness](harness.md#commands)) |
| `npm run fuzz -- [section or scenario …]` | the UI fuzzer ([below](#the-ui-fuzzer)) |

## Tests
Each package's tests are in its `test/` (and each site's in `packages/sites/src/<site>/test/`), a file per area, named after it (`forms.test.ts`, `checklist.test.ts`).
What a file covers is in its `describe` and `it` names; read those rather than a list here, which would only
repeat them and fall behind.

| Kind | Where | For |
|---|---|---|
| Module and service tests | `packages/*/test/<area>.test.ts` | One service or module, with stubs at its edges (`companion/test/claude-stream-stub.mjs` plays Claude Code's stream-json, `cli/test/quiet-child.mjs` a process set up like `ezapply`) |
| End to end | `companion/test/e2e.test.ts` | A real companion on a free port, over HTTP, MCP and the bridge, behind a fake extension that runs the real adapters on their fixtures. A new MCP tool or bridge method is tested here, or in its service's test |
| Behavioural fixtures | `sites/src/workday/test/fixture.ts`, `sites/src/oracle/test/fixture.ts` (with `engine/test/shims.ts`) | jsdom pages that act like the site's widgets (events, lists that load late), built from saved pages and debug traces. Filler tests run on these: jsdom doesn't run a saved page's own scripts, so a saved page can't test a fill |
| Live snapshots | `sites/src/<site>/fixtures/` | Real pages, scrubbed ([below](#live-snapshots-are-scrubbed)), for extraction and page detection (each site's `test/live.test.ts`, and the signatures in `conformance.test.ts`) |
| Golden schemas | `sites/src/workday/test/golden/`, `sites/src/oracle/test/golden/` | `getForm()` of every Workday and Oracle fixture state, written by each one's `golden.test.ts`: a diff there is a change to what the agent sees |
| Conformance | `sites/test/conformance.test.ts` | Every registry site has its directory, its files and its place in each list, and, on the page its `test/page.ts` builds, answers the adapter API the same way |
| Site knowledge | `sites/test/knowledge.test.ts` | No other package's source names a site (comments aside): what a site does differently stays in its directory |
| URL rules | `sites/src/<site>/test/url.test.ts` | The site's postings and applications by URL, tenant and job, and pages that look close but aren't |
| UI | `ui/test/` | Components and pages under jsdom, with Testing Library |
| The UI fuzzer | `scripts/fuzz/test/` | The [UI map](ui-map/README.md) reads without problems and every scenario starts on one of its pages; then the quick scenarios walked in a real browser, skipped without one or a built UI. The whole fuzz is `npm run fuzz` ([below](#the-ui-fuzzer)) |
| The adapter harness | `scripts/harness/test/` | The stand-in, what a clone keeps and the proposed description, without a browser; then the whole harness on a hand-written site, which skips without a browser or a built extension ([harness](harness.md#tests)) |
| The reference | `test/references.test.ts` | Links and anchors in `references/`, `todo/` and the `CLAUDE.md` files resolve; the [index](README.md) lists every page; every registered MCP tool has its row in [mcp-tools.md](mcp-tools.md), and no row names a tool that isn't registered; every registry site has its page under [components/sites/](components/sites.md), titled with its directory; every shipped skill is named in [workspace.md](components/workspace.md) |

Tests that need TeX are skipped when no engine is installed (CI's `tex` job sets `EZAPPLY_REQUIRE_TEX=1`,
which turns a missing engine into a failure); everything else runs without external tools (git is required
for `repos.test.ts`).

### Live snapshots are scrubbed
The pages in each site's `fixtures/` were captured from real career sites, some during the user's own
applications. Nothing in them, or in the tests, goldens and pages written about them, may say which employers the
user looked at or applied to, or anything about the user (`CLAUDE.md`, "Never expose sensitive information"). So
each employer is a fictional one, used consistently across the page, its tests and its golden schema:

| Snapshots | Employer | Site |
|---|---|---|
| `posting`, `start-choice`, `auth` | Initech (`initech.wd5.myworkdayjobs.com`) | Workday |
| `my-experience` | Cyberdyne | Workday |
| `oracle-posting`, `oracle-email`, `oracle-apply` | Umbrella (`jobs.umbrella.example`) | Oracle |
| `greenhouse-apply` | Vandelay | Greenhouse |
| `lever-apply` | Wonka | Lever |
| `ashby-apply` | Stark | Ashby |
| `ashby-groups` | Wayne | Ashby |
| `phenom-step1`, `phenom-step2`, `phenom-step2-errors`, `phenom-step3` | Globex (`jobs.globex.example`) | Phenom |
| `dayforce-candidate-info` | Hooli (client `hooli` on `jobs.dayforcehcm.com`) | Dayforce |
| `successfactors-application` | Soylent (company `soylent` on `career17.sapsf.com`, `careers.soylent.example`) | SAP SuccessFactors |

Employer domains become `.example`, and requisition and posting ids, uuids, job titles and the job slugs in links
become fake ones. So do addresses, pay, dates and brand colours. Descriptions, privacy notices and other prose
outside the form become placeholder text. The user's own values become made-up ones: names, contact details,
dates, languages, field of study, and the browser's timezone in hidden inputs. Form structure, labels and option
lists stay as captured, since that's what the adapters read. A new snapshot gets the same treatment before it's
committed. Then read its visible text and attribute values to check nothing was missed, since names also turn up in
`alt` text, link slugs, hidden JSON and image paths.

## The UI fuzzer
The side panel, the review page and onboarding, tested by the agent in a real browser rather than by the user
clicking through them. `npm run fuzz` (or `-- panel`, `-- review`, `-- onboarding`, or a scenario's name)
needs `npm run build` first and a browser (the harness's: Playwright's Chromium, else Edge or Chrome). It prints
each scenario's screens and presses, then every failure with the map page it's about and the presses that reached
it, and exits 1 on any. The screenshots are in `.fuzz/shots/`, for the agent to open.

**Run it with `/ui-fuzz`** (`.claude/skills/ui-fuzz/`), on demand rather than after every UI change: it builds,
fuzzes (`$ARGUMENTS` passed through), and triages each failure as the UI's bug or the [UI map](ui-map/README.md)
out of date, fixing whichever is wrong. The whole run takes about four minutes, so while iterating, name the
section. The quick scenarios also run in `npm test` (above), so a break in the fuzzer itself shows there. `/garden`
keeps the fuzzer's inputs from rotting: scenarios no map page needs, goldens no screen matches, map pages naming
controls the UI no longer has.

- **The map is the input.** [`references/ui-map/`](ui-map/README.md): a page per screen or state, each with the
  selector that tells it's on screen and a table of its controls, their selectors and conditions, and where each
  leads (`scripts/fuzz/lib/map.ts` reads them). The fuzzer checks the UI against it, so the map can't drift.
- **A fake companion** (`lib/server.ts`, `lib/fakes.ts`): the UI package's built pages served as the companion
  serves them (its CSP too), the panel bundled from `scripts/fuzz/panel/main.tsx` (`PanelApp` with a transport to
  the fake in place of the extension's background, on React's development build so its warnings count), and canned
  answers to every call: the agent replies to a message at once, a build succeeds or fails as the scenario says, a
  task stays queued. What a press changes (a card answered, a posting deleted) changes the fake's state and reaches
  the page as the companion's events would. No request leaves the machine.
- **Scenarios** (`lib/scenarios.ts`): named starting states per section (no applications, agents working with cards
  waiting, a review of a changed resume, onboarding fresh or mostly done), listed in each map section's README.
  *Where the canned answers come from:* written by hand with the protocol's types, so a change to what the companion
  sends fails the typecheck here instead of leaving the fuzzer on a shape the companion no longer has. Rejected:
  answers recorded from a real run and scrubbed (they hold the user's data until scrubbed, and go stale as quietly,
  without the typecheck). Placeholder people and employers only.
- **The walk** (`lib/walk.ts`): from each scenario's first screen, every control on each screen is pressed in a
  fresh page load, the presses that led there replayed first, and the screen it leads to checked against the map. A
  screen is walked again when it shows a control no earlier visit did, or in a new state while it has had few (so
  Approve, which leads on to the rest without showing anything new itself, is followed). Fields take odd values
  (empty, 5,000 characters, non-ASCII, LaTeX, markup); a button disabled until there's text gets its screen's empty
  fields filled first. A `confirm` is accepted, a file chooser gets a placeholder PDF, new tabs and downloads are
  counted and closed. Then a seeded random walk presses anything on screen (`--steps`, `--seed`).
- **It fails on** a console error or an uncaught exception; a press that changed nothing and called nothing (a
  dead control); a control on screen that no map page lists; a listed control missing from its screen; a press
  leading somewhere other than the map says; a page, or a conditional control, that no scenario of its section
  showed; and a screenshot that differs from its golden.
- **Goldens** (`scripts/fuzz/goldens/<platform>/<scenario>/`, named by the presses that reached the screen): a
  screenshot of every screen walked, compared pixel by pixel in the browser. A difference saves the new one beside
  the old as `.new.png` (git-ignored) and fails; `--update` writes them all and removes the ones no screen matches
  now. A missing golden is written and reported, not failed: a new screen, or a platform with none yet (fonts
  differ between systems, so each keeps its own). Look at new goldens before committing them. The walk queues what
  it finds in the order of the presses, not the order they finish in, so the same screen gets the same name.
- **Timing.** Each page opens in a browser context of its own (`--workers`, six at once by default, across
  `--parallel` scenarios): pages of one site in one context share a renderer process, and side by side they ran one
  at a time, slow enough to read as the UI being slow. A press is done when the page's own requests (counted in the
  page, since Playwright's request events arrive late under load) are answered and its DOM has been still for a
  moment.

## CI
GitHub Actions (`.github/workflows/ci.yml`) on every push and pull request, Node 24:

| Job | Runs on | Does |
|---|---|---|
| `check` | `ubuntu-latest`, `windows-latest` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (TeX tests skip: no engine) |
| `tex` | `ubuntu-latest` | Installs TeX Live (`latexmk`, XeLaTeX, pdfLaTeX, recommended and extra packages, Latin Modern), builds, and runs the documents and template tests with `EZAPPLY_REQUIRE_TEX=1` |

## Conventions
- **Keep `references/` current** in the same change (see [CLAUDE.md](CLAUDE.md)).
- **Rules beside what they govern.** The root `CLAUDE.md` holds only the rules for the whole repo; a directory's own
  conventions are in its `CLAUDE.md`: `references/`, `todo/`, `packages/sites/`, `packages/companion/`,
  `packages/cli/`, `packages/ui/`, `scripts/harness/` and `scripts/fuzz/`. Claude Code loads one when it works in that folder, so the rules reach an agent that went
  straight there without reading here first, and the root file stays short in every session. Keep them short; a
  rule's reasons stay on its page here. (`packages/cli/templates/workspace/CLAUDE.md`
  is different: it's the user's workspace file, shipped by `ezapply init`.)
- **Garden now and then.** `/garden` (`.claude/skills/garden/`) audits the whole repo against these rules and the
  `CLAUDE.md` files. It deletes stale comments, dead code and tracked files nothing uses, trims `references/` and
  `todo/` back to what they're meant to hold, checks every page against the code, and sweeps for sensitive data.
  It changes no behaviour and doesn't commit: what it can't prove dead, it reports. Its `candidates.mjs` lists
  likely hits (unused exports, unnamed files, comments naming what no longer exists, history in comments) for
  the audit to check one by one. It is a heuristic, not a lint, so nothing runs it in CI.
- **Thin tools, fat services.** An MCP tool validates, calls a service, returns JSON. Logic lives in
  services, which are wired explicitly in `main.ts`.
- **Errors carry a fix.** Throw `EzError(code, message, hint)`; the hint says what Claude should do (call a
  tool, ask the user, install something with the exact command). Never let a raw exception reach a tool
  result.
- **Validate at every boundary** with zod: tool inputs, bridge params and results, files read from disk.
- **Paths from Claude** go through `Workspace.resolveAllowed` with the narrowest folder list; ids that become
  folder names are checked too.
- **Write atomically** (`writeFileAtomic` for text or bytes, `writeJsonAtomic`, in `companion/src/util/fs.ts`).
- **Shared helpers live in `companion/src/util/`** (`fs.ts`, `keyed-queue.ts`, `wait.ts`, `open.ts`, `proc.ts`,
  `install-hints.ts`), and the index exports what the CLI uses; don't redefine `exists` or a polling loop locally. The
  adapters' own `waitFor` in `engine/src/dom.ts` is different on purpose: it runs in the page and polls a synchronous
  DOM condition.
- **External programs** through `run()` (no shell, timeouts, tree kill) and `which()`; programs that should
  outlive the call (a viewer, a browser) through the `Opener`.
- **Site strings** only in the site's directory, `packages/sites/src/<site>/` ([the package](components/sites.md#the-package)):
  its registry entry for what the companion and the background need too (hosts or paths, tenant and job parsing, the
  posting-page hooks), its definition for the rest. Other code asks the registry, and reads the schema's facts
  (`kind`, `saved`, `lastPage`); `sites/test/knowledge.test.ts` fails on a site's id anywhere else.
- **Adapter bundles stay free of zod:** in-page code imports the protocol only through its import-free
  subpaths (`@ezapply/protocol/sites`, `/timing`) or as types.
- **No personal assumptions in code**: everything user-specific lives in the profile and config.
- **One adapter change per live run.** The fixtures can't catch a slower or broken fill on a real site, since
  they're built from what the adapter expects. So land adapter changes one per live run, so a slowdown or failure
  points at one change, and don't bundle them. Why: one commit that changed about ten things in the Workday
  adapter at once made live filling several times slower (a step's `fill_fields` past the companion's 120 s
  timeout), and which change did it was never found. A change that only moves code (equal golden schemas and
  behaviour tests) may go in with others; say so in the commit. Which changes the next live run of each site has
  to check, and what to suspect if it's slower, is in [status](status.md#not-yet-verified-for-real).
  `autofill-timing.yaml` can shorten a wait without a rebuild.

## Debugging a live run (debug mode)
`ezapply debug on` before the run (in the user's workspace), `ezapply debug report` after it, then open the
`NNNN-<tool>.json` records it points to ([format](data-formats.md#debugdate-postingid-companionsrcformsdebugts)).
A record holds every request to the extension with the adapter's full answer, the tab's state and the timings.
The report counts the calls made with the tab hidden and with the browser window behind another app (no focus
events reach the page then).

Inside the page, each adapter call's `trace` shows what the adapter did and what the page did back
([adapters](components/adapters.md#debug-mode-the-adapter-trace)), and the report sums it up: the slowest
fields and waits, waits that ran to their maximum (a settle the page never let go quiet, a condition that never
came), the slow paths taken, and the page's own errors and failed requests. `debug.markup` (default `failures`)
saves the page before each call and at every failed field, with a screenshot when the tab was on screen.

**The loop**, for Claude in this repo after a live run with debug on:
1. Read the report. For a failure, read its call's trace and its `NNNN-fail-<fieldId>.html`, and find where the
   adapter's picture of the page and the real page diverged: the listbox it read, the options it saw, the wait
   that ran out, the DOM change it didn't expect.
2. Export the page (`ezapply debug export <session|latest> <NNNN> [before|after|fail-<fieldId>]`,
   [cli](components/cli.md#debug-export)). The user looks at the fixture candidate before it goes into
   the site's `fixtures/`; scrub what's left by hand ([live snapshots](#live-snapshots-are-scrubbed)),
   then add an extraction test to its `test/live.test.ts`.
3. Correct the behavioural fixture to the real markup and the events the trace shows, and write the filler
   test there: jsdom doesn't run the site's scripts, so a saved page can't test a fill.
4. Fix, run live again (one adapter change per run), and compare the reports.

Compare a debugged run's timings with other debugged runs only. Turn it off (`ezapply debug off`) and
`ezapply debug clean` when done: the records hold the user's data.

## How to…
- **Add an MCP tool:** service method → register in the right `mcp/tools/*.ts` with a precise, short
  description (Claude reads it, and every description stays in context) → test in `e2e.test.ts` or the
  service's test → add it to skills that should use it, and to [mcp-tools.md](mcp-tools.md). Name it
  `<noun>_<verb>`, except in the form group, whose tools read as commands (see
  [mcp-tools](mcp-tools.md)). Don't list it in `EZAPPLY.md`: the MCP server already gives Claude the tool
  list.
- **Add a bridge method:** schema in `protocol/src/forms.ts` (or `bridge.ts`) → add to `ExtensionApi` /
  `CompanionApi` → implement the handler on the serving side (type errors until you do; for a form method
  that's `extension/src/background/forms.ts` and the handler map in `companion/test/e2e.test.ts`) → decide
  whether it's additive or needs a `PROTOCOL_VERSION` bump ([changing the protocol](components/protocol.md#changing-the-protocol)). A new site needs none (`hello` carries the site
  ids), and a changed adapter needs none of its own: the build stamps `ADAPTER_VERSION` with a hash of the bundle.
- **Change a stored format:** bump its `schemaVersion`, add a migration run by `ezapply init`, update
  [data-formats.md](data-formats.md).
- **Change a skill or `EZAPPLY.md`:** edit `packages/cli/templates/`; users get it with `ezapply init`.
  A new skill is named `ezapply-<name>` (folder and `name:`), never a bare word, so it can't shadow a
  Claude Code command or be overridden by a user's skill. Renaming or removing one adds the old name to
  `RETIRED_SKILLS` in `workspace-init.ts` so `init` removes the old copy.
  `EZAPPLY.md` is in every session's context: keep it near 100 lines, add only rules that apply to every
  task, and put procedures in skills. Rules that must hold even without it (Explore/Plan subagents) also go
  in the MCP server instructions (`mcp/server.ts`).
- **Add a job site:** follow [building adapters](building-adapters.md): the process from saving the site's pages
  to its first real application, what goes in the registry, the definition, the site's notes and the tests, and
  the rule that tool descriptions and skills never name a site.
