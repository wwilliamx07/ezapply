# The panel's agent stops when ezapply's tools aren't connected yet: details

- What it looks like in Claude Code's transcript: the turn's first call is `ToolSearch { query: "ezapply
  posting_get" }`, its result is that error, and a `deferred_tools_delta` with the ezapply tools follows
  in the same second. The companion logs `agent: exited mid-turn` with code 1.
- `system/init` (`agent/stream.ts`) carries `mcp_servers[] { name, status }`, but it comes at the start of a turn,
  after the message has gone, so it can't be used to hold the message back. It can tell a retry was the cause.
- The full error: "Claude Code stopped unexpectedly: MCP tool mcp__ezapply__permission_ask (passed via
  --permission-prompt-tool) not found". The server is `node … mcp` (the relay). A way to make `-p` wait (an
  environment variable or setting) goes into `AgentProcess`.
- Only retry when nothing ran: a turn that already made tool calls isn't sent again.

**References when built:** `components/agent.md` (the process and its arguments).
