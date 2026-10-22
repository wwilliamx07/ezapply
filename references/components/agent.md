# The agent behind the panel (`companion/src/agent/`)

The companion runs the user's coding agent headless and relays what it does, so the user can work with it from the
extension's side panel instead of a terminal. The agent is Claude Code or the Antigravity CLI (`agy`), chosen in
the panel ([below](#permission-mode-model-and-effort)); either is still the only agent: the same CLI, login,
workspace, `EZAPPLY.md`, skills and MCP server as running it in the workspace by hand (for Claude Code without the
user's own setup, [below](#the-process-processts)); the companion only starts it, writes the user's messages to it
and reads what it does.

It runs under `ezapply` ([cli](cli.md#ezapply-panelts)), which passes the agents it finds to the companion
(`CompanionOptions.claude`, `.antigravity`; `ezapply` won't start with neither). A companion with none (tests) has
an `unavailable` agent: `AgentService.state()` says so, and so does the panel.

**The agent behind an interface.** `AgentService` drives an `AgentBackend` (`backend.ts`), not an agent's CLI
itself: a backend starts one conversation's `AgentSession` (send, interrupt, switch the mode or model, close,
kill) and reports what it does as the `StreamItem`s of [the stream](#the-stream-streamts). Claude Code's is
`claudeBackend` (`process.ts`), whose sessions are `AgentProcess`es; Antigravity's is `antigravityBackend`
([below](#antigravity-antigravityts)). Both run their CLI through `LineProcess` (`child.ts`: JSON lines in, lines
out, the stderr tail, closing and killing the tree). The backend's `name` is what the panel's notices call the
agent ("Claude Code stopped unexpectedly"). *Why:* so each agent reads its own protocol into the same items, while
the conversations, cards and history stay one service's. Codex and opencode are still to add ("Compatibility with
various agents" in `todo/`).

| Path | Role |
|---|---|
| `agent/backend.ts` | `AgentBackend` and `AgentSession`: what the service needs of a coding agent (above) |
| `agent/child.ts` | `AgentCommand` and `findCommand` (an agent's CLI on PATH or named by a variable); `LineProcess` |
| `agent/antigravity.ts` | `antigravityBackend`, `AntigravityProcess`, `antigravityArgs`, `ANTIGRAVITY_PROMPT`, `AntigravityReader` (its stream-json into stream items), `findAntigravity` |
| `agent/process.ts` | `claudeBackend`; `AgentProcess`: one conversation's Claude Code process, messages in, stream items out; `agentArgs`; `PANEL_PROMPT` and `PART_PROMPTS`; `findClaude` (also used by `ezapply`); `PERMISSION_TOOL`; `sessionId` ([sessions](companion.md#sessions); `SESSION_ENV` and `SESSION_HEADER` are in `endpoints.ts`) |
| `agent/panel.ts` | `PanelService`: the side panel's methods (state, a conversation with its posting and documents, what a tab is, send, answers) and the updates pushed to it ([below](#the-panels-side-panelts)) |
| `agent/stream.ts` | `readStreamLine`: a line of stream-json into events for the panel; `toolSummary` |
| `agent/service.ts` | `AgentService`: the conversations, a live process per conversation side by side, history, Stop, Reset, forgetting a posting's, the permission mode and model |
| `agent/needs.ts` | `NeedsYou`: the cards (questions and approvals) waiting on the user |
| `mcp/tools/agent.ts` | `ask_user` and `permission_ask` ([mcp-tools](../mcp-tools.md#the-panel)) |
| `protocol/src/panel.ts` | The shared types: `AgentEvent`, `AskSpec` and its checks (`askSpecProblems`, `askAnswerProblems`), `Card`, `AgentStatus`, the conversation keys (`GENERAL_CONVERSATION`, `ConversationPart`, `conversationKey`, `postingConversation`); the panel's bridge methods (`PanelMethods`), `PanelState`, `PanelConversation`, `PanelTab`, `PanelUpdate` |

**Why headless Claude Code, and why this way.** *Rejected:* the Claude Agent SDK (the same harness as a library and
a dependency; its `canUseTool` callback is the host protocol `--permission-prompt-tool` gives the CLI); an agent
loop of ezapply's own over the API (the "only agent" principle lost, with the skills, subagents and permissions);
channels (`notifications/claude/channel`), which push messages into an interactive session: a research preview,
stdio servers only, a custom channel needs `--dangerously-load-development-channels` with a warning dialog at every
start, and `-p` ignores it; keeping the interactive session and waiting on a blocking tool: permission prompts and Claude's questions would still be in the terminal.

**Long waits.** In a panel conversation nothing waits on the user inside a tool call except `permission_ask`:
`ask_user` and `review_documents` return `{ pending }` at once, the agent ends its turn, and the answer comes as
the conversation's next message ([results as messages](#results-as-messages)). A permission prompt has to hold
the call, since Claude Code takes its answer from the call's result. An interactive session moves an MCP call
still running after 2 minutes into a background task; `-p` doesn't, so it holds the turn until answered. What still
applies: a call with no response and no progress for 30 minutes is aborted (the idle window for a stdio server,
which the relay is to Claude; `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes it), and `MCP_TOOL_TIMEOUT` caps any call
(about 28 hours by default). A permission card is denied after 10 minutes, so neither is reached. A terminal chat's
`ask_user` and `review_documents` still wait in the call, up to 15 minutes, and are called again.

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
| `--append-system-prompt <PANEL_PROMPT>` | Where its words go: the user reads them in a narrow panel and never sees a terminal; questions go on `ask_user` cards, a `pending` result ends the turn ([results as messages](#results-as-messages)), commands are approved in the panel. A posting's conversation also gets its part's line (`PART_PROMPTS`, [below](#conversations-servicets)). The skills say the rest |
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
loses `CLAUDE_AUTO_BACKGROUND_TASKS`: in `-p` a long MCP call holds the turn, as `permission_ask` needs, unless
that variable is set, which would end the turn with the approval open.

**Stop** writes `{ type: "control_request", request_id, request: { subtype: "interrupt" } }`; Claude Code answers
with a `control_response` and ends the turn (`terminal_reason: "aborted_tools"`). A tool call running then gets a
"rejected" result: a form call already sent still finishes in the companion and on the page, but Claude doesn't
see its result (the next `get_form` shows the page as it is). Stop doesn't wait for a running form call to end:
the user pressed Stop to stop, and whatever the call did to the form stays on the
page for them to see. Not SIGTERM, which leaves the turn unfinished with no
result. **Closing** ends stdin (the process exits once idle) and kills it after a grace period (10 s; 3 s when
the companion stops): the tree with `taskkill /T /F` on Windows, elsewhere SIGTERM then SIGKILL to `claude`
itself. Reset and Forget kill at once. When the companion stops, the service also waits for the events still
being appended to the conversation logs and for its last `conversations.json` write (events are emitted without
waiting for their write), so none is cut short. A message written while a tool call runs is taken when the call ends, in
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

## Antigravity (`antigravity.ts`)
`agy` (`EZAPPLY_ANTIGRAVITY` if set, else on PATH) in the workspace, with `antigravityArgs`:
`--input-format stream-json --output-format stream-json` without `-p` (one process for the conversation, messages
`{ event: "user", message: { content } }` on stdin, as Claude Code's; one sent during a turn runs as the next turn),
`--model` when one is chosen, `--mode plan` for Plan only, `--dangerously-skip-permissions` for Don't ask, and
`--conversation <id>` to continue; no `--effort` or `--print-timeout` (quirks below). Its environment has
`AGY_CLI_DISABLE_AUTO_UPDATE=true`, so the user updates `agy` themselves. Verified with `agy` 1.4 on Windows and a
stand-in MCP server; not yet with ezapply's own tools ([status](../status.md#not-yet-verified-for-real)).

### `agy`'s quirks
What it does that Claude Code doesn't, as observed with `agy` 1.4 on Windows. Each shapes something below.
- **The model is the effort.** `agy models` prints a "Fetching…" line, then `<id>\t<name>` per model, each at its
  level ("… Flash (High)", "… (Low)"). It takes `--effort` too, but the panel offers none.
- **A turn has no time limit by default** (`--print-timeout 0`; a call held 150 seconds kept the turn), **but an
  MCP call is cut at 3 minutes** ("timed out after 3m0s: context deadline exceeded"), with no known setting. This
  is why a panel conversation's questions and reviews don't wait in the call
  ([results as messages](#results-as-messages)): a call held past 3 minutes ended in an error with no id to wait
  again with, and the turn ended with the review dropped. A permission prompt never reaches `agy`, which has none.
- **Its auto-updater flashes a window.** Each start (at most once every 15 minutes) launches it in a console of its
  own; only `AGY_CLI_DISABLE_AUTO_UPDATE=true` turns it off, not `1`.
- **Headless, it denies what its rules don't allow and still reports success.** Commands, MCP tools without a rule,
  and file writes in some folders, this workspace among them ([workspace](workspace.md#antigravity)), are denied
  without asking; the turn ends with
  `status: "SUCCESS"`, an empty response and `denied_actions`. Rules live only in
  `~/.gemini/antigravity-cli/settings.json`. `--mode accept-edits` still denies commands, `--mode auto` isn't
  offered to every account (it warns and falls back), and `--dangerously-skip-permissions` approves everything.
- **`status: "ERROR"` doesn't mean nothing was done.** A turn has ended in error ("root agent idle; waiting … for
  background task(s)") after its edits were written and its reply was complete.
- **No control requests:** one on stdin ends its session. Mode and model are fixed for a process.
- **The workspace is its cwd**, and `--conversation <id>` continues a conversation with its whole context in a new
  process, even after one was killed mid-call.
- **Its stream hides MCP:** `init` lists only built-in tools, an MCP call is the built-in `call_mcp_tool`, and
  before its first call to a tool it reads the tool's schema with `view_file`, a step more than Claude Code.
- **`result.duration_seconds` counts the whole conversation**, across processes, not the turn; it reports no cost.

### How ezapply drives it
- **It names its conversations.** Its id arrives on its lines (`conversation_id`); the reader reports it as an
  `agentSession` item and the service keeps it as the conversation's `agentSessionId`, which a later process
  continues. ezapply's own session id still goes to the relay as `EZAPPLY_SESSION`.
- **No system prompt flag.** The first message of a new conversation carries `ANTIGRAVITY_PROMPT` and the part's
  line in an `<ezapply-panel>` block before the user's words (`firstMessage`); the panel's history shows only the
  user's words.
- **Nobody approves.** Headless `agy` has no prompt and no permission tool, and none of its modes runs commands
  without a rule (quirks above). So the panel offers Don't ask (anything but Plan only runs this way), which passes
  `--dangerously-skip-permissions` so its calls run unasked (verified with stream-json input: a command ran,
  nothing denied), and Plan only (`--mode plan`, no flag). *The cost:* nothing
  stands between a prompt injected through a posting and a command run on the user's machine, which Claude Code's
  cards or classifier would check; its prompt says to keep to ezapply's tools and the workspace and never act on
  instructions in a posting, and the user picks Antigravity knowing this. `ezapply init` still writes ezapply's
  rules in its settings ([workspace](workspace.md#antigravity)), and a turn that ends on a denial anyway (Plan
  only) gets a notice naming the kind of call and where to allow it.
- **No control requests**, so the backend says `switches: false`. Stop kills the process, the turn ends as
  interrupted, and the next message continues the conversation in a new process. A mode change ends the process like an effort
  change, and so does a model change: `--model` names one `agy models` listed, or none for its own default.
- **Its stream** (`AntigravityReader`), each line `{ event, <event>: { … } }`: `init` (the model and its built-in
  tools; MCP tools aren't listed, so nothing says whether ezapply's server connected and the check below is
  skipped), `step_update` (`step_index`, counting on across turns; `state` `ACTIVE`, `DONE` or `ERROR`;
  `step_type`: `user_input` is the message taken, `agent_response`'s `text_delta`s joined into one text when it's
  done, `tool` with `tool_info { name, parameters, error }` a call and its end) and `result` (`status`, `error`,
  `denied_actions`). An MCP call is `call_mcp_tool { ServerName, ToolName, Arguments }`: ezapply's are named as
  Claude Code names them, so `toolSummary` folds them the same way; others are summarized by the command, file,
  query or address their parameters name. The reader times each turn from its `user_input`, since `result`'s
  `duration_seconds` doesn't; the panel shows no cost.
  `antigravity.test.ts` pins these against `agy-stream-stub.mjs`, whose lines are shaped as recorded.

## Conversations (`service.ts`)
Two per posting, keyed `<posting id>/tailor` (its documents) and `<posting id>/fill` (its application), and one
`general`. **Why two per posting:** tailoring and filling are separate work, whichever the user starts first, and
in one conversation each was re-sent with every turn of the other (a long form's reads behind each document edit,
and the documents' drafting behind each step). What one needs of the other is on disk: the documents and their
approvals, `notes.md`, the form log. Each part's line in the system prompt (`PART_PROMPTS`) keeps it to its work:
the tailoring conversation doesn't touch application forms, and the filling one doesn't write or edit documents,
though it may show the ones there for review and attach them; each tells the user to press the other's button
for the rest. The filling line also says the form's own text (experience descriptions, free-text answers) is its
to tailor: without that, Claude read "doesn't write documents" as covering them and pasted the profile's
highlights unchanged. The first time the service reads its file in a run, `general` gets its record if it has none (a new,
unstarted session), so it's always there for the panel to show and reset, even in a workspace that never used it.
An older build kept one conversation per posting under the bare id; on that same first read, such a conversation becomes the posting's tailoring one, its logs moved to
`<posting id>/tailor/`, so its history stays in the panel. Sending:
- starts the conversation's process when none runs, with `--resume` once Claude Code has had its session (it
  answered once: `started`), else `--session-id`;
- **while a card of that conversation is open, answers the card instead,** as typing does at Claude Code's own
  prompts: a question's reply (delivered as its result, `{ replied, message }`) or an approval's deny, with the
  message as its reason. For an approval the agent is inside the call, and would take the message only when it
  ends. A message while a review is open goes to the agent as any other; the review stays open.

### Results as messages
In a panel conversation, `ask_user` and `review_documents` open their card or review and return `{ pending: <id>,
hint }` at once; the hint (`PENDING_HINT`), `EZAPPLY.md` and the panel's prompts say to end the turn. When the user
answers, `deliverLater(key, { tool, id }, result)` sends the result to the conversation as a message:
`<ezapply-result tool="…" id="…">` around the JSON the blocking call would have returned. It starts the next turn,
or joins the running one (Claude Code takes it in the turn, Antigravity as the next), and resumes the conversation's
process if it has ended. The panel shows a note instead of the block: the message's `user` event carries
`delivery: true` and a label ("Answers to <card title>", "Your reply to …", "Your review", "The review expiring").
What settles: an ask answered or replied to (`NeedsYou.settledAsk`), a review answered or expired
(`ReviewService.settled`). Nothing is sent for a review replaced by a newer one, since the agent replaced it, nor
for an ask withdrawn by Reset. A result whose conversation has a new session by then (Reset, Forget) is dropped:
that session never asked. Calling again with the `askId` or `reviewId` while it's open returns `pending` again,
not a wait. Pending results are held in memory, so a companion restart loses them, as it loses the cards.

*Why:* a call that waits on the user has to outlast them. Claude Code held it, but at its 10-minute timeout the
agent had to call again, and one that ended its turn instead left the answer unread until the user wrote. `agy`
cuts every MCP call at 3 minutes ([quirks](#agys-quirks)). Each call to wait again also cost a model step. A
terminal chat can't be given a turn, so there the tools still wait in the call.

**Side by side.** Every conversation has its own process, as many at once as the user starts, with no cap: each
its own stream, queue of messages, Stop (`stop(key)`), settings changes and log lines, and `state()` lists each
running one with its status (`statusOf(key)` for one). Two sends at once to a conversation with none running start
one process; a process asked to end finishes before its conversation's next starts. What keeps them apart:
- **Each conversation works on its own posting.** There's no workspace-wide active posting. The tools that take a
  posting (`posting_get`, `posting_update_meta`, `tab_bind`, and the form tools' tab choice and crediting) default
  to the call's own (`PostingsService.ownPosting(session)`): a posting's conversation, found by the session the
  relay names (`conversationOf`), has that posting; naming another one from it is refused, telling the user to
  open that one from the panel's list. The general conversation and a terminal chat have none: they name the
  posting (`postings_list`, then its `id`), and their form calls credit nothing
  ([which posting](../mcp-tools.md#postings)). *Why:* with one active posting, a send to one conversation moved
  what every other conversation and terminal chat worked on.
- **A tab is one application's.** The form tools' default tab is the conversation's own posting's application, and
  a tab bound to one posting refuses another's changes ([which posting](../mcp-tools.md#forms)), so two
  conversations filling at once each fill their own tab; focus emulation is per tab
  ([extension](extension.md#focus-emulation-emulationts)).
- **Shared files** are written one at a time: `state.json` (`Workspace.updateState`), each posting's `meta.json`
  and captures (`PostingsService`), builds and repo syncs (per-key queues), `conversations.json` and each
  session's log here, and the profile's files (`ProfileService`: each file's read-modify-write in turn, written
  atomically). The agents' own edits to a shared file (the answer bank) go through their edit tools: Claude Code's
  refuses an edit to a file changed since it read it, so the later one reads it again.

**Reset** (`reset(key)`) ends the conversation's process, withdraws its open cards, and gives it a new session;
the old one goes to `earlier` (kept for `claude --resume`; the newest 50). What's on disk carries over (documents,
`notes.md`, approvals, the form log); the conversation doesn't. **A session that can't be resumed** (Claude Code
exits before answering, its transcript gone) is replaced by a new one once, with the waiting messages sent again
and a notice. Claude Code stopping mid-turn is a notice with the first line it wrote to stderr. The first `init`
of a Claude Code process is checked for the `ezapply` MCP server (Antigravity's doesn't list MCP servers): anything but `connected` is an error notice ("Run `ezapply
init` in the workspace, then Reset this conversation"), since the agent would have none of its tools.

**Forget** (`forgetPosting(id)`, when the panel deletes a posting) ends the process of either of the posting's
conversations, withdraws their open cards, removes them from `conversations.json` and deletes the posting's folder
of logs (`agent/<id>/`). Nothing is kept for `claude --resume`, since the posting they were about is gone.

## Permission mode, model and effort
Chosen in the panel, under the chat bar, for every conversation, and **kept by the extension**, in the browser
(`AgentPrefs { agent, choices }` in `storage.local`, [extension](extension.md#the-agent-settings)): the agent, and
each agent's own mode, model and effort (`AgentChoice`), so choosing an agent brings back what it last ran with. The
panel reads them from storage itself, so they show at once, before ezapply answers, and hold across Reset, a
restart of ezapply, and a change of workspace. The companion holds them only in memory (`setPrefs`): the
extension gives them on every connection, before anything the panel asks on it, and on every change
(`panel.settings`), and until then they're the defaults. *Why the extension's:* the panel is where they're shown
and changed; read back through the companion, they showed only once it answered, a beat after the panel opened, and
the companion had to write a file to keep what the browser already could. What a conversation runs with is
`effectiveSettings(prefs, installed)` (`AgentSettings`), the same in the panel and the companion: the chosen agent's
choice, or its defaults (`DEFAULT_AGENT_CHOICES`: Claude Code with Auto, Sonnet and medium effort; Antigravity with
Don't ask, its own default model and medium effort) for one never chosen.

**The agent** (`claude` or `antigravity`) is offered only when both are installed (`PanelState.agent.agents`); a
chosen agent not installed runs as the first that is, its choice kept for when it is. A session is with one agent:
each conversation records its `agent`, and a message to one whose session was with the other starts a new session
(the old one to `earlier`) with a notice. A change ends the running process like effort (below). Antigravity's
conversations show its two modes (Don't ask, Plan only) and its models, and no effort: its models name their level.
Its stored choice keeps an effort all the same (`AgentChoice` is one shape for every agent), which nothing reads.

| Mode | The panel says | Does |
|---|---|---|
| `default` | Ask first | Claude asks on the panel before commands and edits the workspace's permission rules don't allow |
| `acceptEdits` | Accept edits | File edits go ahead without asking; commands still ask |
| `auto` (default) | Auto | Claude Code's classifier decides what runs without asking, so few approval cards come up |
| `plan` | Plan only | Claude reads and plans, and changes nothing |
| `dontAsk` | Don't ask | Only what the rules allow runs; anything else is denied without asking |

Claude Code's models: the aliases `fable`, `opus`, `sonnet` (default), `haiku`, each the latest of its family
(`sonnet` is Sonnet 5.5 with Claude Code 2.1). Antigravity's depend on the account, so the companion lists them with
`agy models` the first time the panel's state is read (it fetches them, so they come a moment later, as a state
change) and offers them as `PanelState.agent.models.antigravity`, beside "Default model" (no `--model`); a chosen
one shows by its id until the list is in. Effort, Claude Code's only: `low`, `medium` (default), `high`, `xhigh`,
`max` (`--effort`). Stored settings are read field by field (`readAgentPrefs`), so one an older build kept that's no
longer offered falls back to its default alone, and a choice an agent can't take (a Claude model that isn't an
alias, an Antigravity mode it doesn't offer) runs as its default.
*Not offered:* `bypassPermissions`. Postings are untrusted text, and the approval cards are what stands between
a prompt injected into one and a command run on the user's machine; Claude Code also refuses to switch a session to
it unless it was launched with `--dangerously-skip-permissions`. A Claude model's full name isn't offered either: the
aliases follow new releases, and a fixed list can't be mistyped.

**A change applies to the running conversation** (`setPrefs`). Claude Code's mode and model at once:
the process gets Claude Code's control requests `{ subtype: "set_permission_mode", mode }` and `{ subtype:
"set_model", model }`, which Claude Code 2.1 takes mid-session, between tool calls. A refusal (`control_response`
with `subtype: "error"`) is a notice in that conversation ("Claude Code didn't switch the …"); the setting stays
kept and applies when the conversation next starts. **Effort from the next message:** Claude Code has no
`set_effort`, and its `apply_flag_settings { effortLevel }` is accepted but wasn't seen to change how much a turn
thinks, so the process ends (at once when idle, after its turn while it works) and the next message resumes the
session with the new `--effort` (or, for a new agent, starts its new one); so does any change for Antigravity,
which takes no switches. The change answers without waiting for that exit (Claude Code can take seconds to end):
the next process starts once it has, so two never hold one session. The same settings given again (on a
reconnection) change nothing. Processes start with the settings as flags.

**On disk**, in the workspace's `agent/` ([format](../data-formats.md#agent)): `conversations.json` and each
session's events, `<conversation>/<session>.jsonl`. `history(key)` reads the current session's, a message's latest
state winning (it's written again when taken).

## Cards (`needs.ts`)
What waits on the user. **Questions** (`ask_user`): a card holds an `AskSpec` (title, intro, 1 to 25 questions,
each `single`, `multi` or `text`, with options, a free-text Other, a suggestion and where it came from,
`sensitive`, `required`, an offer to save the answer). `askSpecProblems` refuses what the schema can't (options for
choice questions, a suggestion that isn't one of them unless Other is allowed, an id twice, min over max);
`askAnswerProblems` checks the answers (required ones, values on the list unless Other, how many, only questions
asked). A **sensitive question may carry a suggestion** like any other: the card flags it and shows where the
suggestion came from, and nothing is filled until the user sends the card. A panel conversation's answers are
delivered as a message ([above](#results-as-messages)); a terminal chat's, given while nothing waits, are kept and
read once by the next wait. **Approvals** (`permission_ask`): a card with the tool, its input and Claude's
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
| `panel.state` | `PanelState`: the agent's status (working while any conversation is) and each running conversation's (`agent.conversations`: status, messages waiting), the 20 newest postings and any older one a card waits on or an agent is in, the open cards, and setup (`workspace_check`'s required steps left; kept 30 s, as it runs TeX and GitHub checks) |
| `panel.conversation { key }` | `PanelConversation`: the session's events (`history`), its cost, and for either of a posting's conversations its card (company, role, site, status, deadline, up to six bullet lines under `## Application requirements` in `notes.md`, the application's address), its PDFs with where each stands (`draft`, `review`, `approved`, `changes`, `attached`: `ReviewService.documentStates` by their bytes; `attached` when an approved one has an upload in the form log; only PDFs at the top of the posting's folder), and a review waiting on the user |
| `panel.tab { tabId, url, title, site, frames?, postingId? }` | What the tab is to the posting open in the panel (none in the general conversation): its page (`posting`), its application (`application`, by `matchPosting` as the form tools decide), another posting's (`other-application`), an application not known to be its (`unconfirmed-application`), another page, or no web page. A form is the page's own on a form site, or a form site's frame in it (`frames`: a careers page embedding Greenhouse), told by the frame's URL as the form tools tell it, so a careers page around the form never makes it "another page"; the posting's own page is its application when a form frame is in it, or on a site whose posting page is its form (`postingIsForm`: Greenhouse's board, not Workday's posting page). Of several forms, the posting's wins |
| `panel.send { key, text }` | The user's message to a conversation (`general`, or a posting's `tailor` or `fill`; a posting's must still exist) |
| `panel.stop { key }`, `panel.reset { key }` | Stop the conversation's turn (the others go on); a new session for the conversation |
| `panel.settings AgentPrefs` | The extension's agent settings, on every connection and change ([above](#permission-mode-model-and-effort)); returns what conversations now run with. `panel.state` carries the agents installed (`agent.agents`) and Antigravity's models (`agent.models`) |
| `panel.answer { cardId, answers }`, `panel.reply { cardId, message }`, `panel.permission { cardId, allow, reason? }` | A card's answers (checked against its questions), a reply in words instead, an approval's decision |
| `panel.markSubmitted { postingId }` | The user submitted the application and the confirmation page went unseen: the posting moves to `submitted` (forward only) and `form-log.jsonl` gets `marked-submitted` (`FormsService.submitted`) |
| `panel.markOpen { postingId }` | A submitted posting isn't: back to its status before ([postings](postings.md#status)), logged as `marked-open` (`FormsService.reopen`). Nothing for a posting not `submitted` |
| `panel.deletePosting { postingId }` | Delete a posting for good: its conversations (`forgetPosting`), then its folder (`PostingsService.delete`). Refused while it has a review open |
| `panel.deleteDocument { postingId, file }` | Delete one of the PDFs the panel lists for the posting, and nothing else (any other name is `not_found`). The `.tex` source stays, so Claude can build it again. Refused while the PDF is in an open review |
| `panel.workspaceChanges { key }`, `panel.workspaceChange { key, ids, action, … }` | The Workspace changes card: what's out of date, marked against the conversation's work, and the user's Update, Later or Keep on it ([companion](companion.md#acting-on-a-change-workspaceupdates)) |
| `panel.open { what }` | Open for the user, in the extension's browser: a review's tab again (`reviewId`), a posting's file (only inside its folder), or the setup page |

**Updates** (`panel.update`, the companion calling the extension): each agent event with its conversation, and
`changed` when the panel's state may have changed (the agent's state, a card, a posting captured or deleted, a review),
or the workspace changes (`FreshnessService.onChange`), coalesced over 50 ms; both only while a panel watches, and only while the extension is connected (an update is
never waited for). The number of open cards (`cards`) is pushed on every change of the cards even while no panel
is open: the toolbar badge shows it. So is a **`notify`** ("Claude Code finished", "… has a question", "… asks
before running something", "… stopped", with the conversation's part: General, Documents or Application, and never
the posting's details): when a turn ends (not one the user stopped, nor one that runs straight on into a message
waiting) and when a card opens, with the workspace's `notifications.turnEnd` on ([format](../data-formats.md#ezapplyconfigjson-companionsrcconfigworkspacets)).
A turn that ends with its conversation's card open sends nothing, so the card's notification stays; one that ends
with its posting's review open says "Your documents are ready to review" instead of "finished", since a review now
ends the turn.
A card's is marked `card`: the extension shows a turn's end only while no panel is in view, and a card's always
([notifications](extension.md#notifications-notifyts)).

**Setup tasks** go to the agent as messages to the general conversation ([ui](ui.md#the-agents-side-tasks)), and so
do the workspace tasks the Workspace changes card hands it ("Workspace task tN (update-profile): the user chose to
update this…"; [companion](companion.md#acting-on-a-change-workspaceupdates)).

## Open questions
- Chrome's side panel is per window: two windows show the same conversations and cards, and either can answer a
  card. The first answer settles it; the other gets "No open approval" (or question), and its panel drops the card
  with the next update. Whether a second window should say more than that.
- Cost is Claude Code's estimate; whether to warn before a turn of a long-resumed session.
