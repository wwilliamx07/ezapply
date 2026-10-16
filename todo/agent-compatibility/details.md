# Compatibility with various agents: details

From each agent's documentation as of October 2026; nothing here has been run yet. Each backend starts with a
live run of its open questions (below), with a throwaway MCP server, as Claude Code's were verified
([agent](../../references/components/agent.md#the-process-processts)) and Antigravity's were
([agent](../../references/components/agent.md#antigravity-antigravityts)).

## What the panel needs from an agent

What `AgentService` and the workspace rely on, as Claude Code gives it, and what Codex and opencode offer.

| Needs | Claude Code | Codex | opencode |
|---|---|---|---|
| Headless entry point | `claude -p`, stream-json in and out | `codex app-server` (JSON-RPC over stdio). Not `codex exec`: one prompt per process, approvals impossible | `opencode acp` (ACP over stdio). Not `opencode run`: one prompt per process. `opencode serve` (HTTP, SSE) also works but needs a port and a password |
| Many turns in one process | Yes | `thread/start`, then `turn/start` per message | `session/new`, then `session/prompt` per message |
| A message mid-turn | Queued, taken in the same turn | `turn/steer { expectedTurnId }` | Unknown: whether a second `session/prompt` queues |
| Stop | `control_request` interrupt | `turn/interrupt` (turn ends `interrupted`) | `session/cancel` |
| Approvals to the panel | `--permission-prompt-tool` (an MCP tool) | Server requests `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`, answered `accept`, `decline`, `cancel` (no MCP tool needed) | `session/request_permission` |
| Modes | `default`, `acceptEdits`, `auto`, `plan`, `dontAsk` | `approvalPolicy` and `sandbox` per thread or turn; `--approve-for-me`-style automatic review comes nearest to `auto` | `allow`, `ask`, `deny` per tool and per bash pattern; `--auto`; a `plan` agent |
| Model and effort | `--model` alias, `--effort`; switched mid-session by control request | Per turn on `turn/start` | Per prompt (`provider/model`, variant) |
| Resume | `--session-id`, `--resume` | `thread/resume` | `session/load` (to confirm opencode has it) |
| Only the workspace's MCP servers | `--strict-mcp-config --mcp-config .mcp.json` | MCP servers in `.codex/config.toml` (trusted projects only) or the thread's config; the user's own in `$CODEX_HOME/config.toml` (`--ignore-user-config` exists for `exec`; for the app server, unknown) | Given per session in `session/new { mcpServers }`; the user's own config still loads unless `OPENCODE_CONFIG_DIR` points elsewhere |
| Built-in tools limited | `--tools` | `enabled_tools`/`disabled_tools` for MCP; built-ins by feature flags | `permission` per tool (`edit`, `bash`, `task`, `skill`, `question`…) |
| Instructions | `CLAUDE.md` importing `@EZAPPLY.md` and `@profile/preferences.md` | `AGENTS.md` (written by `init` with Antigravity's include syntax); no import documented, so the thread's developer instructions carry `EZAPPLY.md` | `AGENTS.md`; `@` isn't parsed, so `opencode.json`'s `instructions: ["EZAPPLY.md", "profile/preferences.md"]` |
| Skills | `.claude/skills/` | Skills folders (`.agents/skills/` in the repo, to confirm); invoked by a `skill` input item or `$name` | `.claude/skills/` read for compatibility (`OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` turns it off) |
| Long MCP calls (`ask_user` up to 15 min) | Held in `-p` | `tool_timeout_sec` defaults to 60: set it above 15 minutes for the ezapply server | `timeout` is only for listing tools; a call's limit is unknown |
| `EZAPPLY_SESSION` reaching the relay | Inherited | Not inherited by default: `env_vars = ["EZAPPLY_SESSION"]`, or the value in the server's `env` | In `session/new`'s `mcpServers[].env` |
| Cost | `total_cost_usd` | Tokens (`turn/completed` usage) | Per-message cost and tokens |
| Login | Subscription | ChatGPT login or API key | Its providers' keys or logins |

## Changes in ezapply

- **`companion/src/agent/`:** each agent is an `AgentBackend` beside `claudeBackend` and `antigravityBackend`,
  with its own reader into `StreamItem`s; a JSON-RPC agent needs a request/response layer over `LineProcess`.
  Approvals from Codex and opencode become the same approval cards (`NeedsYou`) without `permission_ask`, so
  `AgentSessionOptions` gains a way to raise a card and wait for its decision. `AgentKind` gains `codex` and
  `opencode`.
- **`AgentSettings`:** each backend says which modes, models and efforts it has, and the panel shows those rather
  than the Claude-or-Antigravity cases it has now; a setting another agent doesn't have falls back to its default.
  `ezapply` finds each agent's executable with `findCommand`, and `doctor` lists the agents found.
- **`ezapply init`:** the MCP entry into `.codex/config.toml` and `opencode.json`, and the permission rules in
  each one's format (the python and `repo-cache/` denies, `debug/` reads).
- **The skills and `EZAPPLY.md`:** name no Claude Code tool (the Edit tool, `Agent` subagents, `ToolSearch`,
  "Claude Code defers ezapply's tools"). This is why the item waits for "Refactor the skills".
- **The panel:** cost shown as tokens where the agent gives no cost (Antigravity's shows none now).
- **`workspace_check` and `doctor`:** "agent file" checks the chosen agent's instructions file (`AGENTS.md` for
  every agent but Claude Code).

## Order

1. Codex through the app server: the closest fit, approvals native.
2. opencode through ACP.

## Open questions to run live, per agent

- A message sent mid-turn: taken in the same turn, queued, or refused.
- An MCP call held 15 minutes (`ask_user`): not timed out, and a stop during it ends the turn.
- `EZAPPLY_SESSION` (or its replacement) reaching the relay.
- The user's own MCP servers, rules and skills kept out, and the tokens a one-message turn starts with.
- An approval denied with a reason: the reason reaches the model word for word.

## Tests

- Per backend, recorded lines (values replaced) into `AgentEvent`s, as `agent.test.ts` and `antigravity.test.ts`
  pin Claude Code's and Antigravity's.
- A backend contract test run against each backend with a fake agent process: start, send, stop, approval
  allow and deny, resume, a setting changed mid-conversation.
- `workspace-init` writes each agent's files and keeps the user's entries.
