# Development

## Repo layout

```
ezapply/
  CLAUDE.md                 rules for working on this repo (keep references/ current)
  references/               this reference (source of truth)
  plan.md                   the original design plan (history; references/ wins where they differ)
  README.md                 quick start
  package.json              npm workspaces, scripts
  tsconfig.base.json, tsconfig.tests.json, biome.json, vitest.config.ts, .gitattributes
  .github/workflows/ci.yml
  scripts/workday-recon.mjs live Workday check (Playwright, headless)
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
  `dist`, `dist-firefox`, the live Workday HTML snapshots (third-party markup), `plan.md`, `project.txt`.
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
| `npm run recon:workday -- <careers-url> [outDir]` | headless walk of a public Workday tenant up to sign-in, printing what the adapter sees and saving each page's HTML (needs `npm run build` and Playwright's Chromium) |

## Tests

| File | Covers |
|---|---|
| `protocol/test/rpc.test.ts` | RPC round trips, validation, errors, timeouts |
| `companion/test/e2e.test.ts` | A real daemon on a free port: HTTP guards, control routes, bridge handshake, pinning, Firefox origins, pairing window, `extension_pair`/`replace`, capture → MCP, form tools against a fake extension |
| `companion/test/extract.test.ts` | Posting extraction and metadata |
| `companion/test/documents.test.ts` | Page-range parsing; PDF merge (ranges, bookmarks, metadata, normalizing), render with preview, text, images → PDF, compression, encrypted or broken input, path guards; `% !TEX program` parsing (both spellings, 20-line window, unknown values), pdfTeX-only detection, engine resolution order and no-fallback errors (engines mocked); TeX compile, page limit, snapshots, errors with lines, no shell escape, the default cover template building under auto, and a pdfTeX-only resume building with pdflatex over `tex.engine: xelatex` (real-TeX parts skipped without an engine or without pdflatex) |
| `companion/test/texlog.test.ts` | TeX log parsing |
| `companion/test/profile.test.ts` | Answer seed, profile and answers validation, template import (incl. adding `% !TEX program = pdflatex` to a pdfTeX-only main file and keeping an existing comment), cover default and examples |
| `companion/test/github.test.ts` | Against a mock GitHub: app manifest → install → OAuth login, paginated repo listing, callbacks without an issued state rejected, token refresh |
| `companion/test/repos.test.ts` | With real git: read-only clone, first sync = index everything, changes since the last index, contributions, claims check, malformed repo names |
| `companion/test/version.test.ts` | `COMPANION_VERSION` equals the package version |
| `cli/test/workspace-init.test.ts` | `.mcp.json` stdio entry without a token, `EZAPPLY.md` command paths and sections, the `CLAUDE.md` import and `agentFileStatus`, default cover template install and no-overwrite |
| `cli/test/mcp-relay.test.ts` | The relay starts the daemon on first use, relays requests and notifications, reports an unreachable daemon |
| `extension/test/workday.test.ts` | Adapter extraction, every filler, next/refusals, submit guard, against a behavioural fixture (jsdom) |
| `extension/test/workday-live.test.ts` | Page detection on live snapshots (posting, start-choice, sign-in) |
| `extension/test/manifest.test.ts` | The built Firefox manifest: CSP without `upgrade-insecure-requests` and loopback-only `connect-src`, event-page background, gecko id |

Tests that need TeX are skipped when no engine is installed; everything else runs without external tools
(git is required for `repos.test.ts`).

## CI
GitHub Actions (`.github/workflows/ci.yml`) on every push and pull request, on `ubuntu-latest` and
`windows-latest`, Node 24: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`.

## Conventions
- **Keep `references/` current** in the same change (see `CLAUDE.md`).
- **Thin tools, fat services.** An MCP tool validates, calls a service, returns JSON. Logic lives in
  services, which are wired explicitly in `main.ts`.
- **Errors carry a fix.** Throw `EzError(code, message, hint)`; the hint says what Claude should do (call a
  tool, ask the user, install something with the exact command). Never let a raw exception reach a tool
  result.
- **Validate at every boundary** with zod: tool inputs, bridge params and results, files read from disk.
- **Paths from Claude** go through `Workspace.resolveAllowed` with the narrowest folder list.
- **Write atomically** (`writeJsonAtomic`, `writeFileAtomic`, `writeAtomic`).
- **External programs** through `run()` (no shell, timeouts, tree kill) and `which()`.
- **Workday strings** only in `adapters/workday/selectors.ts`.
- **No personal assumptions in code**: everything user-specific lives in the profile and config.

## How to…
- **Add an MCP tool:** service method → register in the right `mcp/tools/*.ts` with a precise description
  (Claude reads it) → test in `e2e.test.ts` or the service's test → add it to skills that should use it,
  and to [mcp-tools.md](mcp-tools.md). Don't list it in `EZAPPLY.md`: the MCP server already gives Claude
  the tool list.
- **Add a bridge method:** schema in `protocol/src/forms.ts` (or `bridge.ts`) → add to `ExtensionApi` /
  `CompanionApi` → implement the handler on the serving side (type errors until you do) → decide whether
  it's additive or needs a `PROTOCOL_VERSION` bump.
- **Change a stored format:** bump its `schemaVersion`, add a migration run by `ezapply init`, update
  [data-formats.md](data-formats.md).
- **Change a skill or `EZAPPLY.md`:** edit `packages/cli/templates/`; users get it with `ezapply init`.
  `EZAPPLY.md` is in every session's context: keep it near 100 lines, add only rules that apply to every
  task, and put procedures in skills. Rules that must hold even without it (Explore/Plan subagents) also go
  in the MCP server instructions (`mcp/server.ts`).
- **Add a job site:** a new adapter folder beside `workday/` exposing the same API, site detection in
  `protocol/src/browser.ts`, routing in `extension/src/background/forms.ts`, host permissions in the
  manifest.
