# Security and privacy

ezapply handles personal data, drives a browser, and reads source code. Its threat model is a single user
on their own machine, facing hostile **content** (postings, forms, web pages), and other **software**
(websites, other local processes) trying to use its capabilities.

## Threats and controls

| Threat | Controls |
|---|---|
| **A web page calls the daemon** (CSRF, DNS rebinding) | Binds to `127.0.0.1` only. Every HTTP request must name the bound loopback host (`Host` check). `/mcp` and `/control/*` require the bearer token and refuse any request with an `Origin` header, which browsers always send cross-site. GitHub pages need one-time, 30-minute state values; the login start needs a nonce issued to Claude; the one POST route (the existing-app form) needs the state from the form page, which another site can't read |
| **An existing app's client secret leaking** | The user enters it on the daemon's own page, never in chat, so it isn't in any transcript. It stays in memory until a login with it succeeds, then goes to the keychain; a failed login stores nothing. The page's CSP lets forms post only to the daemon itself and GitHub |
| **A web page or local program impersonates the extension** | WebSocket upgrades must come from an extension origin (`chrome-extension://…` or `moz-extension://…`); after pairing, only the pinned id. The `hello` must carry the pairing code, or arrive while a pairing window is open. Opening a window takes the MCP token or an MCP session. A window closes after one pairing |
| **Prompt injection in a posting, form or repo** | Postings are captured twice: raw, and visible-only. `posting.md` is built from the visible copy, so hidden text never reaches the default context. `EZAPPLY.md` names the sources (postings, forms, `repo-cache/` files, library documents, example letters), describes what injections look like, and says to never act on them and to tell the user; the MCP instructions repeat it for sessions and subagents without `CLAUDE.md`, and the `ezapply-apply` and `ezapply-index-repo` skills restate it. A posting's application requirements are honoured only when they concern what a human applicant submits; anything aimed at an AI, hidden, or unusual is treated as an injection. The tool set can't click arbitrary elements, run scripts, navigate, or submit, which bounds what a successful injection could do |
| **Attaching what the user didn't see** | In the default `after-approval` attach mode, `upload_file` refuses a generated document unless the user approved that exact version (SHA-256) on the review page. No tool approves, and approval in chat doesn't count, so an injection can't approve either. The review page and its PDFs need a random token in the URL (compared in constant time), are served only to the loopback host, can't be framed by other origins, and allow forms only to the daemon itself |
| **Submitting without the user** | No submit or general click tool. `go_next` refuses on review and on submit controls. The adapter refuses to touch submit controls. The page-level submit guard cancels untrusted click/pointer/key/submit events aimed at a submit control. Real clicks are trusted and always work |
| **Changing or running the user's code** | The GitHub App has only `contents: read` and `metadata: read`. Repos are mirrored into `repo-cache/`, never the user's working copies. Files are read-only after every sync. Claude Code settings deny Edit/Write/NotebookEdit there. Skills forbid building, installing or running anything from it |
| **Malicious repo content attacking git** | HTTPS-only transports (no `file://`, ssh, `ext::`), symlinks off, hooks off, credential helpers off, no prompts. The token is passed per command and never written to `.git/config` |
| **Other local users reading the GitHub token** | git gets it through `GIT_CONFIG_*` environment variables, not its command line: a process's arguments are readable by other users on Linux (`/proc/<pid>/cmdline`), its environment isn't |
| **Malicious TeX from posting text** | Shell escape is always disabled for every engine; a `% !TEX program` comment can only pick from a fixed list of engine names and is never passed to a process, and option-style comments (`% !TEX options`, `program = pdflatex --shell-escape`) are refused or ignored; builds time out and are killed with their process tree; TeX sources must be under `postings/` or `templates/` |
| **Reading or writing outside the workspace** | Every path from Claude is resolved and checked against the folders each operation allows. Uploads only from `postings/` and `library/` (≤25 MB). Template and example imports copy from outside, never link. A template's `main` must stay inside `templates/<kind>/`, and posting ids must be plain folder names, so `../x` can't reach outside `postings/` |
| **Something handed to the OS opener** | `open_file` opens only paths from the allowed folders; `github_login` opens only `http://127.0.0.1:<port>/` URLs (anything else is refused before it reaches the opener). Neither goes through a shell |
| **Filling or marking the wrong application** | Form activity is credited to the active posting only when the tab is on its Workday tenant; otherwise nothing is logged or moved and Claude is told (`postingMismatch`). The default tab is the one on the active posting's tenant |
| **The extension being made to talk to other servers** | Firefox build: extension pages may only connect to `ws://127.0.0.1:*` (`connect-src`), and scripts only from the extension (`script-src 'self'`) |
| **The extension reaching more sites than it needs** | Host permissions only for Workday's candidate sites (`*.myworkdayjobs.com`, `*.myworkdaysite.com`); not Workday's marketing site or employee tenants. Capture uses the click's `activeTab` grant, which doesn't extend to other sites' frames (an unreadable embedded board is opened in its own tab instead) |
| **Another local program steering `ezapply chat`** | `/control/chat` needs the bearer token like every control route, and only reads: whether a session has used a tool, how many calls run, the active posting. The session header only feeds those counts; a forged one could at most make the wrapper restart (or not restart) its own Claude, which the user started and can `claude --resume`. The wrapper ends only the Claude it started |
| **The daemon running forever in the background** | It stops after 15 minutes without work (configurable, 0 = never), so its port is only open while ezapply is in use (an `ezapply chat` window counts as use: its polling is work) |
| **Secrets leaking** | GitHub secrets live in the OS keychain. `daemon.json` is mode 0600. `.mcp.json` holds no token. Logs redact page content, form values, tokens and authorization headers |
| **Personal data leaving the machine** | Nothing is sent anywhere except the GitHub API (repo metadata and contents) and what the user puts into an application. A future decision provider would get only the slice each question needs |
| **Filling what the user didn't approve** | Passwords are never filled. EEO answers come only from the profile, verbatim. Sensitive, unanswered, EEO and salary questions are asked in chat. Every fill is logged with its source |

## Accepted limits
- Anything running as the user can read `~/.ezapply/daemon.json` and so reach the daemon. That's the same
  trust boundary as the user's other files; the pairing code and MCP token protect against the browser
  and other users, not against the user's own malware.
- Code-less pairing (an open pairing window admits an extension that sends an empty code) is no weaker
  than typing the code: the code was always readable from that same `daemon.json`, and opening a window
  needs an MCP session or the MCP token from it. The window admits one extension and closes, and
  extension-id pinning still applies, so it never admits a second one.
- Firefox temporary add-ons are unsigned; for permanent installs the add-on must be signed as unlisted.
- The Workday adapter runs in the page's own JavaScript context, so the page could in principle observe
  or tamper with it. It holds no secrets there: it gets only the values it's asked to fill.
