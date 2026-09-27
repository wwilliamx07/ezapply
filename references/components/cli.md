# CLI (`packages/cli`)

The `ezapply` command. It creates and refreshes the workspace, is the MCP server Claude Code launches, and
controls the daemon. Run it as `npm run ezapply -- <command>` or `node packages/cli/dist/main.js <command>`.

## Commands

| Command | Does |
|---|---|
| `init [--workspace <dir>] [--port <n>]` | Write `~/.ezapply/daemon.json` and create or refresh the workspace; print the next steps |
| `mcp` | Claude Code's MCP server (stdio relay to the daemon; starts it when needed). Nothing else may write to stdout |
| `start` / `stop` / `restart` | Start the daemon in the background / stop it / stop and start (to pick up a new build) |
| `daemon` | Run the daemon in the foreground (debugging). Stops after `idleTimeoutMinutes` without work (default 15; set 0 in `daemon.json` to keep it up) |
| `pair [--reset]` | Start the daemon if needed, open pairing, wait up to 10 minutes for the extension. `--reset` forgets the pinned extension and makes a new code |
| `status` | Whether the daemon answers, and whether the extension is connected |
| `doctor` | Check Node, config, workspace, the agent file (`CLAUDE.md` imports `EZAPPLY.md`), daemon, protocol version, extension, GitHub, TeX engine, and optional latexdiff and Ghostscript |

`npm run setup` (in the repo) = `npm install && npm run build && ezapply init`.

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

Prints the workspace, what was created/updated/kept, and "cd there, run `claude`, say 'set me up'".

## `mcp` (`mcp-relay.ts`)
1. Load `daemon.json`; if missing, print "run `npm run setup`" to stderr and exit 1.
2. `ensureDaemon` (below); a start failure is printed to stderr but the relay still runs, so each request
   gets a JSON-RPC error explaining it.
3. Relay: read newline-delimited JSON-RPC from stdin; for each message `POST /mcp` with the bearer token and
   `Accept: application/json, text/event-stream`; write the JSON body back as one line. Notifications
   (202, empty body) produce no output. Messages are handled concurrently.
4. If a POST can't connect, start the daemon (single-flight across concurrent requests) and retry once.
   Unrecoverable failures on requests become `{ error: { code: -32000, message } }`.
5. Exit when stdin ends and in-flight requests finish.

## Daemon control (`daemonctl.ts`)
- `fetchHealth`: `/health` with a 2 s timeout; only counts if it answers `name: "ezapply"`.
- `ensureDaemon(config, { cliMain, restart? })`: if healthy and not restarting, done. Otherwise stop any
  running one, spawn `node <main.js> daemon` detached with stdio ignored and no window, `unref`, and wait up
  to 20 s for health. Failure message points at `ezapply daemon` and the log file.
- `stopDaemon`: `POST /control/shutdown`, then wait up to 10 s for health to fail.
- `openPairing`, `pairingStatus`: `/control/pair` with the bearer token.

The daemon started with `extensionDir` = `packages/extension`, so `extension_pair` can give the build
paths.

## Shipped templates (`packages/cli/templates/`)
- `workspace/EZAPPLY.md`: the agent file → [workspace.md](workspace.md#the-agent-file-ezapplymd)
- `workspace/CLAUDE.md`: the user's stub
- `skills/*/SKILL.md`: `ezapply-onboard`, `ezapply-repos`, `ezapply-index-repo`, `ezapply-resume`, `ezapply-cover-letter`, `ezapply-bundle`, `ezapply-apply`, `ezapply-answers`
- `cover/`: the default cover letter → [profile-and-templates.md](profile-and-templates.md#the-default-cover-letter)
