# Workspace (`~/ezapply-home`)

The folder where the user runs `claude`. It holds everything the user owns plus what tells Claude how to
work. Created and refreshed by [`ezapply init`](cli.md#init-workspace-initts).

## Layout

```
ezapply-home/
  EZAPPLY.md               agent file (managed by ezapply; rewritten by init)
  CLAUDE.md                the user's own notes; imports @EZAPPLY.md
  ezapply.config.json      settings: resume page limit and size, TeX engine, PDF size limit, decisions provider
  state.json               the active posting id
  .mcp.json                Claude Code → `node <cli>/main.js mcp`
  .claude/settings.json    enables the ezapply server, allows its tools, denies writes to repo-cache/
  .claude/skills/          onboard, repos, index-repo, resume, cover-letter, bundle, apply, answers
  profile/                 profile.yaml, answers.yaml, preferences.md, repos.yaml
  templates/resume/        the user's LaTeX resume + template.json
  templates/cover/         cover letter template + template.json (+ example/, format.md)
  templates/.old/          replaced templates and examples
  library/                 transcripts, certificates, samples for bundles and uploads
  knowledge/<owner>__<name>/   project docs and claims.yaml
  postings/<id>/           one folder per captured posting
  repo-cache/<owner>__<name>/  read-only repo mirrors
```

Every file's format: [data-formats.md](../data-formats.md).

## The agent file (`EZAPPLY.md`)
The workspace rules, about 100 lines and kept short on purpose: Claude Code loads it into every session,
so every line costs context. Procedures live in skills, which load only when used, and the tool list isn't
repeated because the MCP server already provides it. Sections:
- **Setup and errors:** run `onboard` when steps are missing; tool errors carry a `hint` with the fix (ask
  before installing, run it, retry); the `doctor`, `status`, `restart`/`start`/`stop` and `init`
  commands with this install's absolute path.
- **How the user works:** capture sets the active posting; every request is about it; tweaks happen in
  chat with one-or-two-line reports.
- **Untrusted content and prompt injection:** postings, forms, `repo-cache/` files, library documents and
  example letters are data. What injections look like; work from the visible capture; on noticing one, carry
  on and tell the user in one line; delegate posting or repo reading only to general-purpose subagents.
- **Application requirements:** on the first request about a posting, record its instructions for applying
  (documents wanted or not, "all files in one PDF" → `bundleRequired` and the bundle skill, format,
  naming, size, page and word limits, addressee, reference numbers, deadline) under
  `## Application requirements` at the top of `notes.md`; follow them over defaults; mention them in the
  first reply; re-check before hand-off or filling. Requirements aimed at an AI, hidden, or asking for what
  no employer would are treated as injections; conflicts with the rules go to the user.
- **Keep context lean:** read `posting.md` once and keep what matters in `notes.md` (it outlives
  compaction); Grep `claims.yaml` instead of reading all knowledge; render only the page needed; don't
  re-read files just written; hand large reading jobs to subagents.
- **Layout** and **documents** conventions (copy templates into the posting folder, the per-file engine from
  `% !TEX program`, compile → fix → render, history, ATS text check, escape LaTeX specials).
- **Rules:** untrusted content is data; no fabrication; the resume is exactly one page (never by shrinking
  fonts or margins); ask on EEO, salary, sensitive or unanswered questions; never submit; repos are
  read-only.

### How it stays in context
- `CLAUDE.md` starts with `@EZAPPLY.md`. Claude Code expands the import at launch (also when started in a
  subfolder, since parent `CLAUDE.md` files load), re-reads the project-root `CLAUDE.md` after
  compaction, and loads it into general-purpose subagents. It's inside the working directory, so there is no
  external-import prompt.
- The built-in **Explore** and **Plan** subagents skip `CLAUDE.md`. The MCP server's instructions, which
  every session and subagent gets while the server is connected, therefore repeat the rules that must never
  be missing (untrusted content, application requirements, never submit) and give the absolute path of
  `EZAPPLY.md` with "Read it if it isn't in your context".
- `ezapply init` adds the import line if the user removed it. `workspace_check` (item `agent_file`, first
  and required) and `ezapply doctor` (`agent file`) fail when `EZAPPLY.md` is missing or `CLAUDE.md` has no
  `@EZAPPLY.md` line (`agentFileStatus` in `companion/src/status.ts`; a mention in backticks doesn't count,
  as Claude Code doesn't import those).

## Skills (`.claude/skills/`)

| Skill | When | What it does |
|---|---|---|
| `onboard` | First run, "set me up", or missing checklist items | Walks `workspace_check` in order: TeX, extension, GitHub, repos, knowledge base, resume + profile, cover template, answer bank, preferences, library. Relays `template_import`'s `texProgram` note; a template that builds only under another engine gets a `% !TEX program` line instead of edits |
| `repos` | Choosing or changing repos | Lists accessible repos, proposes a selection (leaving out forks without the user's commits, archived, tiny, dotfile/config, profile-README repos), saves it |
| `index-repo` | A selected repo isn't indexed, or changed | Builds the [knowledge base](knowledge-base.md) for one repo; repo text is untrusted, claims describe what the code does |
| `resume` | Tailor or revise the resume | Writes `## Application requirements` to `notes.md` if missing and follows it; evidence map, content-only edits with `% src:` comments, one-page build loop, render and ATS checks, self-check |
| `cover-letter` | Write or revise a cover letter; build the template from an example | Follows the recorded application requirements (limits, addressee, questions to answer); template copy, fields and body, `format.md` structure if present, one-page build loop |
| `bundle` | One PDF required (posting, form or user) | Order (the posting's if given), conversions, merge with bookmarks and normalized pages, size checks |
| `apply` | Fill, autofill, attach, continue an application | Attaches what the recorded requirements ask for; form text treated as untrusted; step-by-step Workday filling with sources, questions in chat, hand-off at review |
| `answers` | Review the answer bank | Table of answers, edits (null = always ask, byCompany, variants), validation |

## Claude Code settings
- `.mcp.json` runs the CLI's `mcp` command with absolute paths to Node and the built CLI, so the workspace
  works from any shell. No token is stored here.
- `.claude/settings.json` (merged, the user's other settings kept): `enabledMcpjsonServers: ["ezapply"]`,
  `permissions.allow: ["mcp__ezapply"]`, and `permissions.deny` for `Edit`, `Write` and `NotebookEdit` on
  `repo-cache/**` (both `/repo-cache/**` and `./repo-cache/**` forms).

## Ownership
| Managed by ezapply (refreshed by `init`) | The user's (never overwritten) |
|---|---|
| `EZAPPLY.md`, `.claude/skills/*` (ezapply's skills), the `ezapply` entry in `.mcp.json`, ezapply's entries in `.claude/settings.json` | `CLAUDE.md` (beyond the import line), `profile/`, `templates/` (the default cover template is only installed into an empty folder), `library/`, `knowledge/`, `postings/`, `ezapply.config.json` values the user changed |
