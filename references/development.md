# Development

## Repo layout

```
ezapply/
  CLAUDE.md                 rules for working on this repo (keep references/ current)
  references/               this reference (source of truth)
  README.md                 quick start
  todo.md                   review findings and proposals, ranked (a work list; references/ describes what's built)
  package.json              npm workspaces, scripts
  tsconfig.base.json, tsconfig.tests.json, biome.json, vitest.config.ts, .gitattributes
  .github/workflows/ci.yml
  scripts/workday-recon.mjs live Workday check (Playwright, headless)
  scripts/usage-report.mjs  token usage of a Claude Code session in the workspace
  packages/
    protocol/               shared schemas            → components/protocol.md
    companion/              the daemon                → components/companion.md
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
  `dist`, `dist-firefox`, the live Workday HTML snapshots (third-party markup), `project.txt`.
- **Line endings:** `.gitattributes` pins LF everywhere (Biome rejects CRLF). On Windows, after a fresh
  clone with the old settings, renormalize with `git rm --cached -r . && git reset --hard` (on a clean tree).
- **Vitest** runs every `packages/*/test/**/*.test.ts` (20 s default timeout).

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | `npm install`, build, `ezapply init` |
| `npm run build` | tsc build of protocol, companion, cli; then the extension bundles |
| `npm test` | build, then vitest |
| `npm run typecheck` | all packages and `tsconfig.tests.json` (tests) |
| `npm run lint` / `npm run format` | Biome check / write |
| `npm run ezapply -- <cmd>` | run the CLI |
| `npm run usage:report [-- <transcript.jsonl>]` | token usage of a workspace session (default: the most recent, found from `daemon.json`'s workspace under `~/.claude/projects/`): turns, tokens re-sent and written, average and peak context, then per user prompt (turns, tokens, context at start → end), per tool (calls, result size, images), and per subagent (from its `.meta.json` description). Every turn re-sends the conversation, so cost ≈ turns × context; use it before and after a change meant to cut usage. Synthetic zero-usage entries and harness notifications aren't counted |
| `npm run recon:workday -- <careers-url> [outDir]` | headless walk of a public Workday tenant up to sign-in, printing what the adapter sees and saving each page's HTML (needs `npm run build` and Playwright's Chromium) |

## Tests

| File | Covers |
|---|---|
| `protocol/test/rpc.test.ts` | RPC round trips, validation, errors, timeouts |
| `protocol/test/workday.test.ts` | Which hosts count as Workday (not the marketing site or employee tenants), tenants from myworkdayjobs hosts and myworkdaysite paths |
| `companion/test/e2e.test.ts` | A real daemon on a free port: HTTP guards, control routes, bridge handshake, pinning, Firefox origins, pairing window, `extension_pair`/`replace`, idle shutdown (pings don't count, close code 4005, requests and pairing windows hold it off), `posting_active` waiting for a queued capture after a start and not waiting for an extension unseen for days, the last-seen time recorded, pairing written into `daemon.json` without undoing edits made meanwhile, `github_login` with a stub opener (opened, and not; `app: "existing"` returning the callback URL), capture → MCP, invalid posting ids, the review page (token, PDFs served, answers, waiting, a replaced or answered review) and the approval gate on `upload_file` (refused before approval, allowed after, refused again for a rebuilt file, never for `library/`), `attach_mode_set` keeping the rest of the config, and the form tools driving the **real Workday adapter on the shared jsdom fixture** behind a fake extension: `list_options` for several fields (one unknown), lean fill results (a clean success bare, a matched option's full text kept), fill, clear an old attachment, upload, add and remove a row, next and refusal, back from review and forward again, the log and status; lean `get_form` with its filters; tab choice by the active posting's tenant and `postingMismatch` with nothing logged |
| `companion/test/extract.test.ts` | Posting extraction and metadata; company from ATS, LinkedIn and Indeed URLs; Workday locale dropped from canonical URLs; myworkdaysite tenants and embedded frames |
| `companion/test/documents.test.ts` | Page-range parsing; PDF merge (ranges, bookmarks, metadata, normalizing, and a resized page keeping its link with its rectangle moved), render with preview, text, images → PDF, compression, encrypted or broken input, `open_file` through the opener, path guards; `% !TEX program` parsing (both spellings, 20-line window, unknown values), pdfTeX-only detection, engine resolution order and no-fallback errors (engines mocked); TeX compile, page limit, snapshots, errors with lines, no shell escape, the default cover template building under auto, and a pdfTeX-only resume building with pdflatex over `tex.engine: xelatex` (real-TeX parts skipped without an engine or without pdflatex, unless `EZAPPLY_REQUIRE_TEX=1`) |
| `companion/test/texlog.test.ts` | TeX log parsing |
| `companion/test/profile.test.ts` | Answer seed, profile and answers validation |
| `companion/test/templates.test.ts` | Template import (incl. content files, adding `% !TEX program = pdflatex` to a pdfTeX-only main file and keeping an existing comment), cover default and examples, finding content files through `\input`/`\include`/`\subfile`, `template_set_main` recording them and refusing paths outside the template |
| `companion/test/github.test.ts` | Against a mock GitHub with single-use refresh tokens: app manifest → install → OAuth login, connecting an existing app through the daemon's form (state required, nothing stored before login, app identified from its installations), wrong credentials leaving the current app intact, reading an app name from a pasted address, paginated repo listing, callbacks without an issued state rejected, token refresh, one refresh for parallel callers, an unreadable stored token, the port mismatch |
| `companion/test/repos.test.ts` | With real git: read-only clone, first sync = index everything, changes since the last index, contributions, claims check, evidence hashes stamped (comments kept) and a changed line range flagged, concurrent syncs, the token in git's environment and never its arguments (`run` spied), malformed repo names |
| `companion/test/util.test.ts` | `KeyedQueue` order and independence, log rotation, which URLs the opener accepts, `updateDaemonConfig` |
| `companion/test/version.test.ts` | `COMPANION_VERSION` equals the package version |
| `cli/test/workspace-init.test.ts` | `.mcp.json` stdio entry without a token, `EZAPPLY.md` command paths and sections, skills installed under `ezapply-` names with matching `name:`, old bare-named ezapply skills removed while a user's own is kept, the `CLAUDE.md` import and `agentFileStatus`, default cover template install and no-overwrite, the launcher (POSIX and Windows forms) |
| `cli/test/mcp-relay.test.ts` | The relay starts the daemon on first use, relays requests and notifications, reports an unreachable daemon, never re-sends a request the daemon received when the connection breaks, and waits out a slow response; with a real daemon, the chat session header: `/control/chat` counts only tool calls, per session |
| `cli/test/chat.test.ts` | `ezapply chat` with a stub `claude` (`claude-stub.mjs`) and a controlled daemon state: restart with a fresh session and no arguments once another posting is active, only after a running call ends; no restart for an untouched session, the same posting, or `restartOnCapture: false`; `findClaude` on Windows and elsewhere, and `EZAPPLY_CLAUDE` |
| `companion/test/chat.test.ts` | `ChatSessions` counts (used, in flight, ending twice counts once), `tools/call` counting in batches, accepted session ids |
| `cli/test/cli.test.ts` | The built CLI: a bad `--port` and a damaged `daemon.json` give one line and what to do, no stack |
| `extension/test/workday.test.ts` | Adapter extraction, every filler, two dropdowns in a row each reading its own options (the previous listbox lingering, no `aria-controls`; fails on the old logic), a date entered again while the field shows an error and once otherwise, removing pills (charm and keyboard) and attachments (with a confirmation dialog), removable rows and removing one (with a confirmation dialog, later rows renumbered), going back from review with entries kept (and refusing on the first step), uploads not fooled by a same-named leftover file, next/refusals, submit guard, against the behavioural fixture (jsdom) |
| `extension/test/workday-live.test.ts` | Page detection on live snapshots (posting, start-choice, sign-in) |
| `extension/test/manifest.test.ts` | The built Firefox manifest: CSP without `upgrade-insecure-requests` and loopback-only `connect-src`, event-page background, gecko id; both builds' host permissions equal the protocol's Workday hosts |
| `extension/test/background.test.ts` | The background loaded with a stubbed WebExtensions API: the reconnect alarm exists without any install event, and an existing one is left alone |
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
  adapter's own `waitFor` in `dom.ts` is different on purpose: it runs in the page and polls a synchronous
  DOM condition.
- **External programs** through `run()` (no shell, timeouts, tree kill) and `which()`; programs that should
  outlive the call (a viewer, a browser) through the `Opener`.
- **Workday strings** only in `adapters/workday/selectors.ts`, plus `protocol/src/workday.ts` for what the
  companion needs too (hosts, tenant parsing, the posting-page hooks). Both sides import those from there
  instead of repeating them.
- **No personal assumptions in code**: everything user-specific lives in the profile and config.

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
- **Add a job site:** a new adapter folder beside `workday/` exposing the same API, site detection in
  `protocol/src/browser.ts`, routing in `extension/src/background/forms.ts`, host permissions in the
  manifest.
