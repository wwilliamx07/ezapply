# CLI (`packages/cli`)

The `ezapply` command. It runs ezapply for the user (with no command: the companion in its own process for the
browser's side panel, which starts Claude Code headless), creates and refreshes the workspace, and is the MCP
server Claude Code launches. Run it through the
workspace launcher (`./ezapply`, or `.\ezapply` on Windows, written by `init`), as
`npm run ezapply -- <command>`, or as `node packages/cli/dist/main.js <command>`.

## Commands

| Command | Does |
|---|---|
| (none) | How ezapply is used: the companion runs in this process for the side panel, with Claude Code started headless by it; opens the setup page while setup isn't finished; Ctrl+C stops it ([below](#ezapply-panelts)) |
| `help` | The commands |
| `init [--workspace <dir>] [--port <n>]` | Write `~/.ezapply/config.json` and create or refresh the workspace; print the next steps |
| `mcp` | Claude Code's MCP server: a stdio relay to the companion inside `ezapply`. Nothing else may write to stdout |
| `debug on\|off\|report [dir]\|clean\|export` | Debug mode (`debug.ts`). `on` and `off` set `debug.enabled` in the workspace's `ezapply.config.json`, keeping everything else. `report` prints `debugReport` for a session under `debug/` (default: the newest): calls by tool, the slowest calls, time with the tab hidden, failed calls, failed fields by error, and from the adapter's trace the slowest fields and waits, waits that ran to their maximum, slow paths taken (named branches, React handlers called directly), the page's errors and failed requests, what was saved at failures, and calls with no trace (an extension built before it). `export <session\|latest> <NNNN> [before\|after\|fail-<fieldId>]` writes a test fixture candidate from a saved page (`debugExport`, [below](#debug-export)). `clean` deletes `debug/`. It lives here rather than in a repo script because it reads the user's workspace ([format](../data-formats.md#debugdate-postingid-companionsrcformsdebugts)) |
| `doctor` | Check Node, config, workspace, the agent file (`CLAUDE.md` imports `EZAPPLY.md`), whether ezapply is running, protocol version, extension connected and paired, whether the browser pages are built, GitHub, TeX engine, and optional latexdiff and Ghostscript ([below](#doctor-doctorts)) |

`npm run setup` (in the repo) = `npm install && npm run build && ezapply init`. An ezapply that's running keeps
the build it started with; `init` says to stop it and start it again.

There are no `start`, `stop`, `restart`, `daemon` or `pair` commands: there is no background process to
control (`ezapply` runs in the foreground of its terminal) (see [architecture](../architecture.md#processes-and-lifecycle) for why). Pairing, and forgetting a
paired extension, are `extension_pair` and `extension_pair replace: true`, which onboarding calls.

There is no `chat` or `status` command either: the user talks to Claude in the side panel's agent
([agent](agent.md)), with a conversation per posting, and `doctor` reports whether ezapply is running, its
version and whether the extension is connected. Claude Code can still be run by hand in the workspace while
`ezapply` runs; its relay reaches the same companion. An unknown command prints the usage, exit code 2.

**Errors.** Expected problems are `EzError`s and print as `ezapply: <message>` plus the hint, with exit code
1: a `--port` that isn't a whole number from 1 to 65535, a `config.json` that isn't valid JSON or doesn't
match its schema ("fix it, or delete it and run `ezapply init`"). Anything else is a bug and keeps its
stack trace.

## `init` (`workspace-init.ts`)
Idempotent. User-owned files are never overwritten; ezapply-managed ones are refreshed.

1. **`config.json`**: port (flag, existing, or 17373), and existing MCP token, pairing code and pinned id
   kept; new random ones otherwise. Workspace defaults to `~/ezapply-home`. Written with mode 0600. An earlier
   build's `daemon.json` is moved to `config.json` when the config is loaded (so the pairing carries over).
2. **Folders**: `WORKSPACE_DIRS` (`profile`, `templates/resume`, `templates/cover`, `library`, `knowledge`,
   `postings`, `repo-cache`, `.claude/skills`).
3. **`ezapply.config.json`** if missing, then its upgrades from older builds (`migrateWorkspaceConfig`: untouched
   old defaults, renamed and removed settings; each, and why, in
   [data-formats](../data-formats.md#ezapplyconfigjson-companionsrcconfigworkspacets)). **`autofill-timing.yaml`** if missing (`timingFileTemplate`): every wait
   commented out at its default, so a default changed in a later build still applies to an untouched line.
4. **`EZAPPLY.md`** (managed, always rewritten) from `templates/workspace/EZAPPLY.md`, with `{{EZAPPLY}}`
   replaced by `node "<absolute path of dist/main.js>"` so Claude can run the commands.
5. **`CLAUDE.md`** (the user's): created as a stub that imports `@EZAPPLY.md`; an existing one gets the import
   line added; a pre-split 0.1 file is backed up to `CLAUDE.md.bak` and replaced.
6. **Default cover letter template** into `templates/cover/` only if that folder holds nothing but dotfiles.
7. **`.mcp.json`**: the `ezapply` server entry is set to
   `{ type: "stdio", command: <node>, args: [<dist/main.js>, "mcp"] }`; other servers are kept.
8. **`.claude/settings.json`**: merged so `enabledMcpjsonServers` includes `ezapply` (no approval prompt),
   `permissions.allow` includes `mcp__ezapply`, `permissions.deny` includes Edit, Write and NotebookEdit
   on `repo-cache/**`, Read on `debug/**` and Bash for `python`, `python3` and `py`, and `autoMemoryEnabled` is `false` unless the user set it
   ([why](workspace.md#claude-code-settings)).
9. **Skills**: `templates/skills/*` copied to `.claude/skills/` (overwriting ezapply's own skills). Then
   the bare-named skills of earlier versions (`onboard`, `resume`, `apply`…) are removed, but only when
   their `SKILL.md` uses an ezapply tool (`posting_active`, `tex_compile`, `workspace_check`…); a user's own
   skill with one of those names is kept and reported.
10. **Launcher** (`writeLauncher`): `ezapply.cmd` on Windows (`@echo off` then `"<node>" "<main.js>" %*`), `ezapply`
   elsewhere (`#!/bin/sh` then `exec "<node>" "<main.js>" "$@"`, mode 755), rewritten every time. So
   `ezapply` runs from the workspace without the CLI on PATH: a global `npm link` needs write access to
   npm's global folder, which many installs (a system Node on macOS, for one) don't give.

Prints the workspace, what was created/updated/kept, and "cd there, run `./ezapply` (`.\ezapply` on Windows)":
a setup page opens in the browser for what's missing, Claude does the parts that need it, and from then on the
user works in the ezapply panel; plus that a running ezapply must be restarted to use the new build.

## The MCP relay (`mcp-relay.ts`)
Claude Code talks to MCP servers over stdio, and the companion serves MCP over HTTP inside `ezapply`, so
`ezapply mcp` relays between them. (Claude Code's own HTTP transport would bring its own timeouts, and some
tools wait up to 15 minutes.)

1. Load `config.json`; if missing, print "run `npm run setup`" to stderr and exit 1.
2. Relay: read newline-delimited JSON-RPC from stdin; for each message `POST /mcp` with the bearer token and
   `Accept: application/json, text/event-stream`; write the JSON body back as one line. Notifications
   (202, empty body) produce no output. Messages are handled concurrently.
3. **It never starts anything.** A refused connection (`ECONNREFUSED`: ezapply isn't running, for example
   Claude Code started directly in the workspace) answers the request with `NOT_RUNNING`: "ezapply isn't
   running. Ask the user to start it (`./ezapply` in the workspace, `.\ezapply` on Windows) and keep it open
   while they work in the browser's ezapply panel". Nothing is sent twice. A connection that breaks after the
   request went out (ezapply stopped mid-call) is reported as such, because the tool may already have run and a
   second `upload_file` or `remove_repeatable` would act twice; the error tells Claude to check the effect before
   calling again.
4. **No timeout.** Requests go through `node:http` without an agent, which has no response timeout. Node's
   `fetch` gives up on response headers after 300 s, and some tools legitimately take longer:
   `extension_pair_wait` and `github_login_wait` accept up to 15 minutes, `repo_sync` allows git 10.
5. A non-2xx answer to a request, and any other failure, becomes `{ error: { code: -32000, message } }`; a
   line that isn't JSON is dropped. Exit when stdin ends and in-flight requests finish.
6. The panel's agent runs Claude Code with `EZAPPLY_SESSION=<session id>` in the environment (Claude Code
   passes its environment to MCP servers it starts), and the relay sends it on every request as
   `x-ezapply-session`, so the companion knows which conversation a call comes from
   ([agent](agent.md)). A Claude Code started by hand has none, and its requests carry no header.

## `ezapply` (`panel.ts`)
How the user runs ezapply: `hostPanel`, with no command. It and the tests are the only places the companion runs.

1. Needs `config.json` (else "run `ezapply init`") and Claude Code: `EZAPPLY_CLAUDE` if set, else the first
   `claude.exe`, `claude.cmd` or `claude.bat` on PATH (Windows) or `claude` (elsewhere) (`findClaude`, the
   companion's). Without it, "Claude Code isn't on PATH" and exit 1.
2. Install the crash guard (`guardProcess` in `quiet.ts`): `uncaughtException` and `unhandledRejection` are
   logged and the process carries on. Otherwise a bug in companion code would end ezapply and take Claude's
   tools and the extension's connection with it; every error the companion can expect is already caught per
   request.
3. `startCompanion` in this process, with Claude Code passed as `CompanionOptions.claude` for the panel's agent
   ([agent](agent.md)) and `extensionDir` = `packages/extension` so `extension_pair` can give the build paths.
   If the port is taken (`EADDRINUSE`), look at what answers `/health` there:
   - `name: "ezapply"`: another `ezapply` → "ezapply is already running in another terminal". One companion
     per port, and the extension connects to one.
   - anything else → "Port N is in use by another program", with `ezapply init --port <n>` and the matching
     extension setting as the fix.

   Either way the message goes to stderr, exit code 1.
4. Prints `ezapply is running (port N).`; while `workspace_check` isn't ready, opens the setup page (`onboarding`'s
   link, through the `Opener`: there may be no extension yet, so no panel) and says so, or prints its link; then
   "Open the ezapply panel from your browser's toolbar. Press Ctrl+C here to stop ezapply." From then on
   `quietProcess`: libraries print (pdfjs through `console.log`, dependencies' warnings on stderr), so
   `console.*` and `process.stderr.write` go to the log and the terminal shows only these lines.
   `process.stdout` stays: ezapply's own lines go there. A server error after listening is logged.
5. Waits for SIGINT, SIGTERM or SIGHUP (the terminal closing), then closes the companion (the agent's Claude
   Code processes, the extension socket with 1001, the HTTP server and its connections) and exits 0.

The terminal is ezapply's: Ctrl+C stops it. The panel keeps conversations per posting
([agent](agent.md#conversations-servicets)), so a finished application isn't re-sent with every turn of the next one.

## `health.ts`
`fetchHealth`: `/health` with a 2 s timeout; only counts if it answers `name: "ezapply"`. `doctor` and the
port-taken check in `ezapply` use it.

## `doctor` (`doctor.ts`)
One table for people, `ok` or `FAIL` per line; exit code 1 if anything failed. The agent-file, TeX and GitHub
lines use the same checks as `workspace_check` (`agentFileStatus`, `texStatus`, `githubDetail` from the
companion), worded for a terminal: a missing TeX engine prints this OS's install command, and a missing
Ghostscript its own. GitHub is read through `GitHubService.status()`, so a damaged keychain entry reads as
logged out instead of crashing, and it fails only on a port mismatch. ezapply not running is fine (doctor is
often run while it's stopped); while it runs, its version, the protocol version (a mismatch says to stop ezapply
and start it again) and whether the extension is connected are added. `pages` fails when the UI package
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
the user looks at it before it's copied to the site's `fixtures/` in `packages/sites/src/<site>/`.

## Shipped templates (`packages/cli/templates/`)
- `workspace/EZAPPLY.md`: the agent file → [workspace.md](workspace.md#the-agent-file-ezapplymd)
- `workspace/CLAUDE.md`: the user's stub
- `skills/*/SKILL.md`: `ezapply-onboard`, `ezapply-repos`, `ezapply-index-repo`, `ezapply-resume`, `ezapply-cover-letter`, `ezapply-bundle`, `ezapply-apply`, `ezapply-answers`
- `cover/`: the default cover letter → [profile-and-templates.md](profile-and-templates.md#the-default-cover-letter)
