# ezapply

Tailor resumes and cover letters and fill Workday applications from Claude Code. A browser extension (Chrome or
Firefox) captures the posting, and a local companion daemon gives Claude Code the tools over MCP. Claude never
submits. The complete, current reference (philosophy, architecture, every component, tools, data formats,
and the reasons behind them) is in [references/](references/README.md).

## Packages

| Package | What it is |
|---|---|
| `packages/protocol` | Shared zod schemas: the extension↔companion wire protocol (`PROTOCOL_VERSION`), form schema, and a typed RPC peer. |
| `packages/companion` | The daemon: MCP server (Streamable HTTP), extension bridge (WebSocket), plus postings, documents (TeX/PDF), profile, GitHub, repos and forms. |
| `packages/cli` | The `ezapply` command (`init`, `doctor`, `start`/`stop`, and `mcp`, the stdio server Claude Code runs) plus the workspace agent file (`EZAPPLY.md`), templates and Claude Code skills. |
| `packages/extension` | MV3 extension for Chrome (`dist/`) and Firefox 128+ (`dist-firefox/`): the Set posting button, the bridge client, and the Workday adapter (`workday-main.js`, injected into the page's own JavaScript context). |

## Setup

Prerequisites: Node 22+, Chrome or Firefox 128+, and [Claude Code](https://claude.com/claude-code).

```sh
npm run setup          # install, build, and create the workspace ~/ezapply-home
cd ~/ezapply-home
claude
```

Then say **"set me up"**. Claude reads the workspace's `EZAPPLY.md`, checks what's missing, and walks you
through it: installing TeX (it asks first, then runs the installer), loading and pairing the browser
extension, GitHub and your repos, your resume, profile, cover letter template and screening answers.
Anything missing later shows up as a tool error with a fix, which Claude follows.

Loading the extension is the one thing only you can do; browsers don't let anything else install an
unpacked extension. Claude gives you the page and the path. It pairs by itself; there's no code to copy.
Firefox removes temporary add-ons when it closes: load it again and ask Claude to pair it. To keep it
installed, sign it as an unlisted add-on (`npx web-ext sign`).

Day to day, run `claude` in `~/ezapply-home`. There's nothing to start: Claude Code starts the ezapply
daemon when it needs it. Open a posting and click the ezapply button (Alt+Shift+P), then ask for a cover
letter, a tailored resume, "attach them", or "fill out the application". Postings you capture before
starting Claude are sent once the daemon is up.

After pulling changes, run `npm run setup` again (your data is kept), reload the extension, and run
`ezapply restart` if the daemon is running. The extension and daemon refuse to talk across protocol
versions, and the badge says which side to update.

The `ezapply` command (`npm run ezapply -- <command>`, or `node packages/cli/dist/main.js <command>`):
`doctor`, `status`, `start`, `stop`, `restart`, `pair [--reset]`, `init`, `daemon` (foreground, for
debugging), and `mcp` (what Claude Code runs).

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | install, build, and `ezapply init` (safe to re-run) |
| `npm run build` | tsc project build plus the extension bundles |
| `npm test` | build, then vitest: unit tests, daemon end-to-end, mock GitHub, real git, TeX (when installed), and the Workday adapter against fixtures and live snapshots |
| `npm run typecheck` | all packages and tests |
| `npm run lint` / `npm run format` | Biome |
| `npm run recon:workday -- <careers-url> [outDir]` | headless check of the Workday adapter on a public tenant, saving page snapshots |

TypeScript 7 note: if type errors look stale after changing a `tsconfig`, delete `packages/*/tsconfig.tsbuildinfo`.

## Where things live

- `~/.ezapply/daemon.json`: port, MCP bearer token, pairing code, pinned extension ID (Chrome's extension ID or Firefox's install UUID; to switch browsers, run `ezapply pair --reset`), workspace path (`EZAPPLY_APP_DIR` overrides the folder).
- `~/.ezapply/github-app.json`: your private ezapply GitHub App (non-secret parts). Secrets and tokens are in the OS keychain under "ezapply".
- `~/.ezapply/logs/companion.log`: structured logs, with page content and tokens redacted.
- `~/ezapply-home/`: the workspace: profile, templates, knowledge, postings, library, repo cache, skills. `EZAPPLY.md` is managed; `CLAUDE.md` is yours.
