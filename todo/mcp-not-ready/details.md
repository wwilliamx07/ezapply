# The panel's agent stops when ezapply's tools aren't connected yet: details

- What it looks like in Claude Code's transcript: the turn's first call is `ToolSearch { query: "ezapply
  posting_active" }`, its result is the error above, and a `deferred_tools_delta` with the ezapply tools follows
  in the same second. The companion logs `agent: Claude Code exited mid-turn` with code 1.
- `system/init` (`agent/stream.ts`) carries `mcp_servers[] { name, status }`, but it comes at the start of a turn,
  after the message has gone, so it can't be used to hold the message back. It can tell a retry was the cause.
- Keeping the user's claude.ai connectors out of the process (in "Cut the tokens a panel conversation spends") makes
  this error message shorter but doesn't remove the race: the ezapply server is still the slow one.
- Only retry when nothing ran: a turn that already made tool calls isn't sent again.

**References when built:** `components/agent.md` (the process and its arguments).
