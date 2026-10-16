# Compatibility with various agents: details

From each agent's documentation as of October 2026; nothing here has been run yet. Each backend starts with a
live run of its open questions (below), with a throwaway MCP server, as Claude Code's were verified
([agent](../../references/components/agent.md#the-process-processts)).

## What the panel needs from an agent

What `AgentProcess`, `AgentService` and the workspace rely on in Claude Code today, and what each agent offers.

| Needs | Claude Code (today) | Codex | opencode | Antigravity CLI (`agy`) |
|---|---|---|---|---|
| Headless entry point | `claude -p`, stream-json in and out | `codex app-server` (JSON-RPC over stdio). Not `codex exec`: one prompt per process, approvals impossible | `opencode acp` (ACP over stdio). Not `opencode run`: one prompt per process. `opencode serve` (HTTP, SSE) also works but needs a port and a password | `agy --input-format stream-json --output-format stream-json` (no `-p`) |
| Many turns in one process | Yes | `thread/start`, then `turn/start` per message | `session/new`, then `session/prompt` per message | Yes; a `result` per turn, closing stdin ends it |
| A message mid-turn | Queued, taken in the same turn | `turn/steer { expectedTurnId }` | Unknown: whether a second `session/prompt` queues | Unknown |
| Stop | `control_request` interrupt | `turn/interrupt` (turn ends `interrupted`) | `session/cancel` | No control requests (one ends the session, exit 2). SIGINT gives `INTERRUPTED`; whether the process survives is unknown, else `--conversation <id>` resumes |
| Approvals to the panel | `--permission-prompt-tool` (an MCP tool) | Server requests `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`, answered `accept`, `decline`, `cancel` (no MCP tool needed) | `session/request_permission` | None in headless: what `permissions.allow` doesn't grant is soft-denied. Hooks (`PreToolUse` in `.agents/hooks.json`) could ask the companion, but a hook times out at 60 s by default and its allow is reported ignored under `request-review` |
| Modes | `default`, `acceptEdits`, `auto`, `plan`, `dontAsk` | `approvalPolicy` and `sandbox` per thread or turn; `--approve-for-me`-style automatic review comes nearest to `auto` | `allow`, `ask`, `deny` per tool and per bash pattern; `--auto`; a `plan` agent | `request-review` (default) or `always-proceed` |
| Model and effort | `--model` alias, `--effort`; switched mid-session by control request | Per turn on `turn/start` | Per prompt (`provider/model`, variant) | `--model <slug>`, `--effort low\|medium\|high`; restart with `--conversation` to change |
| Resume | `--session-id`, `--resume` | `thread/resume` | `session/load` (to confirm opencode has it) | `--conversation <id>` |
| Only the workspace's MCP servers | `--strict-mcp-config --mcp-config .mcp.json` | MCP servers in `.codex/config.toml` (trusted projects only) or the thread's config; the user's own in `$CODEX_HOME/config.toml` (`--ignore-user-config` exists for `exec`; for the app server, unknown) | Given per session in `session/new { mcpServers }`; the user's own config still loads unless `OPENCODE_CONFIG_DIR` points elsewhere | `.agents/mcp_config.json`; the user's `~/.gemini/config/mcp_config.json` still loads, no flag found to skip it |
| Built-in tools limited | `--tools` | `enabled_tools`/`disabled_tools` for MCP; built-ins by feature flags | `permission` per tool (`edit`, `bash`, `task`, `skill`, `question`…) | `disabledTools` for MCP only |
| Instructions | `CLAUDE.md` importing `@EZAPPLY.md` and `@profile/preferences.md` | `AGENTS.md`; no import documented, so the thread's developer instructions carry `EZAPPLY.md` | `AGENTS.md`, else `CLAUDE.md`; `@` isn't parsed, so `opencode.json`'s `instructions: ["EZAPPLY.md", "profile/preferences.md"]` | `AGENTS.md` or `GEMINI.md`; `@[label](path)` inlines a file |
| Skills | `.claude/skills/` | Skills folders (`.agents/skills/` in the repo, to confirm); invoked by a `skill` input item or `$name` | `.claude/skills/` read for compatibility (`OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` turns it off) | `.agents/skills/` |
| Long MCP calls (`ask_user` up to 15 min) | Held in `-p` | `tool_timeout_sec` defaults to 60: set it above 15 minutes for the ezapply server | `timeout` is only for listing tools; a call's limit is unknown | Unknown; `--print-timeout` (5 m default) must be raised or confirmed per turn |
| `EZAPPLY_SESSION` reaching the relay | Inherited | Not inherited by default: `env_vars = ["EZAPPLY_SESSION"]`, or the value in the server's `env` | In `session/new`'s `mcpServers[].env` | Unknown whether inherited; the `env` in `.agents/mcp_config.json` is a file, rewritten before each start (one process runs at a time) |
| Cost | `total_cost_usd` | Tokens (`turn/completed` usage) | Per-message cost and tokens | Tokens (`usage`) |
| Login | Subscription | ChatGPT login or API key | Its providers' keys or logins | Cached Google login; signing in once interactively first. A forum answer (not documentation) says orchestrating it over stdio uses the same entitlements |

## Antigravity on Windows

Two open reports hit ezapply's exact use: print mode on Windows ignoring `permissions.allow` and hanging on a
prompted tool call (google-antigravity/antigravity-cli#548), and print mode printing nothing when stdout is a
pipe (#76; a community workaround reads the answer from the CLI's conversation store). Build its backend once
both are fixed, and without approvals: the panel offers only a "Don't ask" mode, with the workspace's allow
rules (`mcp(ezapply/*)`, the commands the skills run) written by `init`. Writes inside the workspace are always
allowed there, so the deny on `repo-cache/` must become a hook or be dropped for this agent.

## Changes in ezapply

- **`philosophy.md`:** principle 1 becomes "the user's coding agent is the only agent". `agent.md`'s
  "Why headless Claude Code" gains the per-agent choice of entry point above.
- **`companion/src/agent/`:** an `AgentBackend` interface (start or resume a conversation, send, stop, change
  settings, answer an approval, close; a stream of `AgentEvent`) that `AgentService` drives. `process.ts` and
  `stream.ts` become the Claude Code backend unchanged. Each new backend has its own reader into `AgentEvent`.
  Approvals from Codex and opencode become the same approval cards (`NeedsYou`) without `permission_ask`.
- **`AgentSettings`:** `{ agent, permissionMode, model, effort }`, each backend saying which modes, models and
  efforts it has; a setting another agent doesn't have falls back to its default. `ezapply` finds the chosen
  agent's executable as `findClaude` does Claude's, and `doctor` checks it.
- **`ezapply init`:** writes each installed agent's files from one source: `AGENTS.md` (the import line, or
  the agent's own way to load `EZAPPLY.md`), the skills into `.agents/skills/` as well as `.claude/skills/`, the
  MCP entry into `.codex/config.toml`, `opencode.json` and `.agents/mcp_config.json`, and the permission rules in
  each one's format (the python and `repo-cache/` denies, `debug/` reads).
- **The skills and `EZAPPLY.md`:** name no Claude Code tool (the Edit tool, `Agent` subagents, `ToolSearch`,
  "Claude Code defers ezapply's tools"). This is why the item waits for "Refactor the skills".
- **The panel:** an agent picker beside the model; cost shown as tokens where the agent gives no cost.
- **`workspace_check` and the panel's setup:** "agent file" checks the chosen agent's instructions file.

## Order

1. The interface, with Claude Code's backend moved behind it and its tests passing unchanged.
2. Codex through the app server: the closest fit, approvals native.
3. opencode through ACP.
4. Antigravity, once its Windows reports are closed.

## Open questions to run live, per agent

- A message sent mid-turn: taken in the same turn, queued, or refused.
- An MCP call held 15 minutes (`ask_user`): not timed out, and a stop during it ends the turn.
- `EZAPPLY_SESSION` (or its replacement) reaching the relay.
- The user's own MCP servers, rules and skills kept out, and the tokens a one-message turn starts with.
- An approval denied with a reason: the reason reaches the model word for word.

## Tests

- `agent.test.ts` per backend: recorded lines (values replaced) into `AgentEvent`s, as Claude Code's are pinned.
- A backend contract test run against each backend with a fake agent process: start, send, stop, approval
  allow and deny, resume, a setting changed mid-conversation.
- `workspace-init` writes each agent's files, keeps the user's entries, and `skill-calls.test.ts` covers the
  skills in their second folder.
