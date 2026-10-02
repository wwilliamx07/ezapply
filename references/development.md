# Development

## Repo layout

```
ezapply/
  CLAUDE.md                 rules for working on this repo (keep references/ current)
  references/               this reference (source of truth)
  README.md                 quick start
  todo.md                   open work and proposals, ranked (a work list; references/ describes what's built)
  package.json              npm workspaces, scripts
  tsconfig.base.json, tsconfig.tests.json, biome.json, vitest.config.ts, .gitattributes
  .github/workflows/ci.yml
  scripts/workday-recon.mjs live Workday check (Playwright, headless)
  scripts/oracle-recon.mjs  live Oracle check up to the email step (Playwright, headless)
  scripts/usage-report.mjs  token usage of a Claude Code session in the workspace
  packages/
    protocol/               shared schemas            → components/protocol.md
    companion/              MCP server, bridge, services (runs inside `ezapply chat`) → components/companion.md
    cli/                    the ezapply command, workspace templates, skills → components/cli.md
    extension/              the browser extension     → components/extension.md
```
Each package has `src/`, `test/`, and builds to `dist/` (the extension also to `dist-firefox/`).

## Tooling
- **Node** ≥ 22.12 (CI uses 24). npm workspaces; no other package manager. npm was chosen over pnpm because it
  ships with Node, so setup installs nothing extra; switching later would be cheap.
- **TypeScript 7**, strict, project references: `tsc -b packages/protocol packages/companion packages/cli`.
  If type errors look stale after a `tsconfig` change, delete `packages/*/tsconfig.tsbuildinfo`.
- **esbuild** bundles the extension (`packages/extension/build.mjs`).
- **Biome** lints and formats (2-space indent, 120 columns, double quotes, organized imports). It skips
  `dist`, `dist-firefox`, the live HTML snapshots in `test/fixtures/live/` (third-party markup), `project.txt`.
- **Line endings:** `.gitattributes` pins LF everywhere (Biome rejects CRLF). On Windows, after a fresh
  clone with the old settings, renormalize with `git rm --cached -r . && git reset --hard` (on a clean tree).
- **Vitest** runs every `packages/*/test/**/*.test.ts` (20 s default timeout).

## Scripts

`scripts/` is not in the repo: d456ecc removed it and added it to `.gitignore`. The `usage:report` and
`recon:*` entries below run only with a local copy of those scripts; without one they fail with a missing file.

| Command | Does |
|---|---|
| `npm run setup` | `npm install`, build, `ezapply init` |
| `npm run build` | tsc build of protocol, companion, cli; then the extension bundles |
| `npm test` | build, then vitest |
| `npm run typecheck` | all packages and `tsconfig.tests.json` (tests) |
| `npm run lint` / `npm run format` | Biome check / write |
| `npm run ezapply -- <cmd>` | run the CLI |
| `npm run usage:report [-- <transcript.jsonl>]` | token usage of a workspace session (default: the most recent, found from `config.json`'s workspace under `~/.claude/projects/`): turns, tokens re-sent and written, average and peak context, then per user prompt (turns, tokens, context at start → end), per tool (calls, result size, images), and per subagent (from its `.meta.json` description). Every turn re-sends the conversation, so cost ≈ turns × context; use it before and after a change meant to cut usage. Synthetic zero-usage entries and harness notifications aren't counted |
| `npm run recon:workday -- <careers-url> [outDir]` | headless walk of a public Workday tenant up to sign-in, printing what the adapter sees and saving each page's HTML (needs `npm run build` and Playwright's Chromium) |
| `npm run recon:oracle -- <job-url> [outDir]` | the same for a public Oracle job: the job page, then Apply to the email step, where it stops (never types anything). `RECON_CHANNEL=msedge` (or `chrome`) uses an installed browser when Playwright's Chromium isn't downloaded |

## Tests

