# Architecture

## The parts

The drawing shows `ezapply chat`, with Claude Code in the terminal. Under `ezapply` (how the user works, in the
browser's side panel) the same companion starts Claude Code itself, headless, one process per conversation, with
the same relay to the same tools; the extension's side panel talks to the companion over the extension's bridge
([agent](components/agent.md)).

```
 ezapply chat = one Node process: the companion runs inside it, and Claude Code is its child
 ┌───────────────────────────┐  stdio (MCP)   ┌──────────────┐  HTTP, 127.0.0.1   ┌───────────────────────────────┐
 │ Claude Code               │ ─────────────▶ │ ezapply mcp  │ ─────────────────▶ │ companion (in ezapply chat)   │
 │ child of ezapply chat,    │ ◀───────────── │ (relay; CLI) │ ◀───────────────── │  • MCP server (stateless)     │
 │ runs in ~/ezapply-home,   │                └──────────────┘                    │  • extension bridge (WS)  ────┼──┐
 │ reads EZAPPLY.md + skills │                                                    │  • postings, documents,       │  │
 └────────────┬──────────────┘                                                    │    profile, GitHub, repos     │  │
              │ Read / Write / Edit / Bash                                        │  • /github, /review, /onboard │  │
              ▼                                                                   └──────────────┬────────────────┘  │
 ┌───────────────────────────┐        files (workspace-restricted)                               │                   │
 │ workspace ~/ezapply-home  │ ◀─────────────────────────────────────────────────────────────────┘                   │
 └───────────────────────────┘                                                     HTTPS: GitHub API, git clone       │
                                                                                                            WebSocket │
                                           ┌────────────────────────────────────────────────────────────────────────┐ │
                                           │ browser extension (Chrome MV3 / Firefox 128+ MV3)                      │◀┘
                                           │  • toolbar button: Set posting (capture any page)                      │
                                           │  • background: bridge client, pairing, routing, badge                 │
                                           │  • site adapters (one per site), injected into the MAIN world          │
                                           └────────────────────────────────────────────────────────────────────────┘
```

| Part | Package | Runs as | Role |
|---|---|---|---|
| Protocol | `packages/protocol` | library | zod schemas and types shared by everything: bridge messages, RPC, forms, postings, errors |
| Companion | `packages/companion` | library, run inside `ezapply` or `ezapply chat` | Serves the MCP tools, talks to the extension, owns all file and network work; under `ezapply`, runs Claude Code headless for the side panel ([agent](components/agent.md)) |
| CLI | `packages/cli` | `ezapply` command | Creates the workspace (`init`), hosts the companion for the side panel (`ezapply`) or with Claude Code in the terminal (`chat`), relays MCP for Claude Code (`mcp`) |
| UI | `packages/ui` | static files the companion serves; components the extension bundles | The browser pages: document review and onboarding (React, pdf.js), the side panel's components, and the stylesheet of the companion's own pages ([ui](components/ui.md)) |
| Extension | `packages/extension` | browser extension | The side panel (opened by the toolbar button), where the user works; captures postings; reads and fills the registry sites' forms (Workday, Oracle Recruiting Cloud, Greenhouse, Lever, Ashby, Phenom, Dayforce, SAP SuccessFactors) on the companion's behalf |
| Workspace | created by `ezapply init` | folder of files | The user's data, the agent file `EZAPPLY.md`, skills, and Claude Code config |

## Processes and lifecycle

There is no background process. ezapply runs while the user has `ezapply` (or `ezapply chat`) running in a
terminal, and not otherwise.

- **`ezapply`** is how the user runs ezapply (the workspace's `ezapply` launcher, with no command): the companion
  in its own process, with no Claude in the terminal, which only says where to go and stops on Ctrl+C
  ([cli](components/cli.md#ezapply-panelts)). It opens the setup page while setup isn't finished. The user works in
  the extension's side panel; the companion starts Claude Code headless when a conversation needs it, one process
  at a time, and ends it when the companion stops ([agent](components/agent.md)). No conversation carries one
  posting into the next: each posting has its own.
- **`ezapply chat`** runs ezapply with Claude Code in the terminal instead. It starts the
  companion in its own process, listening on `127.0.0.1:<port>` (default 17373), then starts Claude Code in
  the workspace as a child with a session id in its environment. When Claude exits it closes the companion
  and exits too. If the companion can't start (the port is taken), Claude isn't started, since it would have
  no tools. When the user captures a **different** posting, and the session has used a tool and has none
  running, it ends that Claude and starts a fresh one, so a finished application's conversation stops being
  re-sent with every turn (see [components/cli.md](components/cli.md#chat-chatts)). The companion reports
  the change and the end of every tool call as events, so the restart happens as soon as the rules allow.
  Nothing is handed over: the new session's relay attaches to the same companion, the extension stays
  connected, and what carries over is on disk.
- **Claude Code** runs in the workspace, started by `ezapply chat`, and owns the terminal. Its `.mcp.json`
  runs `ezapply mcp` (via the absolute path of the built CLI and Node) as a stdio MCP server.
- **`ezapply mcp`** is a relay (see [components/cli.md](components/cli.md#the-mcp-relay-mcp-relayts)). It
  forwards each JSON-RPC line to the companion over HTTP, concurrently, and writes each answer back, with
  no timeout of its own (some tools wait up to 15 minutes). It never starts anything: when nothing listens
  on the port, every request answers "ezapply isn't running: start it with `ezapply chat`", and a
  connection that breaks after the request went out is reported, never retried, because the tool may
  already have run. It exists because Claude Code talks to MCP servers over stdio; its own HTTP transport
  would bring timeouts of its own.
- **The companion** is one HTTP server (MCP, GitHub pages, the review and onboarding pages and the UI package's
  files) plus the WebSocket bridge,
  inside the `ezapply chat` process. Nothing in it may write to the terminal, which is Claude's: it logs to
  a file only, and the wrapper sends `console.*` and stderr to the log too (libraries such as pdfjs print).
  An uncaught error in companion code is logged and the process carries on, so a bug doesn't take Claude's
  tools away mid-session. After `ezapply chat` starts, tools that need the extension wait up to 40 s from
  the start for it to reconnect (its 30 s alarm), and `posting_active`/`postings_list` also wait for a
  capture it queued while ezapply wasn't running, so the active posting is never stale. The user typing
  their first message usually uses up most of that window; if it runs out, the posting tools say the
  extension may still reconnect.
- **The extension background** is a service worker in Chrome and an event page in Firefox. It connects
  to the companion, sends a ping every 20 s, and a 30 s alarm reconnects it whenever it's down. The alarm is
  created (if missing) every time the background starts, not only at install: Firefox doesn't keep alarms
  across browser sessions and Chrome may clear them on restart, and the browser usually starts before any
  `ezapply chat`. Firefox unloads an idle event page after 30 s regardless of socket traffic, so there each
  ping also writes `storage.session`, whose change event resets the idle timer. While no chat is open the
  toolbar still captures postings; they're queued and delivered on the next connection.
- **The site adapters** (`<site>-main.js`, one per registry site: one engine and a definition per site,
  [adapters](components/adapters.md)) are injected into the page's own JavaScript context (MAIN world) on
  each form call, the one for the tab's site, which the extension tells by what the page shows, else by its URL
  ([telling a page's site](components/extension.md#telling-a-pages-site-framests)). Injection is idempotent: a
  second injection of the same version is a no-op. The extension holds every site (`<all_urls>`) so it can read
  any page for that ([why](components/protocol.md#the-site-registry-sitests)).

**Why no daemon.** Earlier builds ran the companion as a background daemon: `ezapply mcp` started it on
demand, it stopped after 15 minutes idle, and `ezapply chat` polled it every second. Since ezapply is only
ever used through `ezapply chat`, the daemon bought nothing and cost an extra process, on-demand starts
(with a wait for the extension each time), idle bookkeeping, a state file and polling. The one thing it did
that a chat doesn't is stay up between chats, which matters to nobody: the tools only run inside Claude.

## Transports

| Link | Transport | Auth | Notes |
|---|---|---|---|
| Claude Code → relay | MCP over stdio | none (a child process) | Newline-delimited JSON-RPC |
| Relay → companion | MCP Streamable HTTP, `POST /mcp` | Bearer `mcpToken` | Stateless: a new `McpServer` per request, JSON responses (no SSE). This works because no state lives in an MCP session: it's all in services and on disk. Under `ezapply chat` each request carries `x-ezapply-chat-session` |
| CLI → companion | `GET /health` | none | `ezapply status`, `doctor`, and a second `ezapply chat` checking the port |
| Browser → companion | `GET /github/*` pages (`POST /github/reuse`) | one-time state values | GitHub App creation, reuse and login callbacks |
| Browser → companion | `GET/POST /review/*`, `/onboard/*` | random token in the link, traded for a cookie on the page's path; POSTs from the companion's own origin only | The review and onboarding pages, their state, events (Server-Sent Events), actions and PDFs ([ui](components/ui.md#how-a-page-talks-to-the-companion)) |
| Browser → companion | `GET /ui/*` | none (the same for everyone) | The UI package's scripts, styles and pdf.js's files |
| Extension ↔ companion | WebSocket `ws://127.0.0.1:<port>/bridge`, JSON text frames | Origin pinning + pairing code | Versioned handshake, then symmetric RPC ([protocol](components/protocol.md)), the side panel's `panel.*` methods and `panel.update` pushes among them |
| Side panel ↔ extension background | `runtime.connect` port | the extension's own page | The panel's requests, relayed to the companion; capture, a tab's site and opening a tab done by the background ([extension](components/extension.md#the-side-panel)) |
| Companion → Claude Code (headless) | stdin and stdout of the process it starts, stream-json | a child process | The user's messages in, what Claude does out ([agent](components/agent.md)); Claude's tool calls come back through the relay like any session's |
| Companion → GitHub | HTTPS REST API and `git` over HTTPS | user access token (per command, never stored in git config) | Read-only App permissions |

Every HTTP request must be addressed to the bound loopback host (`Host` check against DNS rebinding).
`/mcp` refuses any request that carries an `Origin` header, which browsers always send cross-site. See
[security.md](security.md).

## Where state lives

| Location | Holds | Owner |
|---|---|---|
| `~/.ezapply/config.json` (`EZAPPLY_APP_DIR` overrides the folder) | port, MCP token, pairing code, pinned extension id, workspace path | CLI `init`; the companion updates pairing |
| `~/.ezapply/github-app.json` | the user's GitHub App (public parts) | companion |
| `~/.ezapply/logs/companion.log` (+ `.1`, `.2`) | structured logs, personal data redacted, rotated at 5 MB | companion |
| OS keychain, service `ezapply` | GitHub App client secret, GitHub user token | companion |
| `~/ezapply-home/` | everything the user owns: profile, templates, knowledge, postings, library, repo cache | user, Claude, companion |
| extension `storage.local` | port, pairing code, connection state, pending capture, active posting label | extension |

Formats of every file: [data-formats.md](data-formats.md).

## Cross-cutting concerns

- **Validation.** zod schemas validate every boundary: MCP tool inputs, bridge params and results (on the
  receiving side), and every file read from disk.
- **Errors.** One `EzError` type with a `code`, a `message` and an optional `hint` telling the caller how
  to recover. MCP tools are wrapped (`tool()` / `rawTool()` in `mcp/result.ts`) so every failure reaches
  Claude as `{ error: { code, message, hint } }` with `isError: true`; unexpected ones are logged with
  their stack. Missing dependencies (TeX, git, Ghostscript) get OS-specific install commands
  (`util/install-hints.ts`). The CLI prints an `EzError` (a bad `--port`, a damaged `config.json`) as one
  line plus its hint; only unexpected errors show a stack.
- **Finding installed tools.** `which()` caches hits only, and on Windows first appends the folders where
  winget installs MiKTeX and Git, so a tool installed mid-session works without a restart.
- **Versioning.** `PROTOCOL_VERSION` (currently 8) is checked at the bridge handshake; a mismatch is
  refused with which side to update. Every stored format has a `schemaVersion`. `COMPANION_VERSION`
  matches the package version (tested).
- **Wiring.** Services are constructed once in `companion/src/main.ts` and passed explicitly (the
  `Services` object); tools never construct services and there are no module-level singletons besides
  pure caches and the stylesheet hook of the companion's own pages (`useStylesheet` in `util/html.ts`, set once by
  `main.ts`).
- **Path guards.** Every path Claude passes is resolved against the workspace and checked against the
  folders that operation may touch (`Workspace.resolveAllowed`).
- **Atomic writes.** JSON and generated files are written to a temp file and renamed (`util/fs.ts`).
- **One at a time where it matters.** Operations that would collide run through a per-key queue
  (`util/keyed-queue.ts`): captures and posting metadata updates, builds of the same `.tex` file (they share
  its `.build/` folder), syncs of the same repo (git's `index.lock`), and form calls on the same browser tab
  (Claude Code calls tools in parallel, and two calls acting on one page interfere).
- **Opening things for the user.** `Opener` (`util/open.ts`) opens one of the companion's own
  `http://127.0.0.1:<port>/` pages, or a PDF or image, in the browser the extension reported it runs in
  (the one with the user's sign-ins, which may not be the system default), by starting that browser's
  program with the URL; other files, and everything when no browser is known or its program isn't found,
  go to the OS opener. Never through a shell, never waited for; tests pass a stub
  ([companion](components/companion.md#opening-pages-and-files-utilopents)).
- **Logging.** pino to `~/.ezapply/logs/companion.log` only (the terminal is Claude's), level from
  `EZAPPLY_LOG_LEVEL`, with page content, form values and tokens redacted by field path. The file is
  rotated when it passes 5 MB, checked at start and every 10 minutes (every chat appends to it), keeping
  `companion.log.1` and `.2`.
