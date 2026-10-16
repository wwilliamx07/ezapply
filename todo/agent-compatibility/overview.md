# Compatibility with various agents

**What.** The side panel can run Codex or opencode as well as Claude Code and Antigravity, with the same
workspace, tools, skills and approval cards.

**Why.** Users have different agents; tying ezapply to a few limits who can use it.

**Does the panel's approach carry over?** Yes: the companion starts the agent headless in the workspace, keeps one
process per conversation, writes the user's messages to it and reads what it does. But not through print mode:
- **Codex:** its print mode runs one prompt per process and can't ask for approval. Its app server can: a
  long-lived process over stdio that takes follow-up messages, stops a turn, and sends each approval to the
  client to decide. It fits the panel better than Claude Code's print mode does.
- **opencode:** its print mode is also one prompt per process. Its ACP server (Agent Client Protocol, over
  stdio) has sessions, cancelling, approvals sent to the client, and MCP servers given per session.

**Plan.**
1. Approvals from the agent itself become the panel's approval cards.
2. Each agent says which modes, models and efforts it has, and the panel offers those.
3. Write the workspace for each agent: its MCP config and permission rules.
4. Add Codex, then opencode. Each starts with a live run of the open questions in its details.
5. Show tokens where an agent gives no cost.

[details](details.md)