| File | Covers |
|---|---|
| `protocol/test/rpc.test.ts` | RPC round trips, validation, errors, timeouts |
| `protocol/test/workday.test.ts` | Which hosts count as Workday (not the marketing site or employee tenants), tenants from myworkdayjobs hosts and myworkdaysite paths |
| `protocol/test/oracle.test.ts` | Which pages count as Oracle (Oracle Cloud hosts and employers' domains, by path; not other "sites" pages or http), tenants as host and site number, `siteTenant` for both sites, a job's path without language or application pages |
| `companion/test/e2e.test.ts` | A real companion on a free port: HTTP guards, `/health` with `mode: "chat"`, no control routes (404), bridge handshake, pinning, Firefox origins, the browser reported in `hello` (in `browser_status`, "connected in Edge" in `workspace_check`, kept after a disconnect), the pairing window opened by `extension_pair`, `extension_pair`/`replace`, `posting_active` waiting for a queued capture after a start and giving up after the grace period with the reconnecting hint, the `ChatHost` change events from a capture and `posting_activate`, pairing written into `config.json` without undoing edits made meanwhile, `github_login` with a stub opener (opened, naming the browser, and not; `app: "existing"` returning the callback URL), capture → MCP, invalid posting ids, the review page (token, PDFs served, answers, waiting, a replaced or answered review) and the approval gate on `upload_file` (refused before approval, allowed after, refused again for a rebuilt file, never for `library/`), `notAttached` naming an approved cover letter after only the resume was uploaded and again on reaching review, and gone once it's uploaded, `attach_mode_set` keeping the rest of the config, and the form tools driving the **real Workday adapter on the shared jsdom fixture** behind a fake extension: `list_options` for several fields (one unknown), lean fill results (a clean success bare, a matched option's full text kept), fill, clear an old attachment, upload, add and remove a row, next and refusal, back from review and forward again, the log and status; lean `get_form` with its filters; tab choice by the active posting's tenant and `postingMismatch` with nothing logged; the **real Oracle adapter on its fixture**: an Oracle posting (site, tenant; a capture on its application pages is the same posting) choosing its Oracle tab over a Workday tab in front, a fill credited and logged, `go_next` refusing Submit, and the Workday tab then reported as another tenant |
| `companion/test/extract.test.ts` | Posting extraction and metadata; company from ATS, LinkedIn and Indeed URLs; Workday locale dropped from canonical URLs; an Oracle job's language and application pages dropped; myworkdaysite tenants and embedded frames; an Oracle posting's tenant, and its company from the title rather than an Oracle Cloud host |
| `companion/test/documents.test.ts` | Page-range parsing; PDF merge (ranges, bookmarks, metadata, normalizing, and a resized page keeping its link with its rectangle moved), render with preview, text, images → PDF, compression, encrypted or broken input, `open_file` through the opener, path guards; `% !TEX program` parsing (both spellings, 20-line window, unknown values), pdfTeX-only detection, engine resolution order and no-fallback errors (engines mocked); TeX compile, page limit with the `overflow` text, snapshots, errors with lines, no shell escape, the default cover template building under auto, and a pdfTeX-only resume building with pdflatex over `tex.engine: xelatex` (real-TeX parts skipped without an engine or without pdflatex, unless `EZAPPLY_REQUIRE_TEX=1`) |
| `companion/test/texlog.test.ts` | TeX log parsing |
| `companion/test/profile.test.ts` | Answer seed, profile and answers validation |
| `companion/test/templates.test.ts` | Template import (incl. content files, adding `% !TEX program = pdflatex` to a pdfTeX-only main file and keeping an existing comment), cover default and examples, finding content files through `\input`/`\include`/`\subfile`, `template_set_main` recording them and refusing paths outside the template |
| `companion/test/github.test.ts` | Against a mock GitHub with single-use refresh tokens: app manifest → install → OAuth login, connecting an existing app through the companion's form (state required, nothing stored before login, app identified from its installations), wrong credentials leaving the current app intact, reading an app name from a pasted address, paginated repo listing, callbacks without an issued state rejected, token refresh, one refresh for parallel callers, an unreadable stored token, the port mismatch |
| `companion/test/repos.test.ts` | With real git: read-only clone, first sync = index everything, changes since the last index, contributions, claims check, evidence hashes stamped (comments kept) and a changed line range flagged, `claims_list` text (repo headings, impact only when set, a folded claim on one line, an unparsable file named, a folder without claims left out), concurrent syncs, the token in git's environment and never its arguments (`run` spied), malformed repo names |
| `companion/test/forms.test.ts` | `FormsService` against a slow stub bridge: parallel calls on one tab run one at a time and in order, each reading its own field, while another tab isn't held up; a failed call doesn't stop the next (fails without the per-tab queue); `autofill-timing.yaml`: defaults without it and from the template, its waits scaled and sent with every call with its fill timeout, re-read per call, mistakes falling back and listed in `get_form` |
| `companion/test/util.test.ts` | `KeyedQueue` order and independence, log rotation, which URLs the opener accepts, `findBrowser` per OS (App Paths with variables, install folders, Chromium not taking Chrome's key, `.app` bundles, PATH) and `reg query` parsing, the desktop opener (pages and PDFs as `file://` URLs in the reported browser; the system opener without a browser, for an unknown one, when its program is missing or won't start, and for `.html`; non-loopback URLs refused), `updateAppConfig`, an earlier build's `daemon.json` moved to `config.json` without its idle timeout |
| `companion/test/version.test.ts` | `COMPANION_VERSION` equals the package version |
| `cli/test/workspace-init.test.ts` | `.mcp.json` stdio entry without a token, `EZAPPLY.md` command paths and sections, skills installed under `ezapply-` names with matching `name:`, old bare-named ezapply skills removed while a user's own is kept, `autoMemoryEnabled: false` added unless the user set it (other settings kept), `EZAPPLY.md` without start/stop/restart commands and with `claims_list` at the first request, the `CLAUDE.md` import and `agentFileStatus`, default cover template install and no-overwrite, `autofill-timing.yaml` written once with every wait commented out and the user's edits kept, the launcher (POSIX and Windows forms) |
| `cli/test/skill-calls.test.ts` | The call shapes in the skills and `EZAPPLY.md` (`tool { parameter, optional? }`) against the tools' registered schemas (names, required and optional, nested lists, enum values), and a shape in every file that mentions a tool with required parameters; the shape parser and checker on their own |
| `cli/test/mcp-relay.test.ts` | With a real companion, the relay relays requests and notifications and tags them with the chat session, which counts only tool calls, per session; with nothing listening, every request answers `NOT_RUNNING` (nothing is started); a request the companion received is never re-sent when the connection breaks; a slow response is waited out |
| `cli/test/chat.test.ts` | `runChat` with a stub `claude` (`claude-stub.mjs`) and a fake `ChatHost` whose changes fire events: restart with a fresh session and no arguments once another posting is active, right after a running call ends; no restart for an untouched session, the same posting, or `restartOnCapture: false`. `hostChat` with the real companion: MCP answers while Claude runs, a capture restarts Claude at once, the port closes when Claude exits; a second instance refused without starting Claude; an earlier build's background daemon shut down and its port taken; another program on the port reported. `findClaude` on Windows and elsewhere, and `EZAPPLY_CLAUDE` |
| `cli/test/quiet.test.ts` | A child process set up like `ezapply chat` (`quiet-child.mjs`: `guardProcess`, `quietProcess`, a companion capturing a page with unparseable CSS, a throwing timer and a rejected promise) writes nothing to stdout or stderr, keeps running, and has it all in the log |
| `companion/test/chat.test.ts` | `ChatSessions` counts (used, in flight, ending twice counts once), call-end listeners, `tools/call` counting in batches, accepted session ids |
| `cli/test/cli.test.ts` | The built CLI: a bad `--port` and a damaged `config.json` give one line and what to do, no stack; `start`, `stop`, `restart`, `daemon`, `pair` are unknown commands; `status` says ezapply isn't running outside a chat |
| `extension/test/workday.test.ts` | Adapter extraction (add buttons named by section, upload notices kept out of errors), every filler, two dropdowns in a row each reading its own options (the previous listbox lingering, no `aria-controls`; fails on the old logic), dropdowns that behave as live ones (`liveDropdowns`: the next one opening after a miss and after `list_options`, no list reopened after a choice; with `dismissedIgnoresNextPress`, the same dropdown filled after `list_options` and after a miss, through the second open), dates typed into a split widget that takes digits only in keydown and an honest failure when it ignores them (`dateWidget`), a skills list filled entry by entry against a delayed search with nested option hooks (bare names, acronyms, `unmatched` with suggestions), `search_options` waiting for its own results, `matchOption` (parentheticals, repeated labels, no guess between two "Yes" options), `next()` advancing when every step is titled "Application", `next()` returning once a step whose fields render late shows them (`questionsStepRenderMs`), `back()` seeing a move with same-titled steps without waiting out the timeout, a date entered again while the field shows an error and once otherwise, removing pills (charm and keyboard) and attachments (with a confirmation dialog), removable rows and removing one (with a confirmation dialog, later rows renumbered), going back from review with entries kept (and refusing on the first step), uploads not fooled by a same-named leftover file, next/refusals, submit guard, the waits the companion sends taking effect (a shorter no-results wait returns sooner) and `null` restoring the defaults, against the behavioural fixture (jsdom) |
| `extension/test/workday-live.test.ts` | Page detection on live snapshots (posting, start-choice, sign-in) |
| `extension/test/oracle.test.ts` | The Oracle adapter against its behavioural fixture (`oracle-fixture.ts`, jsdom): extraction (the phone's two fields, pills as radio or checkbox-group, date parts, add buttons, a timeline entry as a removable section, Welcome Back as start-choice), text, pills (a pressed one not pressed again), radios, textarea and checkbox fills, the read-only email refused, lists filled in page order so a city list loads for the country chosen first (its input re-rendered on opening, its option labelled "Kanata, Ontario" but shown as "Kanata", a "required" error lingering after the choice: all ok), a postal code found by searching the part before the comma, a phone number the page reformats, a miss returning the options and leaving the old choice (Escape never sent to a closed list), listing and searching, a date through three lists, uploads (a profile's resume removed first), several additional documents and removing one, unselecting pills, an inline Language form with Save (refused while incomplete; "Saved" a notice, not an error) and deleting its tile, a timeline delete through its hover button, another link row, `next` refusing a single page's Submit, the multi-page flow (validation error, Next, Previous, Submit refused), the submit guard, Use My Profile |
| `extension/test/oracle-live.test.ts` | Snapshots: a live job page (posting, Apply, tenant), the live email step (auth; email and terms, never the honeypot), and a saved single-page application (every field's kind, id, hints, options; Submit the only button; no false errors) |
| `extension/test/manifest.test.ts` | The built Firefox manifest: CSP without `upgrade-insecure-requests` and loopback-only `connect-src`, event-page background, gecko id; both builds' host permissions equal the protocol's Workday hosts, and their optional host permissions the protocol's Oracle ones |
| `extension/test/background.test.ts` | The background loaded with a stubbed WebExtensions API: the reconnect alarm exists without any install event, and an existing one is left alone; Set posting on an Oracle page asks for its origin synchronously in the click, and on other pages asks nothing |
| `extension/test/browser-id.test.ts` | `detectBrowser`: Edge and Brave named before the Chrome/Chromium brands they also list, plain Chromium, none, and Firefox through `getBrowserInfo` |
| `extension/test/frames.test.ts` | Choosing the frame that holds a posting; spotting an embedded job board that couldn't be read |

Tests that need TeX are skipped when no engine is installed (CI's `tex` job sets `EZAPPLY_REQUIRE_TEX=1`,
which turns a missing engine into a failure); everything else runs without external tools (git is required
for `repos.test.ts`).

## CI
GitHub Actions (`.github/workflows/ci.yml`) on every push and pull request, Node 24:

| Job | Runs on | Does |
|---|---|---|
| `check` | `ubuntu-latest`, `windows-latest` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (TeX tests skip: no engine) |
| `tex` | `ubuntu-latest` | Installs TeX Live (`latexmk`, XeLaTeX, pdfLaTeX, recommended and extra packages, Latin Modern), builds, and runs the documents and template tests with `EZAPPLY_REQUIRE_TEX=1` |
| `firefox` | `ubuntu-latest` | Builds and runs Mozilla's `web-ext lint` over `dist-firefox/` (via `npx`, so it isn't an install-time dependency of the repo). Firefox itself isn't run |

