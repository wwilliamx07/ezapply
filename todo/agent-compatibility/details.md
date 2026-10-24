# Compatibility with opencode: details

From opencode's documentation as of October 2026; nothing here has been run yet. The backend starts with a live
run of its open questions (below), with a throwaway MCP server, as Antigravity's and Codex's were
([agent](../../references/components/agent.md#codex-codexts)).

## What the panel needs, and what opencode offers

| Needs | opencode |
|---|---|
| Headless entry point | `opencode acp` (ACP over stdio). Not `opencode run`: one prompt per process. `opencode serve` (HTTP, SSE) also works but needs a port and a password |
| Many turns in one process | `session/new`, then `session/prompt` per message |
| A message mid-turn | Unknown: whether a second `session/prompt` queues |
| Stop | `session/cancel` |
| Approvals to the panel | `session/request_permission` |
| Modes | `allow`, `ask`, `deny` per tool and per bash pattern; `--auto`; a `plan` agent |
| Model and effort | Per prompt (`provider/model`, variant) |
| Resume | `session/load` (to confirm opencode has it) |
| Only the workspace's MCP servers | Given per session in `session/new { mcpServers }`; the user's own config still loads unless `OPENCODE_CONFIG_DIR` points elsewhere |
| Built-in tools limited | `permission` per tool (`edit`, `bash`, `task`, `skill`, `question`…) |
| Instructions | `AGENTS.md`; `@` isn't parsed, so `opencode.json`'s `instructions: ["EZAPPLY.md", "profile/preferences.md"]` |
| Skills | `.claude/skills/` read for compatibility (`OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` turns it off) |
| Long MCP calls (a TeX build, a repo sync) | `timeout` is only for listing tools; a call's limit is unknown |
| `EZAPPLY_SESSION` reaching the relay | In `session/new`'s `mcpServers[].env` |
| Cost | Per-message cost and tokens |
| Login | Its providers' keys or logins |

## Changes in ezapply

- **`companion/src/agent/opencode.ts`:** an `AgentBackend` beside `codexBackend`, with its own reader into
  `StreamItem`s and a JSON-RPC layer like `codex.ts`'s `Rpc`. Its permission requests go through
  `AgentSessionOptions.approve`. `AgentKind` gains `opencode`, with its row in `AGENT_MODES` and `AGENT_EFFORT`.
- **`ezapply`:** `findOpencode` (`EZAPPLY_OPENCODE`), passed to the companion as Codex's is; `doctor`'s agents check
  lists it.
- **`ezapply init`:** the MCP entry and the permission rules (the python and `repo-cache/` denies, `debug/` reads)
  in `opencode.json`, keeping the user's entries.
- **`workspace_check` and `doctor`:** "agent file" (`agentFileStatus`) checks only that `CLAUDE.md` imports
  `EZAPPLY.md`, even with another agent chosen; it should check the chosen agent's instructions file (`AGENTS.md`
  for every agent but Claude Code).

## Open questions to run live

- A message sent mid-turn: taken in the same turn, queued, or refused.
- An MCP call held past a few minutes: not timed out, and a stop during it ends the turn.
- `EZAPPLY_SESSION` reaching the relay.
- The user's own MCP servers, rules and skills kept out, and the tokens a one-message turn starts with.
- An approval denied with a reason: the reason reaches the model word for word.

## Tests

- Recorded lines (values replaced) into `AgentEvent`s through a stub ACP server, as `codex.test.ts` pins Codex's.
- `workspace-init` writes `opencode.json` and keeps the user's entries.
