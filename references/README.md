# ezapply reference

The complete, current description of ezapply: what it's for, how it's built, and how every part works.
**This folder is the source of truth**, including the reasons behind the design (the lean decisions log is
[status.md](status.md#decisions)). Planned work is in `todo/` (its map is `todo/todo.md`). Every
change keeps this folder accurate and complete; how its pages are written is in [CLAUDE.md](CLAUDE.md).

## By task
Read these before the change, and update them with it. A folder with its own `CLAUDE.md` (the sites, the
companion, the CLI) has the rules that apply there; Claude Code loads it when you work in that folder.

| Changing | Read |
|---|---|
| A site's adapter, or why a fill failed | That site's page under [components/sites/](components/sites.md) (its directory is `packages/sites/src/<site>/`), [adapters.md](components/adapters.md), what its next live run checks in [status.md](status.md#not-yet-verified-for-real) |
| A new job site | [building-adapters.md](building-adapters.md), then the above |
| Cloning a site, or testing an adapter change on its clone | [harness.md](harness.md) |
| A live run's results (debug mode) | [Debugging a live run](development.md#debugging-a-live-run-debug-mode) |
| An MCP tool | Its group in [mcp-tools.md](mcp-tools.md), the service's component page, [How to…](development.md#how-to) |
| The form tools' logic (tab choice, which posting, the checklist) | [Forms](mcp-tools.md#forms), [companion.md](components/companion.md) |
| A bridge method or shared schema | [protocol.md](components/protocol.md), [How to…](development.md#how-to) |
| A file ezapply reads or writes | [data-formats.md](data-formats.md), [How to…](development.md#how-to) (migrations) |
| A skill or `EZAPPLY.md` | [workspace.md](components/workspace.md), [How to…](development.md#how-to) |
| The side panel and its agent | [agent.md](components/agent.md), [ui.md](components/ui.md), [the side panel](components/extension.md#the-side-panel) |
| Anything on screen in the panel, the review page or the setup page | Its pages in [ui-map/](ui-map/README.md), then [the UI fuzzer](development.md#the-ui-fuzzer): update the map; `/ui-fuzz` checks it |
| Resumes, cover letters, PDFs, the review page | [documents.md](components/documents.md), [profile-and-templates.md](components/profile-and-templates.md), [ui.md](components/ui.md) |
| Capturing postings | [postings.md](components/postings.md), [capture](components/extension.md#capture) |
| Pairing, the connection, startup | [flows.md](flows.md#2-pairing-the-extension), [companion.md](components/companion.md), [architecture.md](architecture.md) |
| GitHub, repos, claims | [github-and-repos.md](components/github-and-repos.md), [knowledge-base.md](components/knowledge-base.md) |
| The `ezapply` command | [cli.md](components/cli.md) |
| Anything touching paths, tokens, the user's data or page content reaching the agent | [security.md](security.md) |
| Build, tests, CI, conventions | [development.md](development.md) |
| Auditing the whole repo (`/garden`) | [Conventions](development.md#conventions), then every `CLAUDE.md` |

## Contents

| Page | Covers |
|---|---|
| [philosophy.md](philosophy.md) | Purpose, principles, goals and non-goals |
| [architecture.md](architecture.md) | The parts, processes, transports, lifecycle, where state lives, cross-cutting concerns |
| [flows.md](flows.md) | End to end: setup and onboarding (on its page), pairing, capture, resume, cover letter, bundle, filling the application, review and attach |
| [components/protocol.md](components/protocol.md) | `packages/protocol`: bridge messages, RPC, a site registry entry's shape, form and posting schemas, errors |
| [components/companion.md](components/companion.md) | `packages/companion`: startup inside `ezapply`, HTTP surface, sessions, MCP server, bridge, readiness check |
| [components/postings.md](components/postings.md) | Posting capture, extraction, folders, statuses |
| [components/documents.md](components/documents.md) | TeX engines, compiling, log parsing, history, PDF toolkit |
| [components/profile-and-templates.md](components/profile-and-templates.md) | Profile, answer bank, preferences, resume and cover letter templates |
| [components/github-and-repos.md](components/github-and-repos.md) | GitHub App, login, tokens, the read-only repo cache |
| [components/knowledge-base.md](components/knowledge-base.md) | Project knowledge base, claims, indexing |
| [components/extension.md](components/extension.md) | `packages/extension`: background, connection and pairing, the side panel, capture, telling a page's site, access to websites, focus emulation, options, builds |
| [components/adapters.md](components/adapters.md) | `packages/engine`, the adapter engine, and site definitions: extraction, the API, widget drivers, waits owned by each site, the submit guard, conformance tests, checking a site live |
| [components/sites.md](components/sites.md) | `packages/sites`: one directory per site, the lists per side, the site registry and why signatures; why these sites, what the three boards share, the providers still to build |
| [components/sites/workday.md](components/sites/workday.md), [oracle.md](components/sites/oracle.md), [greenhouse.md](components/sites/greenhouse.md), [lever.md](components/sites/lever.md), [ashby.md](components/sites/ashby.md), [phenom.md](components/sites/phenom.md), [dayforce.md](components/sites/dayforce.md), [successfactors.md](components/sites/successfactors.md) | Each site, only what it does differently: its pages, registry entry and signature, its definition's files and rules, what was verified live and what wasn't |
| [components/ui.md](components/ui.md) | `packages/ui`: the side panel's components, the review and onboarding pages, the PDF viewer, what changed since the last review, how the pages talk to the companion, the build |
| [components/agent.md](components/agent.md) | `companion/src/agent/`: Claude Code, Antigravity or Codex run for the side panel (and `agy`'s and Codex's quirks), its conversations, the agent's questions and approvals (cards), the panel's methods and updates |
| [components/cli.md](components/cli.md) | `packages/cli`: the `ezapply` command (hosting the companion for the side panel), init, the MCP relay, doctor, debug mode, the commands it doesn't have and why |
| [components/workspace.md](components/workspace.md) | The user's workspace: layout, agent file, skills, Claude Code settings |
| [mcp-tools.md](mcp-tools.md) | Every MCP tool: inputs, behaviour, errors |
| [data-formats.md](data-formats.md) | Every file ezapply reads or writes, with its schema |
| [security.md](security.md) | Threat model and the controls against each threat |
| [development.md](development.md) | Repo layout, build, tests, CI, conventions, how to extend |
| [building-adapters.md](building-adapters.md) | Adding a job site: the process, what goes where (registry, definition, site notes), drivers, tests, checking it live |
| [harness.md](harness.md) | The adapter harness: cloning a site's application, the stand-in for its server, the checks a clone passes, fill runs |
| [ui-map/](ui-map/README.md) | The UI map: each screen of the panel, the review page and the setup page, its controls and where each leads (the UI fuzzer's input) |
| [status.md](status.md) | The decisions log, what still needs a live run, known issues, open questions |

## Reading order
For a change, the task's row above is enough to start; read the code next. New to the project, or changing how the
parts fit together: philosophy → architecture → flows.
