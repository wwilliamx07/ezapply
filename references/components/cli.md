# CLI (`packages/cli`)

The `ezapply` command. It runs Claude Code for the user (`chat`), creates and refreshes the workspace, is the
MCP server Claude Code launches, and controls the daemon. Run it through the workspace launcher
(`./ezapply`, or `.ezapply` on Windows, written by `init`), as `npm run ezapply -- <command>`, or as
`node packages/cli/dist/main.js <command>`.

## Commands

| Command | Does |
|---|---|
| `chat [claude args…]` | How ezapply is used: Claude Code in the workspace, restarted with a fresh session when the user captures another posting ([below](#chat-chatts)). The arguments go to the first `claude` only |
| `init [--workspace <dir>] [--port <n>]` | Write `~/.ezapply/daemon.json` and create or refresh the workspace; print the next steps |
| `mcp` | Claude Code's MCP server (stdio relay to the daemon; starts it when needed). Nothing else may write to stdout |
| `start` / `stop` / `restart` | Start the daemon in the background / stop it / stop and start (to pick up a new build) |
| `daemon` | Run the daemon in the foreground (debugging). Stops after `idleTimeoutMinutes` without work (default 15; set 0 in `daemon.json` to keep it up) |
| `pair [--reset]` | Start the daemon if needed, open pairing, wait up to 10 minutes for the extension. `--reset` forgets the pinned extension and makes a new code |
| `status` | Whether the daemon answers, and whether the extension is connected |
| `doctor` | Check Node, config, workspace, the agent file (`CLAUDE.md` imports `EZAPPLY.md`), daemon, protocol version, extension, GitHub, TeX engine, and optional latexdiff and Ghostscript ([below](#doctor-doctorts)) |

`npm run setup` (in the repo) = `npm install && npm run build && ezapply init`.

**Errors.** Expected problems are `EzError`s and print as `ezapply: <message>` plus the hint, with exit code
1: a `--port` that isn't a whole number from 1 to 65535, a `daemon.json` that isn't valid JSON or doesn't
match its schema ("fix it, or delete it and run `ezapply init`"). Anything else is a bug and keeps its
stack trace.

## `init` (`workspace-init.ts`)
Idempotent. User-owned files are never overwritten; ezapply-managed ones are refreshed.

1. **`daemon.json`**: port (flag, existing, or 17373), and existing MCP token, pairing code, pinned id and
   `idleTimeoutMinutes` kept; new random ones otherwise. Workspace defaults to `~/ezapply-home`. Written with mode 0600.
2. **Folders**: `WORKSPACE_DIRS` (`profile`, `templates/resume`, `templates/cover`, `library`, `knowledge`,
   `postings`, `repo-cache`, `.claude/skills`).
3. **`ezapply.config.json`** if missing, then config migrations for untouched old defaults (e.g. the 0.1
   `latexmk` engine default → `auto`).
4. **`EZAPPLY.md`** (managed, always rewritten) from `templates/workspace/EZAPPLY.md`, with `{{EZAPPLY}}`
   replaced by `node "<absolute path of dist/main.js>"` so Claude can run the commands.
5. **`CLAUDE.md`** (the user's): created as a stub that imports `@EZAPPLY.md`; an existing one gets the import
   line added; a pre-split 0.1 file is backed up to `CLAUDE.md.bak` and replaced.
6. **Default cover letter template** into `templates/cover/` only if that folder is empty.
7. **`.mcp.json`**: the `ezapply` server entry is set to
   `{ type: "stdio", command: <node>, args: [<dist/main.js>, "mcp"] }`; other servers are kept.
8. **`.claude/settings.json`**: merged so `enabledMcpjsonServers` includes `ezapply` (no approval prompt),
   `permissions.allow` includes `mcp__ezapply`, and `permissions.deny` includes Edit, Write and NotebookEdit
   on `repo-cache/**`.
9. **Skills**: `templates/skills/*` copied to `.claude/skills/` (overwriting ezapply's own skills). Then
   the bare-named skills of earlier versions (`onboard`, `resume`, `apply`…) are removed, but only when
   their `SKILL.md` uses an ezapply tool (`posting_active`, `tex_compile`, `workspace_check`…); a user's own
   skill with one of those names is kept and reported.
10. **Launcher** (`writeLauncher`): `ezapply.cmd` on Windows (`@echo off` then `"<node>" "<main.js>" %*`), `ezapply`
   elsewhere (`#!/bin/sh` then `exec "<node>" "<main.js>" "$@"`, mode 755), rewritten every time. So
   `ezapply chat` runs from the workspace without the CLI on PATH: a global `npm link` needs write access to
   npm's global folder, which many installs (a system Node on macOS, for one) don't give.

Prints the workspace, what was created/updated/kept, and "cd there, run `./ezapply chat` (`.ezapply chat` on
Windows), say 'set me up'".

## `mcp` (`mcp-relay.ts`)
1. Load `daemon.json`; if missing, print "run `npm run setup`" to stderr and exit 1.
2. `ensureDaemon` (below); a start failure is printed to stderr but the relay still runs, so each request
   gets a JSON-RPC error explaining it.
3. Relay: read newline-delimited JSON-RPC from stdin; for each message `POST /mcp` with the bearer token and
   `Accept: application/json, text/event-stream`; write the JSON body back as one line. Notifications
   (202, empty body) produce no output. Messages are handled concurrently.
4. If the connection is **refused** (`ECONNREFUSED`: nothing listens, so the daemon never saw the message),
   start the daemon (single-flight across concurrent requests) and send it once more. Any other failure,
   such as a connection reset after the request went out (the daemon stopped or crashed mid-call), is
   **not** retried: the tool may already have run, and a second `upload_file` or `remove_repeatable` would
   act twice. The error tells Claude to check the effect before calling again.
5. **No timeout.** Requests go through `node:http` without an agent, which has no response timeout. Node's
   `fetch` (which this used before) gives up on response headers after 300 s, and some tools legitimately
   take longer: `extension_pair_wait` and `github_login_wait` accept up to 15 minutes, `repo_sync` allows git
   10.
6. Unrecoverable failures on requests become `{ error: { code: -32000, message } }`. Exit when stdin ends and
   in-flight requests finish.
7. Under `ezapply chat`, `EZAPPLY_CHAT_SESSION` is in the environment (Claude Code passes its environment
   to MCP servers it starts), and every request carries it as `x-ezapply-chat-session`, so the daemon can
   tell the wrapper whether the session has used a tool and whether one is running
   ([companion](companion.md#chat-sessions-chatts)).

## `chat` (`chat.ts`)
How the user runs ezapply. Every turn re-sends the whole conversation, so a session that carries a finished
application (or the onboarding) into the next pays for it on every turn: in the first real session about
half the tokens of the form fill were the onboarding still in context. Claude can't clear its own context
and Claude Code hooks can't trigger `/clear`, so a process outside Claude restarts it.

1. Needs `daemon.json` (else "run `ezapply init`") and Claude Code: `EZAPPLY_CLAUDE` if set, else the first
   `claude.exe`, `claude.cmd` or `claude.bat` on PATH (Windows) or `claude` (elsewhere) (`findClaude`). A
   `.cmd`/`.bat` launcher (an npm install on Windows) runs through the shell with cmd quoting.
2. `ensureDaemon`, then start `claude` in the workspace with the terminal inherited and
   `EZAPPLY_CHAT_SESSION=<random UUID>`. The wrapper ignores SIGINT: Ctrl+C belongs to Claude, and the
   wrapper ends, with Claude's exit code, when Claude does.
3. Every second, `GET /control/chat?session=<id>`. The posting active at the daemon's first answer is the
   session's own. When a **different** posting becomes active (a capture, or `posting_activate`):
   - the session hasn't used a tool, or `context.restartOnCapture` is off: the new posting becomes the
     session's own, no restart (an untouched session has nothing to drop);
   - a tool call is running: wait for it, so no fill, upload or build is cut in half;
   - otherwise end Claude: on Windows `taskkill /T /F` on its process tree (Claude and what it started,
     such as its relay), elsewhere SIGTERM and SIGKILL after 5 s.
4. Reset the terminal (raw mode off; SGR reset; show the cursor; bracketed paste, focus and mouse
   reporting off; not the alternate screen, which Claude Code doesn't use and leaving it moves the
   cursor), print "ezapply: new posting (<company: role>). Started a fresh Claude session; the last one can
   be reopened with `claude --resume`.", and start `claude` again with a new session id and no arguments.

Nothing is handed over. A posting's work finishes in one session; what carries over is on disk (`notes.md`
with the application requirements, the documents, `form-log.jsonl`); the new session's relay attaches to the
same daemon, which the extension stays connected to; and `EZAPPLY.md` has Claude read every claim in one
Grep, so a fresh session is oriented in a turn. Claude's own text between tool calls can be cut off: capturing
the next posting is a deliberate act that comes after the current one is done.

*Rejected:* Claude Code hooks to track turns (they would only refine "never mid-turn", which the running-call
check and the capture being deliberate make unnecessary); running `claude` in a pseudo-terminal and typing
`/clear` into it (a native module, a full terminal UI through Windows ConPTY, races with the user's typing);
keeping plain `claude` working with a suggestion to `/clear` (ezapply is run only through `chat`).

## Daemon control (`daemonctl.ts`)
- `fetchHealth`: `/health` with a 2 s timeout; only counts if it answers `name: "ezapply"`.
- `ensureDaemon(config, { cliMain, restart? })`: if healthy and not restarting, done. Otherwise stop any
  running one, spawn `node <main.js> daemon` detached with stdio ignored and no window, `unref`, and wait up
  to 20 s for health. Failure message points at `ezapply daemon` and the log file.
- `stopDaemon`: `POST /control/shutdown`, then wait up to 10 s for health to fail.
- `openPairing`, `pairingStatus`: `/control/pair` with the bearer token.
- Polling uses the companion's `waitFor`.

## `doctor` (`doctor.ts`)
One table for people, `ok` or `FAIL` per line; exit code 1 if anything failed. The agent-file, TeX and GitHub
lines use the same checks as `workspace_check` (`agentFileStatus`, `texStatus`, `githubDetail` from the
companion), worded for a terminal: a missing TeX engine prints this OS's install command, and a missing
Ghostscript its own. GitHub is read through `GitHubService.status()`, so a damaged keychain entry reads as
logged out instead of crashing, and it fails only on a port mismatch. A daemon that isn't running is fine
(Claude Code starts it; it stops when idle); protocol and extension lines appear only when it runs.

The daemon started with `extensionDir` = `packages/extension`, so `extension_pair` can give the build
paths.

## Shipped templates (`packages/cli/templates/`)
- `workspace/EZAPPLY.md`: the agent file → [workspace.md](workspace.md#the-agent-file-ezapplymd)
- `workspace/CLAUDE.md`: the user's stub
- `skills/*/SKILL.md`: `ezapply-onboard`, `ezapply-repos`, `ezapply-index-repo`, `ezapply-resume`, `ezapply-cover-letter`, `ezapply-bundle`, `ezapply-apply`, `ezapply-answers`
- `cover/`: the default cover letter → [profile-and-templates.md](profile-and-templates.md#the-default-cover-letter)