## Conventions
- **Keep `references/` current** in the same change (see `CLAUDE.md`).
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
  `install-hints.ts`) and are exported for the CLI; don't redefine `exists` or a polling loop locally. The
  adapters' own `waitFor` in `adapters/common/dom.ts` is different on purpose: it runs in the page and polls a synchronous
  DOM condition.
- **External programs** through `run()` (no shell, timeouts, tree kill) and `which()`; programs that should
  outlive the call (a viewer, a browser) through the `Opener`.
- **Site strings** only in each adapter's `selectors.ts` (`adapters/workday/`, `adapters/oracle/`), plus
  `protocol/src/workday.ts` and `oracle.ts` for what the companion and background need too (hosts or paths,
  tenant parsing, the posting-page hooks). Both sides import those from there instead of repeating them.
- **Adapter bundles stay free of zod:** in-page code imports the protocol only through its import-free
  subpaths (`@ezapply/protocol/workday`, `/oracle`, `/timing`) or as types.
- **No personal assumptions in code**: everything user-specific lives in the profile and config.
- **One adapter change per live run.** Commit e390fef (2026-09-28) changed about ten things in the Workday
  adapter at once, and live autofill got several times slower (a step's `fill_fields` past the companion's
  120 s timeout, nine dropdowns past 110 s). c6aac3e reverted what the live runs hadn't shown working, and
  which change caused it was never found. The fixtures can't catch this: they're built from what the adapter
  expects. So land adapter changes one per live run, so a slowdown points at one change, and don't bundle
  them. b5ba545 brought two of the reverted ideas back (`openListboxRetrying`, and `back()` seeing a move by
  step index): if a live run is slower than the Oscorp and Tyrell runs ([status](status.md)), suspect those first.
  `autofill-timing.yaml` can shorten a wait without a rebuild.

