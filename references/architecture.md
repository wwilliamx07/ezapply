# Architecture

## The parts

```
 ┌───────────────────────────┐  stdio (MCP)   ┌──────────────┐  HTTP, 127.0.0.1   ┌───────────────────────────────┐
 │ Claude Code               │ ─────────────▶ │ ezapply mcp  │ ─────────────────▶ │ companion daemon              │
 │ runs in ~/ezapply-home    │ ◀───────────── │ (relay; CLI) │ ◀───────────────── │  • MCP server (stateless)     │
 │ reads EZAPPLY.md + skills │                └──────┬───────┘   starts it if     │  • extension bridge (WS)  ────┼──┐
 └────────────┬──────────────┘                       └──────────  not running ──▶ │  • postings, documents,       │  │
              │ Read / Write / Edit / Bash                                        │    profile, GitHub, repos     │  │
              ▼                                                                   │  • /control, /github pages    │  │
 ┌───────────────────────────┐        files (workspace-restricted)                └──────────────┬────────────────┘  │
 │ workspace ~/ezapply-home  │ ◀───────────────────────────────────────────────────────────────── ┘                   │
 └───────────────────────────┘                                                     HTTPS: GitHub API, git clone       │
                                                                                                            WebSocket │
                                           ┌────────────────────────────────────────────────────────────────────────┐ │
                                           │ browser extension (Chrome MV3 / Firefox 128+ MV3)                      │◀┘
                                           │  • toolbar button: Set posting (capture any page)                      │
                                           │  • background: bridge client, pairing, routing, badge                 │
                                           │  • Workday adapter, injected into the page's MAIN world on demand      │
                                           └────────────────────────────────────────────────────────────────────────┘
```

| Part | Package | Runs as | Role |
|---|---|---|---|
| Protocol | `packages/protocol` | library | zod schemas and types shared by everything: bridge messages, RPC, forms, postings, errors |
| Companion | `packages/companion` | background Node process | Serves the MCP tools, talks to the extension, owns all file and network work |
| CLI | `packages/cli` | `ezapply` command | Creates the workspace (`init`), relays MCP for Claude Code (`mcp`), controls the daemon |
| Extension | `packages/extension` | browser extension | Captures postings; reads and fills Workday forms on the companion's behalf |
| Workspace | created by `ezapply init` | folder of files | The user's data, the agent file `EZAPPLY.md`, skills, and Claude Code config |

## Processes and lifecycle

