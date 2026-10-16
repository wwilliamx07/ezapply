# Switching agents is slow, and Antigravity flashes a console window: details

## The slow switch
- `AgentService.setSettings` (`companion/src/agent/service.ts`) `await`s `closeLive()` when the change restarts the
  process (agent, effort, or a mode change for an agent with `switches: false`) and it's idle. `closeLive` →
  `LineProcess.close` (`agent/child.ts`) ends stdin and waits for the exit, killing after `graceMs` (10 s default).
  `agy` exits about a second after stdin closes; Claude Code can take longer.
- The panel's `AgentSettingsBar` (`ui/src/panel/App.tsx`) is controlled by `state.agent.settings`; `onChange` calls
  `panel.settings`, then `refreshState()`. Nothing changes on screen until both return, and `panel.state` also lists
  the postings.
- The next message cold-starts the new backend. Measured with `agy` 1.4: its MCP server (`node … mcp`) is spawned
  only when the first message arrives, 2–3 s after it.

**Fix.**
1. `setSettings`: `void this.closeLive()` instead of awaiting it. Safe: `closeLive` clears `this.live` first, so a
   message sent meanwhile starts a new process; `onExit` of the old one only touches `this.live` when it's still it.
2. `AgentSettingsBar`: keep a pending value (shown until the next state read) so the dropdown moves at once.
3. Optional: after an agent change, start the backend for the panel's open conversation without a message (Claude
   Code's stream-json process starts its MCP servers at launch; `agy` connects only on the first message, so this
   helps Claude Code more).

**Tests.** `agent.test.ts`: `setSettings` resolves before a stub process that ignores stdin EOF has exited, and a
message sent right after starts a new process. `panel.test.tsx`: the agent dropdown shows the new value before the
call resolves.

## The console window
- Watched with a WMI process-creation query while `agy` ran one turn: `agy` spawns `agy --bg-updater …` (which runs
  `agy --version`), and `OpenConsole.exe -Embedding` (Windows Terminal hosting a new console) starts in the same
  instant. Nothing else `agy` spawns gets a console: the MCP server inherits `agy`'s hidden one. The updater skips
  itself when its last check was under 15 minutes ago (`~/.gemini/antigravity-cli/last_check.timestamp`), which is
  why the window doesn't show on every start.
- The binary reads `AGY_CLI_DISABLE_AUTO_UPDATE` ("Auto-update disabled via environment variable"). Not yet verified
  that it stops the spawn: verify with the WMI watcher after the 15-minute window has passed.

**Fix.** `AntigravityProcess` (`agent/antigravity.ts`): add `AGY_CLI_DISABLE_AUTO_UPDATE: "1"` to the env beside
`SESSION_ENV`, with a comment saying why. Test: `antigravity.test.ts` checks the stub received the variable. If the
variable doesn't work, the fallback is the same as the user's own setting, if `agy` has one, else to accept the flash
and document it.

**References when built:** `components/agent.md` (Antigravity's environment; settings changes don't wait for the
old process), `components/ui.md` (the settings bar).
