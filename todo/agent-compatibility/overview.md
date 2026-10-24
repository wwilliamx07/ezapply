# Compatibility with opencode

**What.** The side panel can run opencode as well as Claude Code, Antigravity and Codex, with the same workspace,
tools, skills and approval cards.

**Why.** Users have different agents; tying ezapply to a few limits who can use it.

**Does the panel's approach carry over?** Yes, as it did for Codex: the companion starts opencode in the
workspace, keeps one process per conversation, writes the user's messages to it and reads what it does. Not
through its print mode, which runs one prompt per process, but its ACP server (Agent Client Protocol, over stdio),
which has sessions, cancelling, approvals sent to the client, and MCP servers given per session.

**Plan.**
- Start with a live run of the open questions in the details.
- opencode's approvals become the panel's approval cards; its modes, models and efforts are the panel's offer.
- Write its MCP config and permission rules into the workspace.
- Check the chosen agent's instructions file, not only Claude Code's.

[details](details.md)
