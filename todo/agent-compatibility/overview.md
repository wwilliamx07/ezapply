# Compatibility with various agents

**What.** The side panel can run Codex, opencode or the Antigravity CLI instead of Claude Code, with the same
workspace, tools, skills and approval cards.

**Why.** Users have different agents; tying ezapply to one limits who can use it.

**Does the panel's approach carry over?** The approach (the companion starts the agent headless in the
workspace, keeps one process per conversation, writes the user's messages to it and reads what it does) works for
all three, but print mode itself fits only Antigravity:
- **Codex:** its print mode runs one prompt per process and can't ask for approval. Its app server can: a
  long-lived process over stdio that takes follow-up messages, stops a turn, and sends each approval to the
  client to decide. It fits the panel better than Claude Code's print mode does.
- **opencode:** its print mode is also one prompt per process. Its ACP server (Agent Client Protocol, over
  stdio) has sessions, cancelling, approvals sent to the client, and MCP servers given per session.
- **Antigravity:** its print mode is a near copy of Claude Code's (JSON lines in and out, one process for many
  turns), but it can't ask anyone for approval: what its settings don't allow is denied. On Windows it has open
  reports of hanging and of printing nothing when its output is piped, which is how the companion reads it.

**Plan.**
1. Change "Claude Code is the only agent" in the philosophy to "the user's coding agent is the only agent".
2. Put the agent behind one interface in the companion, with Claude Code's the first backend.
3. Write the workspace for each agent: its instructions file, skill folder, MCP config and permission rules.
4. Add Codex, then opencode, then Antigravity once its Windows problems are fixed. Each starts with a live run
   of the open questions in its details.
5. The panel offers each agent's own models, modes and efforts, and shows tokens where an agent gives no cost.

[details](details.md)
