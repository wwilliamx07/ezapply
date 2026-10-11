# ezapply reference

The complete, current description of ezapply: what it's for, how it's built, and how every part works.
**This folder is the source of truth**, including the reasons behind the design (the lean decisions log is
[status.md](status.md#decisions)). The original design plan was removed once
built; what changed from it is in [status.md](status.md#where-the-build-departs-from-the-original-plan). Planned work is in `todo.md`. The
repo's `CLAUDE.md` requires every change to keep this folder accurate and complete.

## Contents

| Page | Covers |
|---|---|
| [philosophy.md](philosophy.md) | Purpose, principles, goals and non-goals |
| [architecture.md](architecture.md) | The parts, processes, transports, lifecycle, where state lives, cross-cutting concerns |
| [flows.md](flows.md) | End to end: setup and onboarding (on its page), pairing, capture, resume, cover letter, bundle, filling the application |
| [components/protocol.md](components/protocol.md) | `packages/protocol`: bridge messages, RPC, the site registry, form and posting schemas, errors |
| [components/companion.md](components/companion.md) | `packages/companion`: startup inside `ezapply chat`, HTTP surface, chat sessions, MCP server, bridge, readiness check |
| [components/postings.md](components/postings.md) | Posting capture, extraction, folders, statuses |
| [components/documents.md](components/documents.md) | TeX engines, compiling, log parsing, history, PDF toolkit |
| [components/profile-and-templates.md](components/profile-and-templates.md) | Profile, answer bank, preferences, resume and cover letter templates |
| [components/github-and-repos.md](components/github-and-repos.md) | GitHub App, login, tokens, the read-only repo cache |
| [components/knowledge-base.md](components/knowledge-base.md) | Project knowledge base, claims, indexing |
| [components/extension.md](components/extension.md) | `packages/extension`: background, connection and pairing, the side panel, capture, telling a page's site, access to websites, options, builds |
| [components/adapters.md](components/adapters.md) | The adapter engine and site definitions: extraction, the API, widget drivers, waits owned by each site, the submit guard, conformance tests, checking a site live |
| [components/sites.md](components/sites.md) | Every site's definition, only what it does differently: Workday, Oracle Recruiting Cloud, Greenhouse, Lever, Ashby, Phenom, Dayforce and SAP SuccessFactors; why these sites, what was verified live, the providers still to build |
| [components/ui.md](components/ui.md) | `packages/ui`: the side panel's components, the review and onboarding pages, the PDF viewer, what changed since the last review, how the pages talk to the companion, the build |
| [components/agent.md](components/agent.md) | `companion/src/agent/`: Claude Code run headless for the side panel, its conversations, the agent's questions and approvals (cards), the panel's methods and updates |
| [components/cli.md](components/cli.md) | `packages/cli`: the `ezapply` command (the panel's mode), init, the MCP relay, `chat` (hosting the companion, restarting Claude) |
| [components/workspace.md](components/workspace.md) | The user's workspace: layout, agent file, skills, Claude Code settings |
| [mcp-tools.md](mcp-tools.md) | Every MCP tool: inputs, behaviour, errors |
| [data-formats.md](data-formats.md) | Every file ezapply reads or writes, with its schema |
| [security.md](security.md) | Threat model and the controls against each threat |
| [development.md](development.md) | Repo layout, build, tests, CI, conventions, how to extend |
| [building-adapters.md](building-adapters.md) | Adding a job site: the process, what goes where (registry, definition, site notes), drivers, tests, checking it live |
| [status.md](status.md) | The decisions log, what still needs a live run, known issues, open questions, where the build departs from the original plan |

## Reading order
New to the project: philosophy → architecture → flows. Then the component page for whatever you're
changing, and [development.md](development.md) for how to change it ([building-adapters.md](building-adapters.md) for
a new job site).