## Debugging a live run (autofill debug mode)
`ezapply debug on` before the run (in the user's workspace), `ezapply debug report` after it, then open the
`NNNN-<tool>.json` records it points to ([format](data-formats.md#debugdate-postingid-companionsrcformsdebugts)).
A record holds every request to the extension with the adapter's full answer, the tab's state, the timings,
and for `autofill_step` the plan per field. The report's "profile fills no rule covered" lists hint
candidates (an automation id or label to add to `PROFILE_HINTS`), and "automatic fills changed afterwards"
lists rules to check. Built so far: the companion's part only. The adapter trace, the page hooks and saved
markup are planned (`todo.md`, item 4), so a failure inside a filler still shows only its result. Turn it off
(`ezapply debug off`) and `ezapply debug clean` when done: the records hold the user's data.

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
  whether it's additive or needs a `PROTOCOL_VERSION` bump. A changed adapter needs no version bump of its
  own: the build stamps `ADAPTER_VERSION` with a hash of the bundle.
- **Change a stored format:** bump its `schemaVersion`, add a migration run by `ezapply init`, update
  [data-formats.md](data-formats.md).
- **Change a skill or `EZAPPLY.md`:** edit `packages/cli/templates/`; users get it with `ezapply init`.
  A new skill is named `ezapply-<name>` (folder and `name:`), never a bare word, so it can't shadow a
  Claude Code command or be overridden by a user's skill. Renaming one means adding the old name to
  `LEGACY_SKILLS` in `workspace-init.ts` so `init` removes the old copy.
  `EZAPPLY.md` is in every session's context: keep it near 100 lines, add only rules that apply to every
  task, and put procedures in skills. Rules that must hold even without it (Explore/Plan subagents) also go
  in the MCP server instructions (`mcp/server.ts`).
- **Add a job site:** a new adapter folder beside `workday/` and `oracle/` exposing the same API (reuse
  `adapters/common/`), its site id in `SiteId` (a `PROTOCOL_VERSION` bump: older peers reject the new value)
  and `FORM_SITES`, detection and tenant in `protocol/src/`, the bundle in `build.mjs`, routing in
  `extension/src/background/forms.ts` (`ADAPTERS`), host permissions (fixed hosts in the manifest, or a
  per-origin grant as for Oracle), a live snapshot and a behavioural fixture, and a component page here.