- **`ezapply chat`** is how the user runs ezapply (the workspace's `ezapply` launcher). It starts Claude Code
  in the workspace with a session id in its environment, and polls the daemon every second. When the user
  captures a **different** posting, and the session has used a tool and has none running, it ends that
  Claude and starts a fresh one, so a finished application's conversation stops being re-sent with every
  turn (see [components/cli.md](components/cli.md#chat-chatts)). Nothing is handed over: the new session's
  relay attaches to the same daemon, and what carries over is on disk.
- **Claude Code** runs in the workspace, started by `ezapply chat`. Its `.mcp.json` runs `ezapply mcp` (via
  the absolute path of the built CLI and Node) as a stdio MCP server.
- **`ezapply mcp`** is a relay (see [components/cli.md](components/cli.md)). On start it checks the
  daemon's `/health`; if nothing answers it spawns `ezapply daemon` detached, with no window, and waits up to
  20 s for it. It then forwards each JSON-RPC line to the daemon over HTTP, concurrently, and writes each
  answer back, with no timeout of its own (some tools wait up to 15 minutes). If a request's connection is
  refused (the daemon stopped), it starts the daemon again and sends it once more; a connection that breaks
  after the request went out is reported, never retried, because the tool may already have run.
- **The companion daemon** listens on `127.0.0.1:<port>` (default 17373). One process serves HTTP (MCP,
  control routes, GitHub pages) and the WebSocket bridge. It outlives Claude Code sessions, so the
  extension stays connected between them. It stops on SIGINT/SIGTERM, `POST /control/shutdown`
  (`ezapply stop`), or **after 15 minutes without work** (`idleTimeoutMinutes` in `daemon.json`; 0 = never).
  Work is MCP, control and GitHub-page requests and extension RPC (captures, form calls); `/health` probes
  and the extension's keepalive pings don't count, so a connected browser doesn't keep it up. An open
  pairing window, a GitHub login in progress or a document review waiting for the user does, and idle time counts from when the last of these
  ends. The next Claude Code request starts it again through the relay. After a start, tools that need the
  extension wait up to 40 s for it to reconnect (its 30 s alarm), and `posting_active`/`postings_list`
  also wait for a capture it queued while the daemon was down, so the active posting is never stale. They
  only wait when the extension was connected in the last 6 hours (`~/.ezapply/daemon-state.json`):
  longer ago the browser is probably closed, and waiting would stall the first call for 40 s for nothing,
  so the posting tools answer at once and say the extension may still reconnect. There is no login item:
  Claude Code starts it when needed, and the extension queues captures until then. (A login item would need
  different code on each OS, and on Windows a console program started at login shows a window; Claude Code
  is the only consumer of the tools anyway.)
- **The extension background** is a service worker in Chrome and an event page in Firefox. It connects
  to the daemon, sends a ping every 20 s, and a 30 s alarm reconnects it whenever it's down. The alarm is
  created (if missing) every time the background starts, not only at install: Firefox doesn't keep alarms
  across browser sessions and Chrome may clear them on restart, and after a browser restart the daemon
  usually isn't up yet. Firefox unloads an idle event page after 30 s regardless of socket traffic, so there
  each ping also writes `storage.session`, whose change event resets the idle timer.
- **The Workday adapter** (`workday-main.js`) is injected into the page's own JavaScript context (MAIN
  world) on each form call. Injection is idempotent: a second injection of the same version is a no-op.

## Transports

| Link | Transport | Auth | Notes |
|---|---|---|---|
| Claude Code → relay | MCP over stdio | none (a child process) | Newline-delimited JSON-RPC |
| Relay → daemon | MCP Streamable HTTP, `POST /mcp` | Bearer `mcpToken` | Stateless: a new `McpServer` per request, JSON responses (no SSE). This works because no state lives in an MCP session: it's all in services and on disk. Under `ezapply chat` each request carries `x-ezapply-chat-session` |
| CLI → daemon | `GET/POST /control/*`, `GET /health` | Bearer `mcpToken` (health is open) | Pairing window, shutdown, chat session state (`ezapply chat` polls it every second) |
| Browser → daemon | `GET /github/*` pages (`POST /github/reuse`) | one-time state values | GitHub App creation, reuse and login callbacks |
| Browser → daemon | `GET/POST /review/*` | random token in the URL | The document review page and its PDFs |
| Extension ↔ daemon | WebSocket `ws://127.0.0.1:<port>/bridge`, JSON text frames | Origin pinning + pairing code | Versioned handshake, then symmetric RPC ([protocol](components/protocol.md)) |
| Daemon → GitHub | HTTPS REST API and `git` over HTTPS | user access token (per command, never stored in git config) | Read-only App permissions |

Every HTTP request must be addressed to the bound loopback host (`Host` check against DNS rebinding).
`/mcp` and `/control/*` refuse any request that carries an `Origin` header, which browsers always send
cross-site. See [security.md](security.md).

## Where state lives

| Location | Holds | Owner |
|---|---|---|
| `~/.ezapply/daemon.json` (`EZAPPLY_APP_DIR` overrides the folder) | port, MCP token, pairing code, pinned extension id, workspace path | CLI `init`; daemon updates pairing |
| `~/.ezapply/github-app.json` | the user's GitHub App (public parts) | daemon |
| `~/.ezapply/daemon-state.json` | when the extension was last connected | daemon |
| `~/.ezapply/logs/companion.log` (+ `.1`, `.2`) | structured logs, personal data redacted, rotated at 5 MB | daemon |
| OS keychain, service `ezapply` | GitHub App client secret, GitHub user token | daemon |
| `~/ezapply-home/` | everything the user owns: profile, templates, knowledge, postings, library, repo cache | user, Claude, daemon |
| extension `storage.local` | port, pairing code, connection state, pending capture, active posting label | extension |

Formats of every file: [data-formats.md](data-formats.md).

## Cross-cutting concerns

- **Validation.** zod schemas validate every boundary: MCP tool inputs, bridge params and results (on the
  receiving side), and every file read from disk.
- **Errors.** One `EzError` type with a `code`, a `message` and an optional `hint` telling the caller how
  to recover. MCP tools are wrapped (`tool()` / `rawTool()` in `mcp/result.ts`) so every failure reaches
  Claude as `{ error: { code, message, hint } }` with `isError: true`; unexpected ones are logged with
  their stack. Missing dependencies (TeX, git, Ghostscript) get OS-specific install commands
  (`util/install-hints.ts`). The CLI prints an `EzError` (a bad `--port`, a damaged `daemon.json`) as one
  line plus its hint; only unexpected errors show a stack.
- **Finding installed tools.** `which()` caches hits only, and on Windows first appends the folders where
  winget installs MiKTeX and Git, so a tool installed mid-session works without a restart.
- **Versioning.** `PROTOCOL_VERSION` (currently 2) is checked at the bridge handshake; a mismatch is
  refused with which side to update. Every stored format has a `schemaVersion`. `COMPANION_VERSION`
  matches the package version (tested).
- **Wiring.** Services are constructed once in `companion/src/main.ts` and passed explicitly (the
  `Services` object); tools never construct services and there are no module-level singletons besides
  pure caches.
- **Path guards.** Every path Claude passes is resolved against the workspace and checked against the
  folders that operation may touch (`Workspace.resolveAllowed`).
- **Atomic writes.** JSON and generated files are written to a temp file and renamed (`util/fs.ts`).
- **One at a time where it matters.** Operations that would collide run through a per-key queue
  (`util/keyed-queue.ts`): captures and posting metadata updates, builds of the same `.tex` file (they share
  its `.build/` folder), syncs of the same repo (git's `index.lock`).
- **Opening things for the user.** `Opener` (`util/open.ts`) hands a file or one of the daemon's own
  `http://127.0.0.1:<port>/` pages to the OS opener without a shell and without waiting for the program it
  starts; tests pass a stub.
- **Logging.** pino to `~/.ezapply/logs/companion.log` and stderr, level from `EZAPPLY_LOG_LEVEL`, with page
  content, form values and tokens redacted by field path. The file is rotated when it passes 5 MB, checked
  at start and every 10 minutes (every on-demand start appends to it), keeping `companion.log.1` and `.2`.
