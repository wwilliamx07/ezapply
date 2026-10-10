# CLI (`packages/cli`)

The `ezapply` command. It runs ezapply for the user (`chat`: the companion in its own process, Claude Code as
its child), creates and refreshes the workspace, and is the MCP server Claude Code launches. Run it through the
workspace launcher (`./ezapply`, or `.\ezapply` on Windows, written by `init`), as
`npm run ezapply -- <command>`, or as `node packages/cli/dist/main.js <command>`.

## Commands

| Command | Does |
|---|---|
| `chat [claude args…]` | How ezapply is used: the companion runs in this process and Claude Code in the workspace as its child, restarted with a fresh session when the user captures another posting ([below](#chat-chatts)). The arguments go to the first `claude` only |
| `init [--workspace <dir>] [--port <n>]` | Write `~/.ezapply/config.json` and create or refresh the workspace; print the next steps |
| `mcp` | Claude Code's MCP server: a stdio relay to the companion inside `ezapply chat`. Nothing else may write to stdout |
| `status` | Whether an `ezapply chat` is running (its `/health`), and whether the extension is connected |
| `debug on\|off\|report [dir]\|clean\|export` | Debug mode (`debug.ts`). `on` and `off` set `debug.enabled` in the workspace's `ezapply.config.json`, keeping everything else. `report` prints `debugReport` for a session under `debug/` (default: the newest): calls by tool, the slowest calls, time with the tab hidden, failed calls, failed fields by error, and from the adapter's trace the slowest fields and waits, waits that ran to their maximum, slow paths taken (named branches, React handlers called directly), the page's errors and failed requests, what was saved at failures, and calls with no trace (an extension built before it). `export <session\|latest> <NNNN> [before\|after\|fail-<fieldId>]` writes a test fixture candidate from a saved page (`debugExport`, [below](#debug-export)). `clean` deletes `debug/`. It lives here rather than in a repo script because it reads the user's workspace ([format](../data-formats.md#debugdate-postingid-companionsrcformsdebugts)) |
| `doctor` | Check Node, config, workspace, the agent file (`CLAUDE.md` imports `EZAPPLY.md`), whether ezapply is running, protocol version, extension, whether the browser pages are built, GitHub, TeX engine, and optional latexdiff and Ghostscript ([below](#doctor-doctorts)) |

`npm run setup` (in the repo) = `npm install && npm run build && ezapply init`. A chat that's open keeps
running the build it started with; `init` says to exit it and start it again.

There are no `start`, `stop`, `restart`, `daemon` or `pair` commands: there is no background process to
control (see [architecture](../architecture.md#processes-and-lifecycle) for why). Pairing, and forgetting a
paired extension (what `pair --reset` did), are `extension_pair` and `extension_pair replace: true`, which
onboarding calls from inside the chat.

**Errors.** Expected problems are `EzError`s and print as `ezapply: <message>` plus the hint, with exit code
1: a `--port` that isn't a whole number from 1 to 65535, a `config.json` that isn't valid JSON or doesn't
match its schema ("fix it, or delete it and run `ezapply init`"). Anything else is a bug and keeps its
stack trace.

## `init` (`workspace-init.ts`)
Idempotent. User-owned files are never overwritten; ezapply-managed ones are refreshed.

1. **`config.json`**: port (flag, existing, or 17373), and existing MCP token, pairing code and pinned id
   kept; new random ones otherwise. Workspace defaults to `~/ezapply-home`. Written with mode 0600. An earlier
   build's `daemon.json` is moved to `config.json` when the config is loaded (so the pairing carries over), and
   `init` deletes the old daemon's `daemon-state.json`.
2. **Folders**: `WORKSPACE_DIRS` (`profile`, `templates/resume`, `templates/cover`, `library`, `knowledge`,
   `postings`, `repo-cache`, `.claude/skills`).
3. **`ezapply.config.json`** if missing, then config migrations for untouched old defaults (e.g. the 0.1
   `latexmk` engine default → `auto`), and renamed settings: debug mode's old switch `debug.autofill` becomes
   `debug.enabled` (the schema drops keys it doesn't know, so the old one left in place turned debug mode off
   silently; a `debug.enabled` already set wins). **`autofill-timing.yaml`** if missing (`timingFileTemplate`): every wait
   commented out at its default, so a default changed in a later build still applies to an untouched line.
4. **`EZAPPLY.md`** (managed, always rewritten) from `templates/workspace/EZAPPLY.md`, with `{{EZAPPLY}}`
   replaced by `node "<absolute path of dist/main.js>"` so Claude can run the commands.
5. **`CLAUDE.md`** (the user's): created as a stub that imports `@EZAPPLY.md`; an existing one gets the import
   line added; a pre-split 0.1 file is backed up to `CLAUDE.md.bak` and replaced.
6. **Default cover letter template** into `templates/cover/` only if that folder is empty.
7. **`.mcp.json`**: the `ezapply` server entry is set to
   `{ type: "stdio", command: <node>, args: [<dist/main.js>, "mcp"] }`; other servers are kept.
8. **`.claude/settings.json`**: merged so `enabledMcpjsonServers` includes `ezapply` (no approval prompt),
   `permissions.allow` includes `mcp__ezapply`, `permissions.deny` includes Edit, Write and NotebookEdit
   on `repo-cache/**`, and `autoMemoryEnabled` is `false` unless the user set it
   ([why](workspace.md#claude-code-settings)).
9. **Skills**: `templates/skills/*` copied to `.claude/skills/` (overwriting ezapply's own skills). Then
   the bare-named skills of earlier versions (`onboard`, `resume`, `apply`…) are removed, but only when
   their `SKILL.md` uses an ezapply tool (`posting_active`, `tex_compile`, `workspace_check`…); a user's own
   skill with one of those names is kept and reported.
10. **Launcher** (`writeLauncher`): `ezapply.cmd` on Windows (`@echo off` then `"<node>" "<main.js>" %*`), `ezapply`
   elsewhere (`#!/bin/sh` then `exec "<node>" "<main.js>" "$@"`, mode 755), rewritten every time. So
   `ezapply chat` runs from the workspace without the CLI on PATH: a global `npm link` needs write access to
   npm's global folder, which many installs (a system Node on macOS, for one) don't give.

Prints the workspace, what was created/updated/kept, and "cd there, run `./ezapply chat` (`.\ezapply chat` on
Windows), say 'set me up'" (a setup page opens in the browser for what's missing, and Claude does the parts that
need it), plus that an open chat must be restarted to use the new build.

## The MCP relay (`mcp-relay.ts`)
Claude Code talks to MCP servers over stdio, and the companion serves MCP over HTTP inside `ezapply chat`, so
`ezapply mcp` relays between them. (Claude Code's own HTTP transport would bring its own timeouts, and some
tools wait up to 15 minutes.)

1. Load `config.json`; if missing, print "run `npm run setup`" to stderr and exit 1.
2. Relay: read newline-delimited JSON-RPC from stdin; for each message `POST /mcp` with the bearer token and
   `Accept: application/json, text/event-stream`; write the JSON body back as one line. Notifications
   (202, empty body) produce no output. Messages are handled concurrently.
3. **It never starts anything.** A refused connection (`ECONNREFUSED`: no `ezapply chat` is running, for
   example Claude Code started directly in the workspace) answers the request with `NOT_RUNNING`: "ezapply
   isn't running. It runs inside `ezapply chat`: ask the user to exit this Claude session and start it again
   with `ezapply chat`". Nothing is sent twice. A connection that breaks after the request went out (the chat
   ended mid-call) is reported as such, because the tool may already have run and a second `upload_file` or
   `remove_repeatable` would act twice; the error tells Claude to check the effect before calling again.
4. **No timeout.** Requests go through `node:http` without an agent, which has no response timeout. Node's
   `fetch` gives up on response headers after 300 s, and some tools legitimately take longer:
   `extension_pair_wait` and `github_login_wait` accept up to 15 minutes, `repo_sync` allows git 10.
5. Unrecoverable failures on requests become `{ error: { code: -32000, message } }`. Exit when stdin ends and
   in-flight requests finish.
6. Under `ezapply chat`, `EZAPPLY_CHAT_SESSION` is in the environment (Claude Code passes its environment
   to MCP servers it starts), and every request carries it as `x-ezapply-chat-session`, so the companion can
   tell the wrapper whether the session has used a tool and whether one is running
   ([companion](companion.md#chat-sessions-chatts)).

## `chat` (`chat.ts`)
How the user runs ezapply, and the only process the companion runs in.

### Hosting the companion (`hostChat`)
1. Needs `config.json` (else "run `ezapply init`") and Claude Code: `EZAPPLY_CLAUDE` if set, else the first
   `claude.exe`, `claude.cmd` or `claude.bat` on PATH (Windows) or `claude` (elsewhere) (`findClaude`). A
   `.cmd`/`.bat` launcher (an npm install on Windows) runs through the shell with cmd quoting.
2. Install the crash guard (`guardProcess` in `quiet.ts`): `uncaughtException` and `unhandledRejection` are
   logged and the process carries on. Otherwise a bug in companion code would end the chat and take the
   terminal and Claude's tools with it; every error the companion can expect is already caught per request.
3. `startCompanion` in this process, with `extensionDir` = `packages/extension` so `extension_pair` can give
   the build paths. If the port is taken (`EADDRINUSE`), look at what answers `/health` there:
   - `mode: "chat"`: another `ezapply chat` → "ezapply is already running in another terminal". One
     companion per port, and the extension connects to one.
   - `name: "ezapply"` without `mode`: a background daemon from an earlier build, which may still be up
     after an update → `POST /control/shutdown` with the MCP token (its own route), wait up to 10 s for the
     port to free, and start.
   - anything else → "Port N is in use by another program", with `ezapply init --port <n>` and the matching
     extension setting as the fix.

   In every failure case Claude isn't started (it would have no tools) and the message goes to stderr,
   exit code 1.
4. From here the terminal is Claude's (`quietProcess`): `console.*` and `process.stderr.write` go to the log,
   since libraries print (pdfjs through `console.log`, dependencies' warnings on stderr) and anything written
   lands in the middle of Claude's screen. `process.stdout` stays: the wrapper prints its restart line there,
   while no Claude is running. Claude writes to the terminal it inherited, not through these streams.
   SIGTERM and SIGHUP (the terminal closing) close the companion and exit; SIGINT is ignored, because Ctrl+C
   belongs to Claude.
5. `runChat` (below); when it returns (Claude exited), close the companion (extension socket with 1001, the
   HTTP server and its connections) and exit with Claude's exit code.

### Restarting Claude (`runChat`)
Every turn re-sends the whole conversation, so a session that carries a finished application (or the
onboarding) into the next pays for it on every turn: in the first real session about half the tokens of the
form fill were the onboarding still in context. Claude can't clear its own context and Claude Code hooks
can't trigger `/clear`, so the process that started Claude restarts it.

1. Read the active posting (the session's own), then start `claude` in the workspace with the terminal
   inherited and `EZAPPLY_CHAT_SESSION=<random UUID>`.
2. Subscribe to the companion's `ChatHost.onChange`, which fires when the active posting changes (a capture,
   or `posting_activate`) and when a tool call ends. On each, check (one check at a time; a change during a
   check is checked again after it):
   - no active posting, or the session's own: nothing to do;
   - the session hasn't used a tool, or `context.restartOnCapture` is off: the new posting becomes the
     session's own, no restart (an untouched session has nothing to drop);
   - a tool call is running: wait; its end fires the next check, so no fill, upload or build is cut in half
     and the restart comes right after it;
   - otherwise end Claude: on Windows `taskkill /T /F` on its process tree (Claude and what it started,
     such as its relay), elsewhere SIGTERM and SIGKILL after 5 s.
3. Reset the terminal (raw mode off; SGR reset; show the cursor; bracketed paste, focus and mouse
   reporting off; not the alternate screen, which Claude Code doesn't use and leaving it moves the
   cursor), print "ezapply: new posting (<company: role>). Started a fresh Claude session; the last one can
   be reopened with `claude --resume`.", and start `claude` again with a new session id and no arguments.

Nothing is handed over. A posting's work finishes in one session; what carries over is on disk (`notes.md`
with the application requirements, the documents, `form-log.jsonl`); the new session's relay attaches to the
same companion, which the extension stays connected to; and `EZAPPLY.md` has Claude read every claim in one
Grep, so a fresh session is oriented in a turn. Claude's own text between tool calls can be cut off: capturing
the next posting is a deliberate act that comes after the current one is done.

*Rejected:* Claude Code hooks to track turns (they would only refine "never mid-turn", which the running-call
check and the capture being deliberate make unnecessary); running `claude` in a pseudo-terminal and typing
`/clear` into it (a native module, a full terminal UI through Windows ConPTY, races with the user's typing);
keeping plain `claude` working with a suggestion to `/clear` (ezapply is run only through `chat`); polling the
companion's state every second (what the background-daemon builds did, over `GET /control/chat`; in-process
events restart at once and cost nothing while idle).

## `status` and `health.ts`
`fetchHealth`: `/health` with a 2 s timeout; only counts if it answers `name: "ezapply"`. `status` prints
whether an `ezapply chat` is running (exit 0) or not (exit 1: "It runs while `ezapply chat` is open"), and
names an earlier build's background daemon if one answers without `mode`.

## `doctor` (`doctor.ts`)
One table for people, `ok` or `FAIL` per line; exit code 1 if anything failed. The agent-file, TeX and GitHub
lines use the same checks as `workspace_check` (`agentFileStatus`, `texStatus`, `githubDetail` from the
companion), worded for a terminal: a missing TeX engine prints this OS's install command, and a missing
Ghostscript its own. GitHub is read through `GitHubService.status()`, so a damaged keychain entry reads as
logged out instead of crashing, and it fails only on a port mismatch. ezapply not running is fine (doctor is
usually run from another terminal, and ezapply runs only while a chat is open); an earlier build's daemon
holding the port fails. The protocol line appears only while a chat runs. `pages` fails when the UI package
isn't built (`UiAssets.built()`: its `manifest.json`), since the review and setup pages need it.

## `debug export`
`ezapply debug export <session|latest> <NNNN> [before|after|fail-<fieldId>]` (`companion/src/forms/debug-export.ts`)
turns a page debug mode saved (`NNNN-before.html` by default) into a fixture candidate for an extraction test or
for correcting a behavioural fixture ([the loop](../development.md#debugging-a-live-run-debug-mode)). Two
passes:
1. **Values blanked:** text-like inputs' values, textareas, chosen `<option>`s, ticked boxes and radios,
   `aria-checked` and `aria-pressed`, the option a listbox button shows (back to "Select One"), Workday's
   selected-value pills and attached file names. A radio's `value` is its option, not an answer, and stays.
2. **Strings replaced, wherever they still show** (text and attribute values, case-insensitive): every string in
   `profile/profile.yaml` of three characters or more, longest first, except bare numbers under four digits
   (they'd hit ids and counts); and the job title and tenant the call's record read (`form.get`'s `job.title` and
   `tenant`). Whole values only: replacing their words too would hit the page's own labels ("Street" in "Street
   Address"). A profile string that's also an option (a country) goes from the list as well.

It writes `NNNN-<which>.fixture.html` beside the source, with a header comment in the fixtures' style (site, page
kind, step, what was removed, the counts), and prints the counts. It never writes into the repo: the markup is the
employer's and the scrub can miss something (a name the page shows differently, an employer detail in a link), so
the user looks at it before it's copied to `extension/test/fixtures/live/`.

## Shipped templates (`packages/cli/templates/`)
- `workspace/EZAPPLY.md`: the agent file → [workspace.md](workspace.md#the-agent-file-ezapplymd)
- `workspace/CLAUDE.md`: the user's stub
- `skills/*/SKILL.md`: `ezapply-onboard`, `ezapply-repos`, `ezapply-index-repo`, `ezapply-resume`, `ezapply-cover-letter`, `ezapply-bundle`, `ezapply-apply`, `ezapply-answers`
- `cover/`: the default cover letter → [profile-and-templates.md](profile-and-templates.md#the-default-cover-letter)
