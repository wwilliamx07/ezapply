# Security and privacy

ezapply handles personal data, drives a browser, and reads source code. Its threat model is a single user
on their own machine, facing hostile **content** (postings, forms, web pages), and other **software**
(websites, other local processes) trying to use its capabilities.

## Threats and controls

| Threat | Controls |
|---|---|
| **A web page calls the daemon** (CSRF, DNS rebinding) | Binds to `127.0.0.1` only. Every HTTP request must name the bound loopback host (`Host` check). `/mcp` and `/control/*` require the bearer token and refuse any request with an `Origin` header, which browsers always send cross-site. GitHub pages need one-time, 30-minute state values; the login start needs a nonce issued to Claude |
| **A web page or local program impersonates the extension** | WebSocket upgrades must come from an extension origin (`chrome-extension://…` or `moz-extension://…`); after pairing, only the pinned id. The `hello` must carry the pairing code, or arrive while a pairing window is open. Opening a window takes the MCP token or an MCP session. A window closes after one pairing |
| **Prompt injection in a posting or form** | Postings are captured twice: raw, and visible-only. `posting.md` is built from the visible copy, so hidden text never reaches the default context. The agent file, skills and MCP instructions say page text is data, never instructions. The tool set can't click arbitrary elements, run scripts, navigate, or submit, which bounds what a successful injection could do |
| **Submitting without the user** | No submit or general click tool. `go_next` refuses on review and on submit controls. The adapter refuses to touch submit controls. The page-level submit guard cancels untrusted click/pointer/key/submit events aimed at a submit control. Real clicks are trusted and always work |
| **Changing or running the user's code** | The GitHub App has only `contents: read` and `metadata: read`. Repos are mirrored into `repo-cache/`, never the user's working copies. Files are read-only after every sync. Claude Code settings deny Edit/Write/NotebookEdit there. Skills forbid building, installing or running anything from it |
| **Malicious repo content attacking git** | HTTPS-only transports (no `file://`, ssh, `ext::`), symlinks off, hooks off, credential helpers off, no prompts. The token is passed per command and never written to `.git/config` |
| **Malicious TeX from posting text** | Shell escape is always disabled for every engine; a `% !TEX program` comment can only pick from a fixed list of engine names and is never passed to a process, and option-style comments (`% !TEX options`, `program = pdflatex --shell-escape`) are refused or ignored; builds time out and are killed with their process tree; TeX sources must be under `postings/` or `templates/` |
| **Reading or writing outside the workspace** | Every path from Claude is resolved and checked against the folders each operation allows. Uploads only from `postings/` and `library/` (≤25 MB). Template and example imports copy from outside, never link |
| **The extension being made to talk to other servers** | Firefox build: extension pages may only connect to `ws://127.0.0.1:*` (`connect-src`), and scripts only from the extension (`script-src 'self'`) |
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
