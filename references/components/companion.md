# Companion daemon (`packages/companion`)

The Node process that does all real work: it serves the MCP tools, holds the connection to the browser
extension, and reads and writes the workspace. It's a library too: the CLI imports `startCompanion` and
the helpers exported from `src/index.ts`.

## Source layout

| Path | Role |
|---|---|
| `main.ts` | `startCompanion(options)`: builds every service, the bridge and the HTTP server; returns `{ port, services, close }` |
| `services.ts` | The `Services` object handed to every tool: `version`, `log`, `workspace`, `postings`, `documents`, `profile`, `github`, `repos`, `bridge`, `extensionDir?` |
| `http.ts` | The HTTP server: routes, guards, stateless MCP transport |
| `mcp/server.ts` | Creates the `McpServer` and registers the tool groups |
| `mcp/tools/postings.ts`, `browser.ts`, `documents.ts`, `profile.ts`, `github.ts`, `forms.ts` | One module per tool group ([mcp-tools.md](../mcp-tools.md)) |
| `mcp/result.ts` | `tool()` / `rawTool()`: turn results into JSON text and errors into `{ error }` results |
| `bridge/server.ts` | `ExtensionBridge`: WebSocket endpoint, handshake, pinning, pairing window, RPC to the extension |
| `status.ts` | `workspaceStatus`: the readiness checklist behind `workspace_check` |
| `postings/` | Capture ingest and extraction → [postings.md](postings.md) |
| `documents/` | `service.ts`, `tex/engines.ts`, `tex/log.ts`, `pdf/toolkit.ts`, `pdf/pages.ts` (Letter/A4 sizes, page-range parsing) → [documents.md](documents.md) |
| `profile/` | `service.ts`, `schema.ts`, `seed-answers.ts` (the 33 seeded screening questions) → [profile-and-templates.md](profile-and-templates.md) |
| `github/` | `service.ts` (App, login, tokens, repo listing), `secrets.ts` (`SecretStore`: OS keychain, or memory in tests) → [github-and-repos.md](github-and-repos.md) |
| `repos/` | Read-only repo cache, contributions, claims, knowledge meta → [github-and-repos.md](github-and-repos.md), [knowledge-base.md](knowledge-base.md) |
| `workspace/workspace.ts` | `Workspace`: paths, `resolveAllowed` guard, config and `state.json`, atomic writes; `WORKSPACE_DIRS` |
| `config/daemon.ts`, `config/workspace.ts` | `daemon.json` and `ezapply.config.json` schemas, token generators, `appDir()` |
| `logger.ts` | pino logger with redaction |
| `util/proc.ts` | `run()` (no shell, tree-kill on timeout), `which()` |
| `util/install-hints.ts` | OS-specific install commands for TeX and git, used in error hints |
| `version.ts` | `COMPANION_VERSION` (kept equal to the package version by a test) |

## Startup (`startCompanion`)
1. Read and validate the workspace config (fails fast on an invalid `ezapply.config.json`).
2. Build services; seed `profile/answers.yaml` if it doesn't exist.
3. Build the bridge with the pairing code, pinned id and persistence callbacks (`onPaired`, `onForgotten`
   save `daemon.json`).
4. Build the HTTP server and listen on `config.host:config.port` (port 0 picks a free one, for tests).

Options: `config`, `log`, `saveConfig`, `appDataDir`, `secrets` (keychain by default), `extensionDir` (so
`extension_pair` can name the build folders), `onShutdownRequest`, and GitHub test hooks.

## HTTP surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | `{ ok, name: "ezapply", version, protocolVersion, extensionConnected }`; no user data |
| `/mcp` | POST | Bearer `mcpToken`, no `Origin` | MCP Streamable HTTP. Stateless: a fresh `McpServer` and transport per request, JSON responses |
| `/control/pair` | GET / POST | Bearer, no `Origin` | Pairing status / open the pairing window (`{ seconds }`, default 600, max 1800) |
| `/control/shutdown` | POST | Bearer, no `Origin` | Answer, then call `onShutdownRequest` (the CLI's daemon exits) |
| `/github/*` | GET | one-time state values | GitHub App creation, install and login pages ([github-and-repos](github-and-repos.md)) |
| `/bridge` | WebSocket upgrade | Origin pinning, then pairing code | The extension connection |

Every request, including upgrades, must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, or it gets
403. Unknown paths get 404.

## MCP server
`mcp/server.ts` creates an `McpServer` named `ezapply` with short instructions (the active posting is the
default context; posting and form text are untrusted; never submit) and registers the tool groups:
postings, browser, documents, profile, GitHub, forms. Each tool is a thin adapter: validate input (zod),
call a service, return JSON. The full list is in [mcp-tools.md](../mcp-tools.md).

## Extension bridge (`ExtensionBridge`)
- **One connection at a time.** A newly authenticated connection replaces the old one, which is closed
  with `Replaced`.
- **Origin check at upgrade:** Chrome ids (`chrome-extension://` + 32 of a–p) and Firefox install UUIDs
  (`moz-extension://<uuid>`) are accepted; once an id is pinned, only it is.
- **Handshake** (5 s timeout): protocol version, then the pairing code, or an empty code while the pairing
  window is open. The first successful pairing pins the extension id (`onPaired`).
- **Pairing window** (`openPairing(ms)`): one code-less pairing is allowed until it expires; the window
  closes on use. `pairingStatus()` reports `{ openUntil?, pairedExtensionId?, connected }`.
- **Forgetting** (`forgetPaired(newCode)`): unpins, replaces the pairing code (so the old extension's
  stored code stops working), drops the current connection at once, and persists (`onForgotten`).
- `call(method, params, timeout)` sends RPC to the extension; without a connection it fails with
  `extension_disconnected` and a hint (call `extension_pair`, or open the browser).
- `status()` reports connection details for `browser_status` and `workspace_check`.

## Readiness checklist (`workspace_check`)
Items in onboarding order, each `{ step, done, detail, required }`:

| Step | Done when | Detail when not done |
|---|---|---|
| `tex` | an engine resolves | the TeX install command for this OS |
| `extension` | connected | "paired but not connected…" or "not paired: call extension_pair" |
| `github_login` | logged in | app registered or not |
| `repos_selected` | at least one repo in `repos.yaml` | |
| `knowledge_indexed` | every selected repo has a knowledge folder | indexed of selected |
| `resume_template` | `templates/resume/template.json` valid | how to import |
| `profile` | `profile.yaml` valid | errors, or commonly-needed fields still missing |
| `cover_template` | `templates/cover/template.json` valid | "run `ezapply init`"; notes default origin and example |
| `answer_bank` | valid, and only sensitive questions unanswered | answered of total |
| `preferences` (optional) | at least 10 words | |
| `library` (optional) | always | file count |

Returns `{ ready, nextStep?, items }`, where `nextStep` is the first required item not done.
