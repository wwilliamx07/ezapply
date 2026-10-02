# ezapply reference

The complete, current description of ezapply: what it's for, how it's built, and how every part works.
**This folder is the source of truth**, including the reasons behind the design (there is no separate
decision log). The original design plan was removed once built; what changed from it is in
[status.md](status.md#where-the-build-departs-from-the-original-plan). Planned work is in `todo.md`. The
repo's `CLAUDE.md` requires every change to keep this folder accurate and complete.

## Contents

| Page | Covers |
|---|---|
| [philosophy.md](philosophy.md) | Purpose, principles, goals and non-goals |
| [architecture.md](architecture.md) | The parts, processes, transports, lifecycle, where state lives, cross-cutting concerns |
| [flows.md](flows.md) | End to end: setup and onboarding, pairing, capture, resume, cover letter, bundle, autofill |
| [components/protocol.md](components/protocol.md) | `packages/protocol`: bridge messages, RPC, form and posting schemas, errors |
| [components/companion.md](components/companion.md) | `packages/companion`: startup inside `ezapply chat`, HTTP surface, chat sessions, MCP server, bridge, readiness check |
| [components/postings.md](components/postings.md) | Posting capture, extraction, folders, statuses |
| [components/documents.md](components/documents.md) | TeX engines, compiling, log parsing, history, PDF toolkit |
| [components/profile-and-templates.md](components/profile-and-templates.md) | Profile, answer bank, preferences, resume and cover letter templates |
| [components/github-and-repos.md](components/github-and-repos.md) | GitHub App, login, tokens, the read-only repo cache |
| [components/knowledge-base.md](components/knowledge-base.md) | Project knowledge base, claims, indexing |
| [components/extension.md](components/extension.md) | `packages/extension`: background, connection and pairing, capture, site access, options, builds |
| [components/workday-adapter.md](components/workday-adapter.md) | Reading and filling Workday forms, the submit guard, the waits (`autofill-timing.yaml`) |
| [components/autofill.md](components/autofill.md) | Deterministic autofill: what the companion fills by itself on a step, the rules, strict matching |
| [components/oracle-adapter.md](components/oracle-adapter.md) | Reading and filling Oracle Recruiting Cloud forms, per-site access, what was verified |
| [components/cli.md](components/cli.md) | `packages/cli`: the `ezapply` command, init, the MCP relay, `chat` (hosting the companion, restarting Claude) |
| [components/workspace.md](components/workspace.md) | The user's workspace: layout, agent file, skills, Claude Code settings |
| [mcp-tools.md](mcp-tools.md) | Every MCP tool: inputs, behaviour, errors |
| [data-formats.md](data-formats.md) | Every file ezapply reads or writes, with its schema |
| [security.md](security.md) | Threat model and the controls against each threat |
| [development.md](development.md) | Repo layout, build, tests, CI, conventions, how to extend |
| [status.md](status.md) | What's done, what's unverified, what's deferred, open questions, where the build departs from the original plan |

## Reading order
New to the project: philosophy → architecture → flows. Then the component page for whatever you're
changing, and [development.md](development.md) for how to change it.
