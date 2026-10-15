# The panel's agent stops when ezapply's tools aren't connected yet

**What.** A conversation can end at its first tool call with "Claude Code stopped unexpectedly: MCP tool
mcp__ezapply__permission_ask (passed via --permission-prompt-tool) not found", listing only the user's claude.ai
connectors.

**Why.** Claude Code connects MCP servers in the background and starts the turn before they're up. The claude.ai
connectors come up at once; the ezapply server is `node … mcp` (the relay), which took a few seconds to start on
Windows and now takes about 0.25 s ([cli](../../references/components/cli.md#commands)). A first tool call made in
that window, a `ToolSearch` for the ezapply tools, has Claude Code check
`--permission-prompt-tool`, find no such tool, and exit. The ezapply tools arrive a moment later.

**Plan.**
1. Check in a live run whether the race still shows now that the relay starts fast; the rest only if it does.
2. When a process exits before taking its first message and its stderr names the permission prompt tool, start it
   again (resuming the session) and send the message again, once.
3. Find out from the installed Claude Code whether `-p` can be made to wait for MCP servers before the first turn
   (an environment variable or setting), and use it in `AgentProcess` if so.
4. A test with the stub that exits that way.

[details](details.md)
