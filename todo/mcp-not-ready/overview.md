# The panel's agent stops when ezapply's tools aren't connected yet

**What.** A conversation can end at its first tool call with "Claude Code stopped unexpectedly": the permission
prompt tool it was started with isn't found.

**Why.** Claude Code connects MCP servers in the background and starts the turn before they're up. A first tool
call made before ezapply's server is connected has Claude Code look for its permission prompt tool, find none, and
exit; ezapply's tools arrive a moment later. The server starts in about a quarter of a second
([cli](../../references/components/cli.md#commands)), which may already close the window.

**Plan.**
- Check in a live run whether the race still shows; the rest only if it does.
- When a process exits before taking its first message, naming the permission prompt tool, start it again
  (resuming the session) and send the message again, once.
- Find out whether Claude Code can be made to wait for its MCP servers before the first turn, and use it if so.
- A test with a stub that exits that way.

[details](details.md)
