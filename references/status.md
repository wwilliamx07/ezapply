# Status

As of 2026-09-26.

## Done
| Area | State |
|---|---|
| Scaffold | Monorepo, protocol package, CI on Ubuntu and Windows, Biome, Vitest, `ezapply doctor` |
| Daemon, bridge, capture | MCP over the stdio relay; extension pairs, stays connected, captures; verified live in Chrome |
| Documents | TeX compile with page count, log parsing and history; per-file engine from `% !TEX program` (pdfTeX-only templates marked at import); render, text, info, merge, images, compress, open, diff |
| GitHub and repos | Per-user GitHub App via manifest, OAuth login, keychain tokens with refresh, repo listing and selection, hardened read-only cache |
| Knowledge base | `ezapply-index-repo` skill, `claims.yaml` with `claims_check`, contributions, incremental re-index |
| Profile | Profile, answer bank (33 seeded questions), repos schemas and checks; resume and cover templates, default cover letter, cover from an example; readiness checklist |
| Document skills | `ezapply-resume`, `ezapply-cover-letter`, `ezapply-bundle`; application requirements recorded in `notes.md` and followed |
| Workday read path | Page detection and extraction; posting, start-choice and sign-in verified on a live public tenant |
| Workday write path | All fillers, removing carried-over selections and attachments, repeatables, next, page actions, screenshot, submit guard, `ezapply-apply` skill; tested against a behavioural fixture |
| Audit and status | `form-log.jsonl`, automatic status, duplicate lookup by company, resume after interruption |
| Firefox | Separate build, origin support, event-page keepalive, site-access handling |
| Agent guidance | Lean `EZAPPLY.md` with prompt-injection, application-requirement and context rules; kept in context by the `CLAUDE.md` import, backed by the MCP instructions and the `agent_file` check |
| Setup | `npm run setup` + agent-led onboarding, on-demand daemon that stops after 15 idle minutes, code-less pairing, install hints for TeX and git that work without a restart |

## Not yet verified for real
- **Filling a signed-in Workday application.** Steps behind sign-in can't be reached without an account;
  the first real application is the test. That includes the remove controls for skill pills and attached
  files (`DELETE_charm`, `delete-file`), which come from knowledge of Workday's markup, not a live page.
- **A real GitHub login** (tested only against a mock GitHub).
- **Firefox in a real browser:** pairing, capture, the keepalive over several minutes, `tab.screenshot`.
  The first real load found the connection upgraded to `wss://` by Firefox's default CSP; fixed with an
  explicit CSP, awaiting a re-test.
- **Idle stop with a real browser:** reconnecting after an on-demand start and delivering a capture queued
  while the daemon was down are tested against a fake extension; the daemon stopping by itself is verified
  with the real CLI.
- **A full onboarding in Claude Code**, including installing MiKTeX through a tool hint.

## Known issues
- The TeX tests, including the default cover letter compiling to one page, pass with MiKTeX (latexmk) on
  Windows. Once, the default cover test failed while the other TeX tests passed. It didn't reproduce in
  four later runs, and the error wasn't captured. Possibly a MiKTeX first-use package download. If it
  recurs, capture the compile result's `hint` and diagnostics.

## Deferred
**DecisionProvider (e.g. Jev).** Config has `decisions.provider: "none"`, and no decision tools are
registered. The plan (`plan.md` §11) keeps the design: a `decide` interface with yes/no, choice and score
questions; a `jev` implementation over TypeSafe's API; `suggest_answers` for answer-bank matching,
polarity checks and option picking with confidence-based routing; later also claim and bullet checks.
Before enabling it: build a labelled set of about 150 real screening questions from `form-log.jsonl`
and tune thresholds. Guidance from research: batch one request per step, send only the needed profile
slice, keep polarity as its own question, do arithmetic in code, never put posting text into its state,
pin the model version.

## Open questions
1. **Resume page size:** Letter or A4 (sets the default for bundle normalization). *Assumed: Letter.*
2. **Contributions to other people's public repos:** *assumed yes*, added by URL, with claims limited to the
   user's own commits.

## Where the build departs from `plan.md`
| Plan | Built |
|---|---|
| GitHub device flow; user registers the app by hand | App Manifest flow (one click) + OAuth web flow with callbacks on the daemon ([github-and-repos](components/github-and-repos.md#github-app-githubservice)) |
| SQLite application log, `app_status` / `app_search` tools | Per-posting `meta.json` + `form-log.jsonl`; `postings_list` with a company filter ([postings](components/postings.md#no-database)) |
| Long-running daemon started by hand or at login | Started on demand by `ezapply mcp` ([architecture](architecture.md#processes-and-lifecycle)) |
| `ezapply init` then manual daemon, pairing code, `claude` | `npm run setup`, then Claude onboards; pairing without a code |
| Content script declared for Workday hosts | Adapter injected into the MAIN world on demand ([workday-adapter](components/workday-adapter.md)) |
| Chrome only | Chrome and Firefox ([extension](components/extension.md#builds-npm-run-build--w-ezapplyextension)) |
| One TeX engine for everything (latexmk + XeLaTeX) | Per file: `% !TEX program`, else `tex.engine` (default `auto`) ([documents](components/documents.md#tex-engines-texenginests)) |
| `remove_repeatable` tool | Not built |
| Playwright tests of the extension with React harnesses | jsdom tests against a behavioural fixture and live snapshots; Playwright only in the recon script |
| Changesets, per-package READMEs, `ezapply migrate` | Not used; migrations run in `ezapply init`; documentation lives here |
| Cover letter template generated in onboarding | A shipped default, the user's LaTeX, or rebuilt from an example letter |
| `docs/adr/` decision records | None: `references/` records the current design with its reasons |
