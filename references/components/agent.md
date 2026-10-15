# The agent behind the panel (`companion/src/agent/`)

The companion runs Claude Code headless and relays what it does, so the user can work with it from the
extension's side panel instead of a terminal. Claude Code is still the
only agent: the same `claude`, login, workspace, `EZAPPLY.md`, skills, `.mcp.json` and permission rules as
running `claude` in the workspace by hand, without the user's own Claude Code setup ([below](#the-process-processts));
the companion only starts it, writes the user's messages to it and reads what it does.

It runs under `ezapply` ([cli](cli.md#ezapply-panelts)), which passes Claude Code to the companion
(`CompanionOptions.claude`; `ezapply` won't start without it). A companion without it (tests) has an
`unavailable` agent: `AgentService.state()` says so, and so does the panel.

| Path | Role |
|---|---|
| `agent/process.ts` | `AgentProcess`: one conversation's Claude Code process, messages in, stream items out; `agentArgs`; `PANEL_PROMPT` and `PART_PROMPTS`; `findClaude` (also used by `ezapply`); `PERMISSION_TOOL`; `SESSION_ENV`, `SESSION_HEADER` and `sessionId` ([sessions](companion.md#sessions)) |
| `agent/panel.ts` | `PanelService`: the side panel's methods (state, a conversation with its posting and documents, what a tab is, send, answers) and the updates pushed to it ([below](#the-panels-side-panelts)) |
| `agent/stream.ts` | `readStreamLine`: a line of stream-json into events for the panel; `toolSummary` |
| `agent/service.ts` | `AgentService`: the conversations, one live process, history, Stop, Reset, forgetting a posting's, the permission mode and model |
| `agent/needs.ts` | `NeedsYou`: the cards (questions and approvals) waiting on the user |
| `mcp/tools/agent.ts` | `ask_user` and `permission_ask` ([mcp-tools](../mcp-tools.md#the-panel)) |
| `protocol/src/panel.ts` | The shared types: `AgentEvent`, `AskSpec` and its checks (`askSpecProblems`, `askAnswerProblems`), `Card`, `AgentStatus`, the conversation keys (`GENERAL_CONVERSATION`, `ConversationPart`, `conversationKey`, `postingConversation`); the panel's bridge methods (`PanelMethods`), `PanelState`, `PanelConversation`, `PanelTab`, `PanelUpdate` |

**Why headless Claude Code, and why this way.** *Rejected:* the Claude Agent SDK (the same harness as a library and
a dependency; its `canUseTool` callback is the host protocol `--permission-prompt-tool` gives the CLI); an agent
loop of ezapply's own over the API (the "only agent" principle lost, with the skills, subagents and permissions);
channels (`notifications/claude/channel`), which push messages into an interactive session: a research preview,
stdio servers only, a custom channel needs `--dangerously-load-development-channels` with a warning dialog at every
start, and `-p` ignores it; keeping the interactive session and waiting on a blocking tool: permission prompts and Claude's questions would still be in the terminal.

**Long waits.** An interactive session moves an MCP call still running after 2 minutes into a background task;
`-p` doesn't, so `ask_user`, `permission_ask` and `review_documents` hold the turn until answered. What still
applies: a call with no response and no progress for 30 minutes is aborted (the idle window for a stdio server,
which the relay is to Claude; `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes it), and `MCP_TOOL_TIMEOUT` caps any call
(about 28 hours by default). The waiting tools return after at most 15 minutes and are called again, so neither is
reached.

## The process (`process.ts`)
`claude` with these arguments (`agentArgs`), in the workspace:

| Argument | Why |
|---|---|
| `-p --input-format stream-json --output-format stream-json --verbose` | Messages go in on stdin as JSON lines (`{ type: "user", message: { role, content } }`) and the process stays up between turns while stdin is open, so a conversation is one process, not one per message. `--verbose` is required for stream-json output |
| `--replay-user-messages` | Each message is echoed (`isReplay: true`) when Claude takes it, so the panel can show it as taken |
| `--permission-mode <mode>` `--model <alias>` `--effort <level>` | The panel's settings ([below](#permission-mode-model-and-effort)), always given, so the user's own Claude Code defaults don't decide them behind the panel |
| `--permission-prompt-tool mcp__ezapply__permission_ask` | What would prompt in the terminal asks the panel instead ([cards](#cards-needsts)) |
| `--strict-mcp-config --mcp-config .mcp.json` | Only the workspace's MCP servers: not the user's own, claude.ai connectors among them |
| `--setting-sources project,local` | The workspace's settings (its permission rules, and the approvals saved in `settings.local.json`), not the user's: no user-level plugins or skills. The subscription login isn't a setting and still applies, and so do managed (organization) settings. So do none of the user's own permission rules in `~/.claude/settings.json`: in the panel only the workspace's rules stand |
| `--tools <shell>,Read,Edit,Write,Glob,Grep,Skill,ToolSearch,Agent` | Only the built-in tools the panel's work uses (`PANEL_TOOLS`), with one shell (`panelShell`): Bash, or PowerShell on Windows without Git Bash (Claude Code's Bash needs it). Not AskUserQuestion: questions go through `ask_user`, since Claude Code's own tool holds 1 to 4 questions of 2 to 4 options and no text entry, and one step of an application can have a dozen. Agent stays for repo indexing and other large reading jobs |
| `--append-system-prompt <PANEL_PROMPT>` | Where its words go: the user reads them in a narrow panel and never sees a terminal; questions go on `ask_user` cards, commands are approved in the panel. A posting's conversation also gets its part's line (`PART_PROMPTS`, [below](#conversations-servicets)). The skills say the rest |
| `--session-id <uuid>` / `--resume <uuid>` | A new conversation's session, or the one it had |

Not `--bare`: bare mode skips the workspace's skills, `.mcp.json`, settings and `CLAUDE.md`, and doesn't use a
subscription login.

**Why the user's setup stays out.** The starting context is re-read on every API call, and most of it was the
user's: in a one-message run in a workspace (Claude Code 2.1), the defaults started at about 41.8k tokens and these arguments at
about 19.5k, mostly from `--tools` (each shell's schema alone is several thousand tokens, so one shell, not both).
Beyond the tokens, a document skill of the user's that claims resumes and cover letters competed with ezapply's
skills. Bash rather than PowerShell where both exist because the workspace's deny rules and the agent's habits are
Bash's (`init` writes the python denies for both).

The environment gets `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` (Claude Code's bundled skills: about 2.5k tokens, none
of them the panel's) and `EZAPPLY_SESSION=<session id>`, which the MCP relay sends as
`x-ezapply-session`, so the companion knows which conversation a tool call (an `ask_user`) comes from, and
loses `CLAUDE_AUTO_BACKGROUND_TASKS`: in `-p` a long MCP call holds the turn, as `ask_user` and `review_documents`
need, unless that variable is set, which would end the turn with the question open.

**Stop** writes `{ type: "control_request", request_id, request: { subtype: "interrupt" } }`; Claude Code answers
with a `control_response` and ends the turn (`terminal_reason: "aborted_tools"`). A tool call running then gets a
"rejected" result: a form call already sent still finishes in the companion and on the page, but Claude doesn't
see its result (the next `get_form` shows the page as it is). Stop doesn't wait for a running form call to end:
the user pressed Stop to stop, and whatever the call did to the form stays on the
page for them to see. Not SIGTERM, which leaves the turn unfinished with no
result. **Closing** ends stdin (the process exits once idle) and kills it after a grace period (10 s; 3 s when
the companion stops): the tree with `taskkill /T /F` on Windows, elsewhere SIGTERM then SIGKILL to `claude`
itself. Reset and Forget kill at once. A message written while a tool call runs is taken when the call ends, in
the same turn.

Verified against Claude Code 2.1 with a throwaway MCP server: a message sent
mid-call was answered in the same turn, an interrupt ended the turn and the process went on to the next message,
the permission tool got `{ tool_name, input, tool_use_id }` for a command that needed approval and its deny message
reached Claude word for word, with `AskUserQuestion` unavailable Claude asked in text, and `total_cost_usd` in each
`result` is the session's total so far.

## The stream (`stream.ts`)
Only these fields are read, so a line of a kind it doesn't know is skipped rather than failing the conversation:
`system/init` (`session_id`, `mcp_servers[] { name, status }`, at the start of every turn), `assistant` blocks
(`text`, `tool_use { id, name, input }`, `parent_tool_use_id` for a subagent's), `user` (a replayed message, or
`tool_result { tool_use_id, is_error, content }`), `result` (`is_error`, `total_cost_usd`, `duration_ms`,
`terminal_reason`, `queued_turn_count`, `result`), `system/api_retry` and `control_response`. Thinking, rate-limit
and summary lines are skipped. They become `AgentEvent`s: `user` (with `taken`), `text`, `tool` (folded to one
line by `toolSummary`: the command, the file, the skill; for ezapply's form tools what a person reads (`fill_fields`:
"3 fields", `upload_file`: the file's name, `page_action`: the action, `ask_user`: the card's title); any other MCP
tool's arguments cut to 160 characters),
`toolDone` (with the start of its error), `card`, `turnEnd` (cost, duration, `interrupted`, error) and `notice`.
`agent.test.ts` pins the fields on lines shaped as recorded, with the values replaced.

## Conversations (`service.ts`)
Two per posting, keyed `<posting id>/tailor` (its documents) and `<posting id>/fill` (its application), and one
`general`. **Why two per posting:** tailoring and filling are separate work, whichever the user starts first, and
in one conversation each was re-sent with every turn of the other (a long form's reads behind each document edit,
and the documents' drafting behind each step). What one needs of the other is on disk: the documents and their
approvals, `notes.md`, the form log. Each part's line in the system prompt (`PART_PROMPTS`) keeps it to its work:
the tailoring conversation doesn't touch application forms, and the filling one doesn't write or edit documents,
though it may show the ones there for review and attach them; each tells the user to press the other's button
for the rest. An older build kept one conversation per posting under the bare id; the first time the service
reads its file in a run, such a conversation becomes the posting's tailoring one, its logs moved to
`<posting id>/tailor/`, so its history stays in the panel. One process runs at a time: sending to another conversation closes an
idle process, and is refused while it works ("Claude is still working in another conversation"), since two agents
filling forms or editing one posting's files would collide. Sending:
- starts the conversation's process when none runs, with `--resume` once Claude Code has had its session (it
  answered once: `started`), else `--session-id`;
- **while a card of that conversation is open, answers the card instead.** Claude is then inside the tool call
  that asked and would take the message only when that call ends (up to 10 minutes later). So a typed message is a
  question's reply (`ask_user` returns `{ replied, message }`) or an approval's deny, with the message as its
  reason, as typing does at Claude Code's own prompts.

**Reset** (`reset(key)`) ends the conversation's process, withdraws its open cards, and gives it a new session;
the old one goes to `earlier` (kept for `claude --resume`; the newest 50). What's on disk carries over (documents,
`notes.md`, approvals, the form log); the conversation doesn't. **A session that can't be resumed** (Claude Code
exits before answering, its transcript gone) is replaced by a new one once, with the waiting messages sent again
and a notice. Claude Code stopping mid-turn is a notice with the first line it wrote to stderr. The first `init`
of a process is checked for the `ezapply` MCP server: anything but `connected` is an error notice ("Run `ezapply
init` in the workspace, then Reset this conversation"), since the agent would have none of its tools.

**Forget** (`forgetPosting(id)`, when the panel deletes a posting) ends the process of either of the posting's
conversations, withdraws their open cards, removes them from `conversations.json` and deletes the posting's folder
of logs (`agent/<id>/`). Nothing is kept for `claude --resume`, since the posting they were about is gone.

## Permission mode, model and effort
Chosen in the panel, under the chat bar, for every conversation: `AgentSettings { permissionMode, model, effort }`,
kept in the workspace's `agent/settings.json`, so they hold across Reset and a restart of ezapply. The defaults
(`DEFAULT_AGENT_SETTINGS`) are Auto, Sonnet and medium effort.

| Mode | The panel says | Does |
|---|---|---|
| `default` | Ask first | Claude asks on the panel before commands and edits the workspace's permission rules don't allow |
| `acceptEdits` | Accept edits | File edits go ahead without asking; commands still ask |
| `auto` (default) | Auto | Claude Code's classifier decides what runs without asking, so few approval cards come up |
| `plan` | Plan only | Claude reads and plans, and changes nothing |
| `dontAsk` | Don't ask | Only what the rules allow runs; anything else is denied without asking |

Models: the aliases `fable`, `opus`, `sonnet` (default), `haiku`, each the latest of its family (`sonnet` is
Sonnet 5.5 with Claude Code 2.1). Effort: `low`, `medium` (default), `high`, `xhigh`, `max` (Claude Code's
`--effort`). Each setting is read on its own, so one an older build kept that's no longer offered (`model:
"default"`) falls back to its default alone.
*Not offered:* `bypassPermissions`. Postings are untrusted text, and the approval cards are what stands between
a prompt injected into one and a command run on the user's machine; Claude Code also refuses to switch a session to
it unless it was launched with `--dangerously-skip-permissions`. A model's full name isn't offered either: the
aliases follow new releases, and a fixed list can't be mistyped.

**A change applies to the running conversation** (`setSettings`), after it's written. The mode and model at once:
the process gets Claude Code's control requests `{ subtype: "set_permission_mode", mode }` and `{ subtype:
"set_model", model }`, which Claude Code 2.1 takes mid-session, between tool calls. A refusal (`control_response`
with `subtype: "error"`) is a notice in that conversation ("Claude Code didn't switch the …"); the setting stays
kept and applies when the conversation next starts. **Effort from the next message:** Claude Code has no
`set_effort`, and its `apply_flag_settings { effortLevel }` is accepted but wasn't seen to change how much a turn
thinks, so the process ends (at once when idle, after its turn while it works) and the next message resumes the
session with the new `--effort`. Processes start with the settings as flags.

**On disk**, in the workspace's `agent/` ([format](../data-formats.md#agent)): `conversations.json`, `settings.json`
and each session's events, `<conversation>/<session>.jsonl`. `history(key)` reads the current session's, a message's latest
state winning (it's written again when taken).

## Cards (`needs.ts`)
What waits on the user. **Questions** (`ask_user`): a card holds an `AskSpec` (title, intro, 1 to 25 questions,
each `single`, `multi` or `text`, with options, a free-text Other, a suggestion and where it came from,
`sensitive`, `required`, an offer to save the answer). `askSpecProblems` refuses what the schema can't (options for
choice questions, a suggestion that isn't one of them unless Other is allowed, an id twice, min over max);
`askAnswerProblems` checks the answers (required ones, values on the list unless Other, how many, only questions
asked). A **sensitive question may carry a suggestion** like any other: the card flags it and shows where the
suggestion came from, and nothing is filled until the user sends the card. An answer given while nothing waits is
kept and read once by the next wait. **Approvals** (`permission_ask`): a card with the tool, its input and Claude's
description; the decision resolves the waiting call, allow with the input unchanged, deny with "The user denied
this in the ezapply panel: <reason>"; no answer in 10 minutes is a deny. There's no "always allow": the workspace's
permission rules are the only standing approvals.

A question from a Claude Code run by hand in the workspace (no session header) gets a card only when a panel watches the cards (`watch()`); otherwise `ask_user` says to
ask in chat, and `permission_ask` denies. A panel conversation's question always gets a card. Settled cards are
recorded in their conversation as a `card` event (answered, replied in the chat, allowed, denied, timed out,
withdrawn).

## The panel's side (`panel.ts`)
`PanelService` is what the side panel reaches, only through the paired extension: the bridge methods `panel.*`
(`PanelMethods` in the protocol; [extension](extension.md#the-side-panel) relays them), so it needs no token of its
own and no web page can reach it.

| Method | Does |
|---|---|
| `panel.watch { open }` | How many panels are open, sent by the extension on every change and on connecting. While more than none, cards are shown (`NeedsYou.watch`) and updates pushed; the extension disconnecting ends it |
| `panel.state` | `PanelState`: the agent's status, the active posting, the 20 newest postings, the open cards, and setup (`workspace_check`'s required steps left; kept 30 s, as it runs TeX and GitHub checks) |
| `panel.conversation { key }` | `PanelConversation`: the session's events (`history`), its cost, and for either of a posting's conversations its card (company, role, site, status, deadline, up to six bullet lines under `## Application requirements` in `notes.md`, the application's address), its PDFs with where each stands (`draft`, `review`, `approved`, `changes`, `attached`: `ReviewService.documentStates` by their bytes; `attached` when an approved one has an upload in the form log; only PDFs at the top of the posting's folder), and a review waiting on the user |
| `panel.tab { tabId, url, title, site }` | What the tab is to the active posting: its page (`posting`), its application (`application`, by `matchPosting` as the form tools decide), another posting's (`other-application`), an application not known to be its (`unconfirmed-application`), another page, or no web page |
| `panel.send { key, text }` | The user's message to a conversation (`general`, or a posting's `tailor` or `fill`); a posting's makes its posting active first, since the skills work on the active one |
| `panel.stop`, `panel.reset { key }` | Stop the turn; a new session for the conversation |
| `panel.settings { permissionMode?, model?, effort? }` | Change the agent's settings ([above](#permission-mode-model-and-effort)); returns them. `panel.state` carries them as `agent.settings` |
| `panel.answer { cardId, answers }`, `panel.reply { cardId, message }`, `panel.permission { cardId, allow, reason? }` | A card's answers (checked against its questions), a reply in words instead, an approval's decision |
| `panel.activate { postingId }` | Make a posting active (the panel's picker) |
| `panel.deletePosting { postingId }` | Delete a posting for good: its conversations (`forgetPosting`), then its folder (`PostingsService.delete`). Refused while it has a review open |
| `panel.deleteDocument { postingId, file }` | Delete one of the PDFs the panel lists for the posting, and nothing else (any other name is `not_found`). The `.tex` source stays, so Claude can build it again. Refused while the PDF is in an open review |
| `panel.open { what }` | Open for the user, in the extension's browser: a review's tab again (`reviewId`), a posting's file (only inside its folder), or the setup page |

**Updates** (`panel.update`, the companion calling the extension): each agent event with its conversation, and
`changed` when the panel's state may have changed (the agent's state, a card, the active posting, a review),
coalesced over 50 ms; both only while a panel watches, and only while the extension is connected (an update is
never waited for). The number of open cards (`cards`) is pushed on every change of the cards even while no panel
is open: the toolbar badge shows it.

**Setup tasks** go to the agent as messages to the general conversation ([ui](ui.md#the-agents-side-tasks)).

## Open questions
- Chrome's side panel is per window: two windows show the same conversations and cards, and either can answer a
  card. The first answer settles it; the other gets "No open approval" (or question), and its panel drops the card
  with the next update. Whether a second window should say more than that.
- Cost is Claude Code's estimate; whether to warn before a turn of a long-resumed session.
