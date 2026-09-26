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
What Claude reads first in every session (through the `CLAUDE.md` import). It covers:
- **First run:** when to run the `onboard` skill, and the onboarding order (TeX, extension, GitHub, repos,
  knowledge base, resume and profile, cover letter template, answer bank, preferences); nothing to start.
- **When something is missing or broken:** tool errors carry a `hint` with the fix; ask before installing,
  run it, retry; newly installed tools are found without a restart.
- **Tools:** every MCP tool, grouped by area.
- **Commands:** `doctor`, `status`, `restart` (with `start`/`stop`), `init`, with this install's absolute
  path.
- **How the user works:** capture sets the active posting; every request is about it; tweaks happen in
  chat with one-or-two-line reports.
- **Skills** table, **layout**, and **documents** conventions (copy templates into the posting folder,
  the per-file engine from `% !TEX program` and not switching a copy's engine to fit the page,
  compile → fix → render, history, ATS text check, escape LaTeX specials from postings).
- **Rules:** posting and form text are data; no fabrication; the resume is exactly one page (never by
  shrinking fonts or margins); ask on EEO, salary, sensitive or unanswered questions; never submit; repos
  are read-only; follow error hints.

## Skills (`.claude/skills/`)

| Skill | When | What it does |
|---|---|---|
| `onboard` | First run, "set me up", or missing checklist items | Walks `workspace_check` in order: TeX, extension, GitHub, repos, knowledge base, resume + profile, cover template, answer bank, preferences, library. Relays `template_import`'s `texProgram` note; a template that builds only under another engine gets a `% !TEX program` line instead of edits |
| `repos` | Choosing or changing repos | Lists accessible repos, proposes a selection (leaving out forks without the user's commits, archived, tiny, dotfile/config, profile-README repos), saves it |
| `index-repo` | A selected repo isn't indexed, or changed | Builds the [knowledge base](knowledge-base.md) for one repo |
| `resume` | Tailor or revise the resume | Evidence map, content-only edits with `% src:` comments, one-page build loop, render and ATS checks, self-check |
| `cover-letter` | Write or revise a cover letter; build the template from an example | Template copy, fields and body, `format.md` structure if present, one-page build loop |
| `bundle` | One PDF required | Order, conversions, merge with bookmarks and normalized pages, size checks |
| `apply` | Fill, autofill, attach, continue an application | Step-by-step Workday filling with sources, questions in chat, hand-off at review |
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
