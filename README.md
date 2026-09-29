# ezapply

Tailor resumes and cover letters and fill Workday and Oracle Recruiting Cloud applications from Claude Code. A browser extension (Chrome or
Firefox) captures the posting, and `ezapply chat` runs Claude Code together with a local companion that gives
it the tools over MCP. Claude never submits. The complete, current reference (philosophy, architecture, every component, tools, data formats,
and the reasons behind them) is in [references/](references/README.md).

## Packages

| Package | What it is |
|---|---|
| `packages/protocol` | Shared zod schemas: the extension↔companion wire protocol (`PROTOCOL_VERSION`), form schema, and a typed RPC peer. |
| `packages/companion` | Runs inside `ezapply chat`: MCP server (Streamable HTTP), extension bridge (WebSocket), plus postings, documents (TeX/PDF), profile, GitHub, repos and forms. |
| `packages/cli` | The `ezapply` command (`chat`, how you run ezapply; `init`, `status`, `doctor`, and `mcp`, the stdio server Claude Code runs) plus the workspace agent file (`EZAPPLY.md`), templates and Claude Code skills. |
| `packages/extension` | MV3 extension for Chrome (`dist/`) and Firefox 128+ (`dist-firefox/`): the Set posting button, the bridge client, and the site adapters (`workday-main.js`, `oracle-main.js`, injected into the page's own JavaScript context). |

## Setup

Prerequisites: Node 22+, Chrome or Firefox 128+, and [Claude Code](https://claude.com/claude-code).

```sh
npm run setup          # install, build, and create the workspace ~/ezapply-home
cd ~/ezapply-home
./ezapply chat         # Windows: .\ezapply chat
```

Then say **"set me up"**. Claude reads the workspace's `EZAPPLY.md`, checks what's missing, and walks you
through it: installing TeX (it asks first, then runs the installer), loading and pairing the browser
extension, GitHub and your repos, your resume, profile, cover letter template and screening answers.
Anything missing later shows up as a tool error with a fix, which Claude follows.

Loading the extension is the one thing only you can do; browsers don't let anything else install an
unpacked extension. Claude gives you the page and the path. It pairs by itself; there's no code to copy.
Firefox removes temporary add-ons when it closes: load it again and ask Claude to pair it. To keep it
installed, sign it as an unlisted add-on (`npx web-ext sign`).

Day to day, run `./ezapply chat` in `~/ezapply-home` (`.\ezapply chat` on Windows). It runs ezapply and
Claude Code there, and ezapply runs only while it's open: there is no background process. When you capture a different posting it starts a fresh Claude session by itself (after any tool
call in progress finishes), so the last application isn't carried along and paid for on every turn; the old
one can be reopened with `claude --resume`. Arguments after `chat` go to `claude`, and
`context.restartOnCapture: false` in `ezapply.config.json` turns the restart off. While no chat is open the
extension's badge is grey and its tooltip says ezapply isn't running; that's normal. Open a posting and click the ezapply
button (Alt+Shift+P), then ask for a cover letter, a tailored resume, "attach them", or "fill out the
application". Postings you capture while no chat is open (the badge shows `…`) are sent when you next start one.
By default each finished resume, cover letter or bundle opens in your browser to approve or ask changes, and
only approved versions are attached; say "attach documents immediately" to skip the review (onboarding asks).

After pulling changes, run `npm run setup` again (your data is kept), then **reload the extension**
(chrome://extensions → the reload arrow; Firefox: load it again from about:debugging): most updates change
it, and a stale copy can't use newer form tools. If a chat was open, exit it and start it again. The
extension and ezapply refuse to talk across protocol versions, and the badge says which side to update.

The `ezapply` command (the workspace's `./ezapply`, `npm run ezapply -- <command>`, or
`node packages/cli/dist/main.js <command>`): `chat`, `init`, `status`, `doctor`, and `mcp` (what Claude Code
runs).

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | install, build, and `ezapply init` (safe to re-run) |
| `npm run build` | tsc project build plus the extension bundles |
| `npm test` | build, then vitest: unit tests, companion and `ezapply chat` end-to-end, mock GitHub, real git, TeX (when installed), and the Workday and Oracle adapters against fixtures and live snapshots |
| `npm run typecheck` | all packages and tests |
| `npm run lint` / `npm run format` | Biome |
| `npm run recon:workday -- <careers-url> [outDir]` | headless check of the Workday adapter on a public tenant, saving page snapshots |
| `npm run recon:oracle -- <job-url> [outDir]` | the same for an Oracle job, up to its email step |
| `npm run usage:report [-- <transcript.jsonl>]` | token usage of a Claude Code session in the workspace (default: the latest): turns, context, per prompt, per tool, per subagent |

TypeScript 7 note: if type errors look stale after changing a `tsconfig`, delete `packages/*/tsconfig.tsbuildinfo`.

## Where things live

- `~/.ezapply/config.json`: port, MCP bearer token, pairing code, pinned extension ID (Chrome's extension ID or Firefox's install UUID; to switch browsers, ask Claude to pair the extension again), workspace path (`EZAPPLY_APP_DIR` overrides the folder). Earlier builds called it `daemon.json`; it's renamed on first use.
- `~/.ezapply/github-app.json`: your private ezapply GitHub App (non-secret parts). Secrets and tokens are in the OS keychain under "ezapply".
- `~/.ezapply/logs/companion.log`: structured logs, with page content and tokens redacted; rotated at 5 MB (`.1`, `.2` kept).
- `~/ezapply-home/`: the workspace: profile, templates, knowledge, postings, library, repo cache, skills. `EZAPPLY.md` and the `ezapply` launcher are managed; `CLAUDE.md` is yours.
