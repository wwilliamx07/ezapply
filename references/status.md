# Status

A lean log: the decisions that shape the build and aren't obvious from the code, known issues and open
questions. What is built, and how, is on the component pages; history is in git.

## Decisions
Each gives the choice and the reason in a line or two; the linked page has the detail.

- **Setup and repos have no skill.** The setup page does each step as a form, and a task it hands the agent
  carries its own instructions; `onboarding { step }` opens a step for a change asked in chat, instead of a skill
  repeating the step a turn of chat at a time ([workspace](components/workspace.md#skills-claudeskills)).
- **The review opens itself when a tailoring turn ends** with new documents, instead of the skills asking the
  agent to; turns still ended without it. A failed build's PDF is left out, nothing else is held back
  ([documents](components/documents.md#review-before-attaching)).
- **The panel's buttons name their skill** (`/ezapply-resume …`), which Claude Code, Antigravity and Codex all run as
  the skill, so the agent doesn't match the words to one ([ui](components/ui.md#the-side-panel-srcpanel)).
- **Code does the fixed parts of applying:** `get_form` presses a posting's Apply, marks `prefilled`, `stale` and
  `bankMatch` fields, refuses a sensitive answer the user didn't give for the posting and a bundle's parts; the
  hand-off is a card built from the log, and a saved answer is written by code. The agent kept missing them, or
  spent turns on them ([forms](mcp-tools.md#forms)).
- **Code checks what a program can under the agent's own checks:** numbers and skills without evidence, missing or
  unknown `% src:` ids (which also hold back the review), never-mention terms in documents and judged answers,
  changes to claims the user edited. Rules the agent was told and still broke
  ([documents](components/documents.md#compile-compile), [knowledge base](components/knowledge-base.md#checks)).
- **The workspace denies the Explore and Plan subagents**, which don't load `EZAPPLY.md`, instead of asking the agent
  not to use them ([workspace](components/workspace.md#claude-code-settings)).
- **The setup page installs TeX and fills the cover's name and contact itself.** Both are the same every time,
  with nothing to judge, so an agent turn added only a wait; the system asks for permission to install
  ([ui](components/ui.md#installing-tex)).
- **Keeping the workspace current is a card, not a skill.** The user's press on the Workspace changes card is
  the consent, so nothing is updated without it and the agent can't mark a change done the user never saw; code
  does the mechanical updates, and the agent gets only what needs judgement, as a task. No call at the start of
  every session ([companion](components/companion.md#acting-on-a-change-workspaceupdates)).
- **The extension watches for Submit; the user can mark it.** The user presses Submit, so no form call sees the
  confirmation page; watching the tab from the hand-off records it without an agent, and **Mark submitted** in the
  panel covers what the watch misses ([extension](components/extension.md#watching-for-the-users-submit-submit-watchts)).
- **An employer's own form is read only on a tab the call names.** Almost any page has a form, so the generic
  definition has no signature and is never chosen by looking; it reads native controls only, starting strict, and
  its submit test errs wide, since a false positive only blocks a press ([sites](components/sites.md#employers-own-forms-generic)).
- **The setup page has no chat.** Questions and changes no button covers go to the panel's general conversation,
  which already is one; the page's previews follow the PDF's build time, so the agent's work there shows on the page
  ([ui](components/ui.md#what-each-step-does)).
- **Adapters are tested on clones, played by a stand-in.** A clone keeps the site's own front end and its
  server's answers, and one generic engine answers by each request's kind, so a fill runs the site's real scripts
  offline; a fill run injects the built adapter as the extension does, without the extension and companion, which
  don't change with a site ([harness](harness.md)).
- **No daemon.** The companion lives inside `./ezapply` and ends with it. Nothing runs in the
  background, so there is nothing to start, stop or keep secure while the user isn't applying
  ([architecture](architecture.md#processes-and-lifecycle)).
- **A failed rename is retried before it's called a lock.** Windows refuses a rename while any handle is open on
  the target, which readers and scanners hold for a moment; reporting the first failure sent the agent to ask the
  user to close files they didn't have open ([architecture](architecture.md#cross-cutting-concerns)).
- **At launch, paired is enough.** `ezapply`'s start-up readiness check counts a paired extension as set up, since
  it can't have reconnected in the instant after the start; requiring the connection opened the setup page on
  every launch ([companion](components/companion.md#readiness-checklist-workspace_check)).
- **Pairing without a code.** The extension pairs during a 15-minute window opened from the setup page or by
  `extension_pair`, and is pinned by its id; typing the code was no safer, since it sits in the same
  `config.json` that opening a window needs ([pairing](flows.md#2-pairing-the-extension),
  [why](security.md#accepted-limits)).
- **A light entry for the CLI.** `ezapply` imports each command's code when it runs, and the relay only the
  companion's config and endpoints, since the relay starts with every panel conversation and loading the whole
  companion took about 1.5 s of it ([cli](components/cli.md#commands)).
- **The coding agent's own CLI, run headless,** not the Agent SDK, an agent loop of ezapply's own, or channels: the
  CLI keeps the user's login, skills and permissions, and channels don't work under `-p`
  ([agent](components/agent.md#the-process-processts)).
- **Call shapes in the skills,** not a step that loads the tools' schemas: Claude Code defers MCP tools and the
  agent guessed parameter names, a turn each ([workspace](components/workspace.md#call-shapes)).
- **Everything in the browser.** The side panel drives a headless Claude Code, one process per conversation; there's
  no Claude Code in the terminal, so there's one way to run ezapply ([cli](components/cli.md#commands)).
- **Applications side by side, with no cap.** Each panel conversation has its own agent process and works on its
  own posting, resolved from its session; a tab is bound to one application, and shared files are written one at a
  time. The user decides how many to start
  ([agent](components/agent.md#conversations-servicets)).
- **No active posting.** A call's posting is the one it names, else its conversation's; the general conversation and
  a terminal chat name it, and form calls without one credit nothing ([which posting](mcp-tools.md#postings)).
- **The agent behind an interface.** The panel's service drives an agent backend, Claude Code's, Antigravity's or Codex's, so
  each agent reads its own protocol without touching the conversations, cards or history
  ([agent](components/agent.md)).
- **Antigravity without approvals.** Its headless mode can't ask anyone, and on the user's allow rules alone every
  command was denied and ended the turn, so Don't ask runs it with its skip-permissions flag, accepting that a
  prompt injected through a posting isn't checked ([agent](components/agent.md#antigravity-antigravityts)).
- **Codex through its app server,** not `codex exec`: one process holds the conversation, steers a message into a
  running turn, and sends each approval to the panel ([agent](components/agent.md#codex-codexts)).
- **Codex's approvals are its own, with the deny's reason steered in.** A decline carries no reason, so the user's
  message follows it into the turn ([agent](components/agent.md#how-ezapply-drives-codex)).
- **The user's own Codex setup is turned off in the panel:** their MCP servers, plugins, connectors and notify
  program, which a thread's settings merge with rather than replace ([agent](components/agent.md#what-codex-does)).
- **The user's answers start the agent's next turn.** In the panel, `ask_user` and `review_documents` return at once
  and the answer comes as a message: a call held for the user timed out (Antigravity cuts any MCP call at 3 minutes)
  and left the answer unread ([agent](components/agent.md#results-as-messages)).
- **The extension keeps the agent settings,** each agent's own mode, model and effort, and gives them to the
  companion, which holds them in memory: the panel shows them as it opens instead of after ezapply answers
  ([agent](components/agent.md#permission-mode-model-and-effort)).
- **One adapter engine, a definition per site.** Sites differ in markup, not in the API, so the API, fill loop and
  guard are shared and a site is a registry entry plus a definition ([adapters](components/adapters.md)).
- **Everything about a site in one directory** (`packages/sites/src/<site>/`), with a list per side (registry,
  definitions, notes, readers) so a bundle, the companion and the tests each import only what they need; no other
  package names a site, which a test scans for. A site's change touches one directory, and the engine (its own
  package) stays generic ([sites](components/sites.md#the-package)).
- **A new site needs no protocol bump.** `SiteId` is a string and `hello` carries the extension's site ids; the
  companion refuses a different list, so two sides built apart still fail at the handshake rather than mid-fill
  ([protocol](components/protocol.md#changing-the-protocol)).
- **The extension holds every site** (`<all_urls>`) so it can tell a page's site by its body, wherever the
  employer hosts it ([access](components/extension.md#access-to-websites)).
- **Build sites from what was seen.** Every selector comes from a saved page or the site's own scripts; iCIMS,
  SmartRecruiters, Taleo and BrassRing wait for pages saved from a real application, since ezapply doesn't work
  around bot checks ([sites](components/sites.md#why-these-three)).
- **A step's late values are waited for by its requests,** not by a longer quiet: Workday's requests for a
  returning step's dropdown values, and for the list a prompt loads on a press, run while the page shows nothing
  changing ([workday](components/sites/workday.md)).
- **Nothing is filled without the model.** Every value goes in through the agent's `fill_fields`; fields carry only
  profile hints. Filling from the profile and answer bank without the model saved values, not turns (every step
  still took a `fill_fields` call for the rest), and its mistakes passed as clean fills (a word in a 1–10 scale
  field read back as matching); reading labels is what the model does well ([adapters](components/adapters.md#widget-drivers)).
- **Documents are approved one by one** before they're attached (by default, enforced by `upload_file`), each by a
  press of its own: what's attached goes to an employer ([documents](components/documents.md#review-before-attaching)).
- **Layout is linted, not looked at.** `tex_compile` names layout problems from where the text sits; no tool renders
  a page as an image, which cost more context than the findings on every later turn
  ([documents](components/documents.md#compile-compile)).
- **Tailored documents fill the page.** `tex_compile` reports `freeLines`, a cover letter has a one-page limit, the
  skills aim for 0–2 lines left, and `review_documents` refuses an underfilled resume or letter unless `short`
  gives a reason: agents stopped well short even with the lint, and a shorter letter is sometimes right
  ([documents](components/documents.md#review-before-attaching)). A letter has one evidence paragraph per
  project or role, not a fixed two ([workspace](components/workspace.md#the-agent-file-ezapplymd)).
- **An approved document isn't reviewed again by accident.** `review_documents` refuses one whose current bytes are
  approved unless `again` gives a reason: a fill that read the approvals before the user answered the tailoring's
  review opened a second review of the same bundle ([documents](components/documents.md#review-before-attaching)).
- **Documents are edited with `tex_edit`**, which returns each changed passage with its neighbours: never rereading
  saved tokens but let edits clash, and scripted edits corrupted LaTeX; python stays denied so a script isn't the
  fallback ([documents](components/documents.md#editing-tex_edit)).
- **Skills hold only judgement**, in words no one agent's tools: what's the same every time is code
  ([workspace](components/workspace.md#skills-claudeskills)).
- **Form tools that change the page return it** (`go_next`, `add_repeatable`, `remove_repeatable`), and long option
  lists go out as a count: each extra read was a turn re-sending the whole conversation
  ([forms](mcp-tools.md#forms)).
- **A miss is the query.** No tool lists a field's options: `fill_fields` returns the 10 closest on a miss, and a
  nested menu's item named alone comes back with its full path; listing first cost a turn each time
  ([forms](mcp-tools.md#forms)).
- **The panel's Claude Code leaves the user's setup out:** only the workspace's MCP servers and settings, the tools
  the panel uses with one shell, no bundled skills. The starting context, re-read on every call, halved, and the
  user's own skills stopped competing with ezapply's ([agent](components/agent.md#the-process-processts)).
- **`EZAPPLY.md` holds only what every call needs;** document editing, the attach mode and the form rules went to
  the skills and tool descriptions that use them ([workspace](components/workspace.md#the-agent-file-ezapplymd)).
- **The preferences are imported by `EZAPPLY.md`,** not read by a skill step, so every session has them whichever
  skill runs ([workspace](components/workspace.md#how-it-stays-in-context)).
- **No database.** Per-posting `meta.json` and `form-log.jsonl` ([postings](components/postings.md#no-database)).
- **A fresh Claude session per posting, and per part of it,** so finished work isn't re-sent every turn: each posting has its own panel conversations, one tailoring its documents and one filling its application, whichever comes first ([agent](components/agent.md#conversations-servicets)).
- **One button on the review page**, under the edits box and stuck to the panel's foot, approves a document (or asks for its changes), moves to the next one to decide, and on the last sends the answer ([ui](components/ui.md#the-review-page-reviewid)).
- **The side panel blocks a send from the press,** not from the state saying Claude works, which arrives only after the companion answers ([ui](components/ui.md#the-side-panel-srcpanel)).
- **The side panel opens on the list of applications,** grouped by what each needs, and an application's conversation is opened from it, so applications in parallel each show their state ([ui](components/ui.md#the-side-panel-srcpanel)).
- **The general conversation is a card pinned above the list,** not one of its rows, since it isn't an application ([ui](components/ui.md#the-side-panel-srcpanel)).
- **A screening question the profile answers isn't asked in the answer bank** (an entry with a `source` and no
  answer): the fact has one home, the profile, and a question like the degree needs the posting anyway
  ([answer bank](components/profile-and-templates.md#answer-bank-profileanswersyaml)).
- **Binding an unconfirmed tab trusts the first tab that changes,** with a one-time `postingBound` notice naming the
  page's title, rather than refusing until `tab_bind` ([which posting](mcp-tools.md#forms)).
- **The reference is written for agents.** A "By task" table says what to read for each kind of change, the
  few hard rules sit in a `CLAUDE.md` beside the code they govern, it doesn't restate the code (no per-test
  lists), and a test checks its links and coverage: the agent reads less and still finds the page that matters
  ([conventions](development.md#conventions)).
- **The UI is checked by a fuzzer walking a map of it,** not by the user clicking through: the map
  ([ui-map](ui-map/README.md)) is the fuzzer's input, so it can't drift from the UI; the companion is faked with
  hand-written answers typed with the protocol, not answers recorded and scrubbed; selectors are the controls' roles
  and names, the user's view, rather than test ids added to the code ([the UI fuzzer](development.md#the-ui-fuzzer)).
- **Defaults assumed:** resume page size Letter (bundle normalization;
  [`resume.pageSize`](data-formats.md#ezapplyconfigjson-companionsrcconfigworkspacets)); contributions to other
  people's public repos are added by URL, with claims limited to the user's own commits
  ([contributions](components/github-and-repos.md#contributions-repo_contributions)).

## Known issues
- **"Could not open the dropdown"** on Workday after its own list was read without a choice; the adapter retries
  once, shown as `dropdown re-open` in the trace ([details](components/sites/workday.md#workdays-dropdown-finding-its-listbox)).
- **A `go_next` after the user advanced the step themselves** presses the next step's button.
- **Fills slower in debug mode** (dropdowns about 3.5–4 s against 1.8 s), cause unknown: the adapter trace shows
  which waits ran to their maximum; one guess is `afterFieldMaxMs`.
- **The default cover letter test** failed once with MiKTeX and didn't reproduce; capture its `hint` if it recurs.

## Open questions
1. **Bindings live in memory,** so a restart of `ezapply` loses them; the stored `application` still matches
   by tenant and job. Enough?
2. **Title matching on real roles:** compare recorded roles with the pages' titles (`FormSchema.job` in debug
   records) and tune `compareTitles` if real pairs come out `unsure` or `other`.
3. **Postings captured from one job-board results URL** can't be told apart by URL (a capture problem).
