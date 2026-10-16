# Switching agents is slow, and Antigravity flashes a console window

**What.** Two rough edges of the panel's agent on Windows:
- Changing the agent (or a setting that restarts it) takes seconds before the panel shows the change, and the next
  message waits again while the new agent starts.
- When a conversation with Antigravity starts, a terminal window opens and closes.

**Why.**
- The settings change answers only after the running agent has exited (it is asked to finish and given up to ten
  seconds), and the panel's dropdown shows the companion's value, so it keeps the old agent until that answer and a
  fresh state read arrive. The new agent then starts cold on the next message: the process, then its connection to
  ezapply's tools, a few seconds more.
- The window isn't ezapply's: each time the Antigravity CLI starts (at most once every 15
  minutes), it launches its own background auto-updater in a new console, which Windows Terminal shows as a window. The panel's hidden-window launch reaches
  the CLI and the tools server it starts, not that updater.

**Plan.**
- Answer a settings change at once and let the old process close in the background; the dropdown shows the choice
  while it's saved.
- Start Antigravity with its auto-update turned off (it reads an environment variable for that); the user updates
  it themselves.
- Optionally warm the new agent's process for the open conversation as soon as it's chosen.

[details](details.md)
