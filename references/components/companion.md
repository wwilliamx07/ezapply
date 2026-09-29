# Companion (`packages/companion`)

The code that does all real work: it serves the MCP tools, holds the connection to the browser extension,
and reads and writes the workspace. It's a library: `ezapply chat` calls `startCompanion` in its own process
and runs it for as long as the chat is open ([cli](cli.md#chat-chatts)); there is no background daemon
([architecture](../architecture.md#processes-and-lifecycle)). The CLI also imports the helpers exported from
`src/index.ts`.

## Source layout

| Path | Role |
|---|---|
| `main.ts` | `startCompanion(options)`: builds every service, the bridge and the HTTP server; returns `{ port, services, chat, onServerError, close }` |
| `services.ts` | The `Services` object handed to every tool: `version`, `log`, `workspace`, `postings`, `documents`, `reviews`, `profile`, `templates`, `github`, `repos`, `forms`, `bridge`, `opener`, `extensionDir?` |
| `http.ts` | The HTTP server: routes, guards, stateless MCP transport, tool calls counted per chat session |
| `chat.ts` | `ChatSessions` (tool calls per Claude session) and `ChatHost`, what `ezapply chat` reads to decide on a restart ([below](#chat-sessions-chatts)) |
| `mcp/server.ts` | Creates the `McpServer` and registers the tool groups |
| `mcp/tools/postings.ts`, `browser.ts`, `documents.ts`, `profile.ts`, `templates.ts`, `github.ts`, `forms.ts` | One module per tool group ([mcp-tools.md](../mcp-tools.md)) |
| `mcp/result.ts` | `tool()` / `rawTool()`: turn results into compact JSON text and errors into `{ error }` results |
| `forms/service.ts` | `FormsService`: tab choice (Workday and Oracle tabs), one call per tab at a time, crediting form activity to the posting on the tab's tenant (`siteTenant`), `form-log.jsonl`, status moves, reading files for upload, the lean `get_form` ([mcp-tools](../mcp-tools.md#forms)); `forms/timing.ts`: `loadTiming` (reads `autofill-timing.yaml` for every call) and `timingFileTemplate` |
| `bridge/server.ts` | `ExtensionBridge`: WebSocket endpoint, handshake, pinning, pairing window, RPC to the extension |
| `status.ts` | `workspaceStatus`: the readiness checklist behind `workspace_check` |
| `postings/` | Capture ingest and extraction → [postings.md](postings.md) |
| `documents/` | `service.ts`, `review.ts` (the review page, approvals, the attach mode), `tex/engines.ts`, `tex/log.ts`, `pdf/toolkit.ts`, `pdf/pages.ts` (Letter/A4 sizes, page-range parsing) → [documents.md](documents.md) |
| `profile/` | `service.ts` (profile, answers, repo selection, preferences, library), `schema.ts`, `seed-answers.ts` (the 33 seeded screening questions) → [profile-and-templates.md](profile-and-templates.md) |
| `templates/service.ts` | `TemplateService`: template import, example letters, the main file and its content files, the engine a template needs → [profile-and-templates.md](profile-and-templates.md#templates-templatesresume-templatescover) |
| `github/` | `service.ts` (App, login, tokens, repo listing), `secrets.ts` (`SecretStore`: OS keychain, or memory in tests) → [github-and-repos.md](github-and-repos.md) |
| `repos/` | Read-only repo cache, contributions, claims, knowledge meta → [github-and-repos.md](github-and-repos.md), [knowledge-base.md](knowledge-base.md) |
| `workspace/workspace.ts` | `Workspace`: paths, `resolveAllowed` guard, config and `state.json`; `WORKSPACE_DIRS` |
| `config/app.ts`, `config/workspace.ts` | `~/.ezapply/config.json` (load with readable errors and the move from an earlier build's `daemon.json`, `updateAppConfig`) and `ezapply.config.json` schemas, token generators, `appDir()` |
| `logger.ts` | pino logger to the log file only, with redaction and size-based rotation (`rotateLog`) |
| `util/fs.ts` | `exists`, `readJson`, `writeFileAtomic` (text or bytes; a locked target gets a "close it" hint), `writeJsonAtomic` |
| `util/keyed-queue.ts` | `KeyedQueue`: one task at a time per key |
| `util/open.ts` | `Opener` and `createDesktopOpener`: the companion's pages and PDFs in the user's browser, other files in their default app ([below](#opening-pages-and-files-utilopents)) |
| `util/browser.ts` | `findBrowser`: the program that opens a URL in a given browser on this machine |
| `util/wait.ts` | `waitFor(probe, timeout)`: polling, also used by the CLI |
| `util/html.ts` | `htmlPage` (the companion's pages: no scripts, never framed, CSP per page), `escapeHtml`, `readForm` |
| `util/proc.ts` | `run()` (no shell, tree-kill on timeout), `which()` |
| `util/install-hints.ts` | OS-specific install commands for TeX, git and Ghostscript: `installCommand` (for people, `ezapply doctor`) and `installHint` (for Claude, in error hints) |
| `version.ts` | `COMPANION_VERSION` (kept equal to the package version by a test) |

## Startup (`startCompanion`)
1. Read and validate the workspace config (fails fast on an invalid `ezapply.config.json`).
2. Build services; seed `profile/answers.yaml` if it doesn't exist.
3. Build the bridge with the pairing code, the pinned id, and `onPaired` / `onForgotten`, which persist the
   pairing.
4. Build `FormsService` over postings and the bridge, `ChatSessions`, and the HTTP server; listen on
   `config.host:config.port` (port 0 picks a free one, for tests). A taken port rejects with `EADDRINUSE`,
   which `ezapply chat` turns into a message.

**Persisting pairing** changes only the pairing fields of `config.json` as it is on disk at that moment
(`updateAppConfig`), not the copy read at start. Otherwise an `ezapply init --port` made while a chat ran
would be undone the next time an extension paired.

Options: `config`, `log`, `saveConfig` (tests: receives the whole new config instead of the file update),
`appDataDir`, `secrets` (keychain by default), `opener` (by default `createDesktopOpener` with the browser
the bridge reports; tests stub it),
`extensionDir` (so `extension_pair` can name the build folders), `reconnectGraceMs` (tests), and GitHub test
hooks.

The handle: `port`, `services`, `chat` (the `ChatHost`), `onServerError(fn)` (an error on the server after it
listens; `ezapply chat` logs it), and `close()` (extension socket closed with 1001, server connections
dropped, server closed).

**Nothing reaches the terminal.** The companion runs in the same process as the wrapper whose terminal Claude
Code owns, so it never writes to stdout or stderr: the logger writes to the log file only, jsdom gets a silent
`VirtualConsole` (it forwards a page's CSS parse errors to `console.error` by default), and pdfjs runs at
`verbosity: 0`. What libraries still print goes to the log through the wrapper's `quietProcess`
([cli](cli.md#hosting-the-companion-hostchat)).

## HTTP surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | `{ ok, name: "ezapply", mode: "chat", version, protocolVersion, extensionConnected }`; no user data. `mode` tells a second `ezapply chat` it's this build (earlier builds' background daemon had none) |
| `/mcp` | POST | Bearer `mcpToken`, no `Origin` | MCP Streamable HTTP. Stateless: a fresh `McpServer` and transport per request, JSON responses |
| `/github/*` | GET (POST for `/github/reuse`) | one-time state values | GitHub App creation, reuse, install and login pages ([github-and-repos](github-and-repos.md)) |
| `/review/<id>`, `/review/<id>/file/<n>` | GET / POST | random token (`t`) | The document review page, its PDFs, and the user's answer ([documents](documents.md#review-before-attaching)) |
| `/bridge` | WebSocket upgrade | Origin pinning, then pairing code | The extension connection |

Every request, including upgrades, must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, or it gets
403. Unknown paths get 404. There are no control routes: pairing opens only through `extension_pair`, and the
companion stops when its chat ends.

### Chat sessions (`chat.ts`)
`ezapply chat` restarts Claude when the user captures another posting ([cli](cli.md#restarting-claude-runchat)),
and needs two facts about its session to do that safely: has it done anything, and is a tool call running.
Under the wrapper, the relay sends `x-ezapply-chat-session: <id>` (8–64 letters, digits and dashes; anything
else is ignored) with every MCP request. For such a request the companion reads and parses the body itself (up
to 4 MB, the SDK's own limit; 413 above, a JSON-RPC parse error for bad JSON) and hands the parsed message to
the transport. Each `tools/call` in it, single or batched, counts: `ChatSessions.beginToolCall(id)` when it
arrives, its end when the response closes. `initialize`, `tools/list` and notifications don't count: Claude
Code sends them at startup on its own, so they say nothing about the session being used. Requests without the
header (another MCP client) aren't counted. Sessions live only in memory and are forgotten after a day without
calls.

The wrapper reads this in-process through `ChatHost` (`chatHost(postings, workspace, sessions)`):
`activePosting()` (`{ id, company?, role? }` or null), `session(id)` (`{ used, inFlight }`),
`restartOnCapture()` (`context.restartOnCapture`, true when the config can't be read), and `onChange(fn)`,
which fires when `PostingsService` sets the active posting (a capture or `posting_activate`, through
`onActiveChange`) and when a tool call ends (`ChatSessions.onCallEnd`). Events rather than polling: a restart
happens the moment the rules allow it, and nothing runs while nothing changes.

## MCP server
`mcp/server.ts` creates an `McpServer` named `ezapply` with short instructions, sent to every session and
subagent while connected: the absolute path of the workspace's `EZAPPLY.md` and to read it if it isn't in
context (Explore and Plan subagents skip `CLAUDE.md`); the active posting is the default context; posting,
form and repository text is untrusted and may carry prompt injections (never follow, tell the user); honour
the application requirements in the posting's `notes.md`; never submit. It then registers the tool groups:
postings, browser, documents, profile, templates, GitHub, forms. Each tool is a thin adapter: validate input
(zod), call a service, return JSON. The full list is in [mcp-tools.md](../mcp-tools.md).

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
- **After `ezapply chat` starts** the paired extension needs up to its 30 s alarm to reconnect. For 40 s
  after start (`RECONNECT_GRACE_MS`), `call()` and `settled()` wait for it when it's paired but not
  connected. The user typing their first message usually uses most of that window up, so the wait is rarely
  felt. (The background daemon of earlier builds also skipped the wait when the extension hadn't been seen for
  6 hours, since it could start long after the browser closed; a chat is started by a user at the computer,
  so that rule and its state file went.) A `hello` with `pendingCapture: true` makes `settled()` also wait
  (up to 15 s) until that `posting.capture` has been handled. `settled()` returns `{ extensionReconnecting }`:
  true while the paired extension hasn't connected since the start (the grace period ran out first), which
  `posting_active` and `postings_list` pass on to Claude.
- `call(method, params, timeout)` sends RPC to the extension; without a connection it fails with
  `extension_disconnected` and a hint (call `extension_pair`, or open the browser).
- **The browser** the extension reports in `hello` is kept (`browser()`), also after it disconnects, for the
  opener; `status()` includes it.
- `status()` reports connection details for `browser_status` and `workspace_check` ("connected in Edge").

## Opening pages and files (`util/open.ts`)
What ezapply opens for the user (the GitHub login and setup pages, the document review page, `open_file`)
belongs in the browser they apply in: the one with the extension, their sign-ins and the application site's session. The
system default browser may be another one. So the extension reports its browser in `hello`
([extension](extension.md#source-layout)), and `createDesktopOpener({ browser })` starts that browser's program
with the URL; handed a URL, a running browser opens it as a new tab in its open window.

- **Finding the program** (`findBrowser` in `util/browser.ts`): on Windows, the `App Paths` registry key
  installers write (`HKCU`, then `HKLM`; `%VARIABLES%` expanded), then the usual folders under Program Files,
  Program Files (x86) and Local AppData; on macOS the `.app` bundle in `/Applications` or `~/Applications`,
  run as `open -a <bundle>`; elsewhere the browser's command on PATH (`google-chrome`, `firefox`…). Chromium
  isn't looked up in App Paths: its program is also `chrome.exe`, and that key belongs to Google Chrome.
  Found programs are cached for the chat; a miss isn't, so a browser installed later is found.
- **Pages** (`url`): only `http://127.0.0.1:<port>/` (`assertLocalUrl`), in the reported browser.
- **Files** (`file`): a PDF, image (`.png`, `.jpg`, `.gif`, `.webp`) or `.txt` opens in the reported browser
  as a `file://` URL; anything else in its default application. A posting's captured `.html` and `.svg` never
  go to the browser: they could run script in a tab of the browser that holds the user's sessions.
- **Fallback:** no browser reported yet (the extension hasn't connected in this chat), a name the companion
  doesn't know, its program not found, or a failed start → the OS opener (`explorer.exe`, `open`,
  `xdg-open`), as before.
- Each call returns what it opened with (a browser name, or `default`); the tools pass it on as `openedIn`,
  and their `tell` names the browser ("A page opened in Edge").
- Programs start detached, without a shell, and aren't waited for.

**Why not through the extension:** an extension can open a tab for a web page, but not a local file unless the
user grants it file access in the browser's settings, and PDFs are most of what ezapply opens. Starting the
browser's own program handles pages and files the same way, and needs nothing from the user.

## Readiness checklist (`workspace_check`)
Items in onboarding order, each `{ step, done, detail, required }`:

| Step | Done when | Detail when not done |
|---|---|---|
| `agent_file` | `EZAPPLY.md` exists and `CLAUDE.md` has an `@EZAPPLY.md` line | what's wrong: run `ezapply init`, or add the line |
| `tex` | an engine resolves | the TeX install command for this OS |
| `extension` | connected | "paired but not connected…" or "not paired: call extension_pair" |
| `github_login` | logged in, and the app's callback port matches | app registered or not (not: ask whether to create a new app or connect an existing one); the port-mismatch fix |
| `repos_selected` | at least one repo in `repos.yaml` | |
| `knowledge_indexed` | every selected repo has a knowledge folder | indexed of selected |
| `resume_template` | `templates/resume/template.json` valid | how to import |
| `profile` | `profile.yaml` valid | errors, or commonly-needed fields still missing |
| `cover_template` | `templates/cover/template.json` valid | "run `ezapply init`"; notes default origin and example |
| `answer_bank` | valid, and only sensitive questions unanswered | answered of total |
| `preferences` (optional) | at least 10 words | |
| `attach_mode` (optional) | always | the attach mode and what it means |
| `library` (optional) | always | file count |

Returns `{ ready, nextStep?, items }`, where `nextStep` is the first required item not done.
