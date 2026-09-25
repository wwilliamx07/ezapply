# ezapply

Tailor resumes and cover letters and fill Workday applications from Claude Code. A Chrome extension
captures the posting, and a local companion daemon gives Claude Code the tools over MCP. Claude never
submits. See [plan.md](plan.md) for the design and [docs/adr](docs/adr) for the decisions behind it.

## Packages

| Package | What it is |
|---|---|
| `packages/protocol` | Shared zod schemas: the extension↔companion wire protocol (`PROTOCOL_VERSION`), form schema, and a typed RPC peer. |
| `packages/companion` | The daemon: MCP server (Streamable HTTP), extension bridge (WebSocket), plus postings, documents (TeX/PDF), profile, GitHub, repos and forms. |
| `packages/cli` | The `ezapply` command (`init`, `daemon`, `pair`, `status`, `doctor`) plus workspace templates and Claude Code skills. |
| `packages/extension` | Chrome MV3 extension: the Set posting button, the bridge client, and the Workday adapter (`workday-main.js`, injected into the page's own JavaScript context). |

## Setup

Prerequisites: Node 22+, Chrome, git, and a TeX distribution with XeLaTeX. For MiKTeX, run
`winget install MiKTeX.MiKTeX`, then `initexmf --set-config-value=[MPM]AutoInstall=1` so missing packages
install without a prompt.

```sh
npm install
npm run build
node packages/cli/dist/main.js init            # creates ~/ezapply-home and ~/.ezapply/daemon.json
node packages/cli/dist/main.js daemon          # leave running (start it from a fresh terminal after installing TeX)
```

1. In Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `packages/extension/dist`. After rebuilding, click the extension's reload icon.
2. Pair it: enter the port and code from `ezapply pair` in the extension options. The badge turns green.
3. Run `claude` in `~/ezapply-home` and approve the `ezapply` MCP server. Then say **"onboard me"**.
4. Day to day: open a posting and click the ezapply button (Alt+Shift+P). Then ask for a cover letter, a
   tailored resume, "attach them", or "fill out the application".

After pulling changes, run `npm run build`, restart the daemon, reload the extension, and re-run
`ezapply init` to refresh skills and `EZAPPLY.md`. The extension and daemon refuse to talk across
protocol versions, and the badge says which side to update.

## Scripts

| Command | Does |
|---|---|
| `npm run build` | tsc project build plus the extension bundles |
| `npm test` | build, then vitest: unit tests, daemon end-to-end, mock GitHub, real git, TeX (when installed), and the Workday adapter against fixtures and live snapshots |
| `npm run typecheck` | all packages and tests |
| `npm run lint` / `npm run format` | Biome |
| `npm run recon:workday -- <careers-url> [outDir]` | headless check of the Workday adapter on a public tenant, saving page snapshots |

TypeScript 7 note: if type errors look stale after changing a `tsconfig`, delete `packages/*/tsconfig.tsbuildinfo`.

## Where things live

- `~/.ezapply/daemon.json`: port, MCP bearer token, pairing code, pinned extension ID, workspace path (`EZAPPLY_APP_DIR` overrides the folder).
- `~/.ezapply/github-app.json`: your private ezapply GitHub App (non-secret parts). Secrets and tokens are in the OS keychain under "ezapply".
- `~/.ezapply/logs/companion.log`: structured logs, with page content and tokens redacted.
- `~/ezapply-home/`: the workspace: profile, templates, knowledge, postings, library, repo cache, skills. `EZAPPLY.md` is managed; `CLAUDE.md` is yours.
