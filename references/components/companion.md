# Companion (`packages/companion`)

The code that does all real work: it serves the MCP tools, holds the connection to the browser extension,
and reads and writes the workspace. It's a library: `ezapply` calls `startCompanion` in its own process
and runs it for as long as it's open ([cli](cli.md#ezapply-panelts)); there is no background daemon
([architecture](../architecture.md#processes-and-lifecycle)). The CLI also imports the helpers exported from
`src/index.ts`, which loads all of the companion; `@ezapply/companion/light` (`src/light.ts`: the app config, the
version, the endpoints) loads none of the services, for the commands that must start fast
([cli](cli.md#commands)). Everything it knows about a particular site (the registry, the sites' notes for the agent, their
posting readers) it imports from [the sites package](sites.md#the-package): `@ezapply/sites`, `/notes`, `/readers`.

## Source layout

| Path | Role |
|---|---|
| `main.ts` | `startCompanion(options)`: builds every service, the bridge and the HTTP server; returns `{ port, services, onServerError, close }` |
| `services.ts` | The `Services` object handed to every tool: `version`, `log`, `workspace`, `postings`, `documents`, `reviews`, `profile`, `templates`, `github`, `repos`, `freshness`, `forms`, `onboarding`, `agent`, `needs`, `bridge`, `opener`, `ui`, `extensionDir?` |
| `http.ts` | The HTTP server: routes, guards, stateless MCP transport with the request's session |
| `endpoints.ts` | What the HTTP server and the CLI's relay agree on: `MCP_PATH`, `HEALTH_PATH`, `SESSION_ENV`, `SESSION_HEADER`. No imports, so the light entry stays light |
| `mcp/server.ts` | Creates the `McpServer` and registers the tool groups, with the session of the request (the form tools give a site's notes once per session; `ask_user` knows the conversation) |
| `mcp/tools/postings.ts`, `browser.ts`, `documents.ts`, `profile.ts`, `onboarding.ts`, `templates.ts`, `github.ts`, `forms.ts`, `agent.ts` | One module per tool group ([mcp-tools.md](../mcp-tools.md)) |
| `mcp/result.ts` | `tool()` / `rawTool()`: turn results into compact JSON text and errors into `{ error }` results |
| `forms/service.ts` | `FormsService`: tab choice (tabs of any registry site, and applications embedded in other pages as tabs of their own: `formTabs`, with every call on one naming its frame: `framed`; [embedded applications](../mcp-tools.md#forms)), one call per tab at a time, `tab.show` before each call (focus emulation on the tab; where it can't run, `tabHidden` when the tab is hidden, `browserBehind` when the window is behind another app: [the tab at full speed](../mcp-tools.md#forms)), crediting form activity to the posting the tab may belong to and binding the tab to it on the first change (`decide`, `claim`, `bindTab`: [which posting](../mcp-tools.md#forms)), `form-log.jsonl`, status moves, the hand-off at the review page or a step whose only way on is Submit (`lastPage`), reading files for upload, `notAttached` (approved documents no upload attached, after an upload and at review), the lean `get_form` ([mcp-tools](../mcp-tools.md#forms)); `forms/checklist.ts`: `stepWarnings` and `handoff`, the hand-off checklist ([mcp-tools](../mcp-tools.md#forms)); `forms/debug.ts`: `DebugRecorder` (debug mode: a record per form call when `debug.enabled` is on, with the adapter's trace of each bridge call and its markup and screenshots as files of their own: `extractFiles`), `debugRequest` (what each adapter call asks for, by `debug.markup`), `pruneDebug`, `stripBulk`; `forms/debug-report.ts`: `debugReport` (what `ezapply debug report` prints); `forms/debug-export.ts`: `debugExport`, `scrub`, `profileStrings` (`ezapply debug export`: [cli](cli.md#debug-export)); `forms/lists.ts`: which profile list a section, add button or saved item belongs to, and the profile's links, for the checklist; `forms/timing.ts`: `loadTiming(ws, site)` (reads `autofill-timing.yaml` for every call: the top-level waits and the tab's site's section, resolved against that site's own waits) and `timingFileTemplate` |
| `forms/marks.ts` | `markFields`: get_form's `prefilled`, `stale` and `bankMatch` marks; `bankIndex` ([forms](../mcp-tools.md#forms)) |
| `forms/match.ts` | Which posting an application tab belongs to: `postingFacts`, `matchPosting` (evidence: site, job, binding, the page's requisition, tenant, title), `compareTitles` ([which posting](../mcp-tools.md#forms)) |
| `bridge/server.ts` | `ExtensionBridge`: WebSocket endpoint, handshake, pinning, pairing window, RPC to the extension; `onConnectionChange` (the side panel's watch ends with the connection) |
| `bridge/pairing.ts` | `startPairing` (open the pairing window, optionally forgetting the paired extension) and `extensionFolders` (what to load, and whether it's built): shared by `extension_pair` and the onboarding page |
| `onboarding/service.ts` | `OnboardingService`: the onboarding page's session, routes and actions, its state (from `workspace_check` and the services), the agent's task queue behind `onboarding`, and the watch that tells an open page what changed elsewhere; `skipReason` (repos not suggested) → [ui](ui.md#the-onboarding-page-onboard) |
| `agent/` | `AgentService` (the panel's conversations, an agent process per conversation, side by side), the agents' backends (Claude Code's `AgentProcess` and `findClaude`, Antigravity's `AntigravityProcess` and `findAntigravity`, Codex's `CodexProcess` and `findCodex`), `readStreamLine`, `NeedsYou` (the agent's questions and approvals waiting on the user), `PanelService` (the side panel's `panel.*` methods and the updates pushed to it) → [agent](agent.md) |
| `ui/assets.ts` | `UiAssets`: the UI package's files at `/ui/`, each page's HTML shell, `UI_CSP`, the base stylesheet's address → [ui](ui.md#serving-companionsrcuiassetsts) |
| `ui/session.ts` | What the pages share: the token traded for a cookie (`presentedToken`, `pageCookie`, `tokenOk`), `sameOrigin`, `readJsonBody`, `sendJson`, `EventStreams` (Server-Sent Events) → [ui](ui.md#how-a-page-talks-to-the-companion) |
| `status.ts` | `workspaceStatus`: the readiness checklist behind `workspace_check` |
| `freshness/service.ts` | `FreshnessService`: what in the workspace is behind its source, behind `workspace_changes` and the Workspace changes card ([below](#keeping-the-workspace-current-workspace_changes)) |
| `freshness/updates.ts` | `WorkspaceUpdates`: what the card's and the setup page's buttons do to a change, by code or as an agent task ([below](#acting-on-a-change-workspaceupdates)) |
| `postings/` | Capture ingest and extraction, the application a posting is tied to (`application.ts`) → [postings.md](postings.md) |
| `documents/` | `service.ts`, `tailor.ts` (`document_start`, `bundle_build`), `agent-review.ts` (the review a panel conversation opens, and the one at a tailoring turn's end), `content-lint.ts` (the content findings and the sources check), `review.ts` (the review page's API, approvals, `reviewed.json`, the attach mode; for the side panel `onChange`, `openFor`, `urlOf`, `documentStates`), `tex/engines.ts`, `tex/log.ts`, `pdf/toolkit.ts`, `pdf/pages.ts` (Letter/A4 sizes, page-range parsing) → [documents.md](documents.md) |
| `profile/` | `service.ts` (profile, answers, repo selection, preferences, library; the onboarding page's in-place writes: `saveProfile`, `saveAnswers`, `savePreferences`, `parsePreferences`, `formatPreferences`), `schema.ts`, `seed-answers.ts` (the 33 seeded screening questions) → [profile-and-templates.md](profile-and-templates.md) |
| `templates/service.ts` | `TemplateService`: template import, example letters, the main file and its content files, the engine a template needs → [profile-and-templates.md](profile-and-templates.md#templates-templatesresume-templatescover) |
| `github/` | `service.ts` (App, login, tokens, repo listing), `secrets.ts` (`SecretStore`: OS keychain, or memory in tests) → [github-and-repos.md](github-and-repos.md) |
| `repos/` | Read-only repo cache, contributions, claims, knowledge meta; `index-plan.ts` (`repo_sync`'s mode, ignored paths, components) → [github-and-repos.md](github-and-repos.md), [knowledge-base.md](knowledge-base.md) |
| `workspace/workspace.ts` | `Workspace`: paths, `resolveAllowed` guard, config and `state.json` (one write at a time, expired repo timers dropped on each; `dropDeferredRepos`); `WORKSPACE_DIRS` |
| `config/app.ts`, `config/workspace.ts` | `~/.ezapply/config.json` (load with readable errors and the move from an earlier build's `daemon.json`, `updateAppConfig`) and `ezapply.config.json` schemas, token generators, `appDir()` |
| `logger.ts` | pino logger to the log file only, with redaction and size-based rotation (`rotateLog`) |
| `util/fs.ts` | `exists`, `readJson`, `writeFileAtomic` (text or bytes; a locked target is retried, then reported → [atomic writes](../architecture.md#cross-cutting-concerns)), `writeJsonAtomic` |
| `util/keyed-queue.ts` | `KeyedQueue`: one task at a time per key |
| `util/hash.ts` | `hashFiles` (12 hex of SHA-256 over files' paths and contents, line endings normalised) and `hashValue` (over a value's JSON) |
| `util/line-diff.ts` | `unifiedDiff`: a line diff with context, for the resume template's changes |
| `util/open.ts` | `Opener` and `createDesktopOpener`: the companion's pages and PDFs in the user's browser, other files in their default app ([below](#opening-pages-and-files-utilopents)) |
| `util/browser.ts` | `findBrowser`: the program that opens a URL in a given browser on this machine |
| `util/wait.ts` | `waitFor(probe, timeout)`: polling, also used by the CLI |
| `util/html.ts` | `htmlPage` (the companion's own pages: no scripts, never framed, CSP per page, the UI package's stylesheet once `useStylesheet` is set), `escapeHtml`, `readForm` |
| `util/dialog.ts` | `pickPath`: the OS's own folder or `.tex` file dialog for the onboarding page; `dialogCommand` → [ui](ui.md#writing-the-users-files) |
| `util/proc.ts` | `run()` (no shell, tree-kill on timeout), `which()` |
| `util/install-hints.ts` | OS-specific install commands for TeX, git and Ghostscript: `installCommand` (for people, `ezapply doctor`) and `installHint` (for Claude, in error hints) |
| `version.ts` | `COMPANION_VERSION` (kept equal to the package version by a test) |

## Startup (`startCompanion`)
1. Read and validate the workspace config (fails fast on an invalid `ezapply.config.json`).
2. Build services, with `UiAssets` (the `ui` option overrides it) whose stylesheet the companion's own pages take,
   and `OnboardingService`; seed `profile/answers.yaml` if it doesn't exist.
3. Build the bridge with the pairing code, the pinned id, `onPaired` / `onForgotten`, which persist the pairing,
   the handlers for `posting.capture`, `posting.submitted` (`FormsService.submitted`) and the side panel's `panel.*` methods, and `onConnectionChange`. Build
   `NeedsYou` and `AgentService` (with the agents the `claude`, `antigravity` and `codex` options give), and `PanelService`, whose
   pushes go to the extension only while it's connected.
4. Build `FormsService` over postings and the bridge, and the HTTP server; listen on
   `config.host:config.port` (port 0 picks a free one, for tests). A taken port rejects with `EADDRINUSE`,
   which `ezapply` turns into a message.
5. Start the workspace check's repo check in the background (`FreshnessService.start`): it never delays
   `/health`, the extension's handshake or the first tool call ([below](#keeping-the-workspace-current-workspace_changes)).
6. Start relaying to the side panel (`PanelService.start`): the agent's events and state, the cards, postings
   and reviews.

**Persisting pairing** changes only the pairing fields of `config.json` as it is on disk at that moment
(`updateAppConfig`), not the copy read at start. Otherwise an `ezapply init --port` made while ezapply ran
would be undone the next time an extension paired.

Options: `config`, `log`, `saveConfig` (tests: receives the whole new config instead of the file update),
`appDataDir`, `secrets` (keychain by default), `opener` (by default `createDesktopOpener` with the browser
the bridge reports; tests stub it), `claude`, `antigravity` and `codex` (the agents the side panel can run: `ezapply` passes those it finds; tests mostly don't),
`extensionDir` (so `extension_pair` can name the build folders), `reconnectGraceMs` (tests), and GitHub test
hooks.

The handle: `port`, `services`, `onServerError(fn)` (an error on the server after it
listens; `ezapply` logs it), and `close()` (extension socket closed with 1001, server connections
dropped, server closed); it ends the agents' processes first.

**Nothing reaches the terminal.** The companion runs in the `ezapply` process, whose terminal shows only its own
few lines, so it never writes to stdout or stderr: the logger writes to the log file only, jsdom gets a silent
`VirtualConsole` (it forwards a page's CSS parse errors to `console.error` by default), and pdfjs runs at
`verbosity: 0`. What libraries still print goes to the log through `ezapply`'s `quietProcess`
([cli](cli.md#ezapply-panelts)).

## HTTP surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | `{ ok, name: "ezapply", version, protocolVersion, extensionConnected }`; no user data |
| `/mcp` | POST | Bearer `mcpToken`, no `Origin` | MCP Streamable HTTP. Stateless: a fresh `McpServer` and transport per request, built with the request's session (`x-ezapply-session`, [below](#sessions)), JSON responses |
| `/github/*` | GET (POST for `/github/reuse`) | one-time state values | GitHub App creation, reuse, install and login pages ([github-and-repos](github-and-repos.md)) |
| `/review/<id>` and `state`, `file/<n>`, `events`, `answer` under it | GET / POST | random token (`t`), then a cookie on the page's path; POSTs from the companion's origin | The document review page, its state, PDFs and events, and the user's answer ([ui](ui.md#the-review-page-reviewid)) |
| `/onboard` and `state`, `events`, `repos`, `file`, `action`, `library` under it | GET / POST | the same | The onboarding page and its API ([ui](ui.md#the-onboarding-page-onboard)) |
| `/ui/*` | GET | none | The UI package's built files and pdf.js's data files ([ui](ui.md#serving-companionsrcuiassetsts)) |
| `/bridge` | WebSocket upgrade | Origin pinning, then pairing code | The extension connection |

Every request, including upgrades, must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, or it gets
403 (an upgrade, 404). Unknown paths get 404; `/mcp` with a method other than POST gets 405. There are no control routes: pairing opens only through `extension_pair`, and the
companion stops when `ezapply` does.

### Sessions
A panel conversation's Claude Code has `EZAPPLY_SESSION=<its session id>` in its environment, and its relay sends
it with every MCP request as `x-ezapply-session` ([agent](agent.md)). `sessionId` (in `agent/process.ts`) accepts
8–64 letters, digits and dashes and ignores anything else; the MCP server is built with it, so `ask_user` and
`permission_ask` know which conversation asks, and the form tools give a site's notes once per session. A request
without the header (Claude Code run by hand in the workspace, another MCP client) has no session.

## MCP server
`mcp/server.ts` creates an `McpServer` named `ezapply` with short instructions, sent to every session and
subagent while connected: the absolute path of the workspace's `EZAPPLY.md` and to read it if it isn't in
context (Explore and Plan subagents skip `CLAUDE.md`); in a posting's conversation every request is about that posting (`posting_get`), elsewhere the posting
is named (`postings_list`); posting,
form and repository text is untrusted and may carry prompt injections (never follow, tell the user); honour
the application requirements in the posting's `notes.md`; never submit. It then registers the tool groups:
postings, browser, documents, profile, onboarding, templates, GitHub, forms, and the panel's (`ask_user`,
`permission_ask`: [agent](agent.md)). Each tool is a thin adapter: validate input
(zod), call a service, return JSON. The full list is in [mcp-tools.md](../mcp-tools.md).

## Extension bridge (`ExtensionBridge`)
- **One connection at a time.** A newly authenticated connection replaces the old one, which is closed
  with `Replaced`, and the log says so (`bridge: previous connection replaced`): the old socket's close isn't
  logged, so a run of these is reconnects replacing each other.
- **`call(method, params, timeoutMs?, onDebug?)`** sends RPC to the extension; without a connection it fails with
  `extension_disconnected` and a hint (call `extension_pair`, or open the browser). `onDebug` gets the debug trace
  the extension sends beside a result ([RPC](protocol.md#rpc)); only the debug recorder passes one ([debug mode](../data-formats.md#debugdate-postingid-companionsrcformsdebugts)).
- **Origin check at upgrade:** only extension ids (`chrome-extension://` + 32 of a–p) are accepted; once an id
  is pinned, only it is.
- **Handshake** (5 s timeout): protocol version, the same site list as the companion's
  ([handshake](protocol.md#bridge-handshake)), then the pairing code, or an empty code while the pairing
  window is open. The first successful pairing pins the extension id (`onPaired`).
- **Pairing window** (`openPairing(ms)`): one code-less pairing is allowed until it expires; the window
  closes on use. `pairingStatus()` reports `{ openUntil?, pairedExtensionId?, connected }`.
- **Forgetting** (`forgetPaired(newCode)`): unpins, replaces the pairing code (so the old extension's
  stored code stops working), drops the current connection at once, and persists (`onForgotten`).
- **After `ezapply` starts** the paired extension needs up to its 30 s alarm to reconnect. For 40 s
  after start (`RECONNECT_GRACE_MS`), `call()` and `settled()` wait for it when it's paired but not
  connected. The user typing their first message usually uses most of that window up, so the wait is rarely
  felt. The wait doesn't depend on when the extension was last seen: `ezapply` is started by a user at the
  computer, whose browser is likely open. A `hello` with `pendingCapture: true` makes `settled()` also wait
  (up to 15 s) until that `posting.capture` has been handled. `settled()` returns `{ extensionReconnecting }`:
  true while the paired extension hasn't connected since the start (the grace period ran out first), which
  `posting_get` and `postings_list` pass on to Claude.
- **The browser** the extension reports in `hello` is kept (`browser()`), also after it disconnects, for the
  opener; `status()` includes it.
- `status()` reports connection details for `browser_status` and `workspace_check` ("connected in Edge").

## Opening pages and files (`util/open.ts`)
What ezapply opens for the user (the GitHub login and setup pages, the document review page, `open_file`)
belongs in the browser they apply in: the one with the extension, their sign-ins and the application site's session. The
system default browser may be another one. So the extension reports its browser in `hello`
([extension](extension.md#source-layout)), and `createDesktopOpener({ browser })` starts that browser's program
with the URL; handed a URL, a running browser opens it as a new tab in its open window.

- **Finding the program** (`findBrowser` in `util/browser.ts`): on Windows, the `App Paths` registry key
  installers write (`HKCU`, then `HKLM`; `%VARIABLES%` expanded), then the usual folders under Program Files,
  Program Files (x86) and Local AppData; on macOS the `.app` bundle in `/Applications` or `~/Applications`,
  run as `open -a <bundle>`; elsewhere the browser's command on PATH (`google-chrome`, `microsoft-edge`…). Chromium
  isn't looked up in App Paths: its program is also `chrome.exe`, and that key belongs to Google Chrome.
  Found programs are cached for the chat; a miss isn't, so a browser installed later is found.
- **Pages** (`url`): only `http://127.0.0.1:<port>/` (`assertLocalUrl`), in the reported browser.
- **Files** (`file`): a PDF, image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) or `.txt` opens in the reported browser
  as a `file://` URL; anything else in its default application. A posting's captured `.html` and `.svg` never
  go to the browser: they could run script in a tab of the browser that holds the user's sessions.
- **Fallback:** no browser reported yet (the extension hasn't connected in this chat), a name the companion
  doesn't know, its program not found, or a failed start → the OS opener (`explorer.exe`, `open`,
  `xdg-open`).
- Each call returns what it opened with (a browser name, or `default`); the tools pass it on as `openedIn`,
  and their `tell` names the browser ("A page opened in Edge").
- Programs start detached, without a shell, and aren't waited for.

**Why not through the extension:** an extension can open a tab for a web page, but not a local file unless the
user grants it file access in the browser's settings, and PDFs are most of what ezapply opens. Starting the
browser's own program handles pages and files the same way, and needs nothing from the user.

## Readiness checklist (`workspace_check`)
Items in onboarding order, each `{ step, done, detail, required }`:

| Step | Done when | Detail when not done |
|---|---|---|
| `agent_file` | `EZAPPLY.md` exists and `CLAUDE.md` has an `@EZAPPLY.md` line | what's wrong: run `ezapply init`, or add the line |
| `tex` | an engine resolves | the TeX install command for this OS |
| `extension` | connected (at launch, paired is enough: see below) | "paired but not connected…" or "not paired: call extension_pair" |
| `github_login` | logged in, and the app's callback port matches | app registered or not (not: ask whether to create a new app or connect an existing one); the port-mismatch fix |
| `repos_selected` | at least one repo in `repos.yaml` | |
| `knowledge_indexed` | a repo is selected and `knowledge/` has at least as many folders as repos are selected (a count, not a match by name) | indexed of selected |
| `resume_template` | `templates/resume/template.json` valid | how to import |
| `profile` | `profile.yaml` valid | errors, or commonly-needed fields still missing |
| `cover_template` | `templates/cover/template.json` valid | "run `ezapply init`"; notes default origin and example |
| `answer_bank` | valid, and only sensitive questions unanswered | answered of total |
| `preferences` (optional) | at least 10 words | |
| `attach_mode` (optional) | always | the attach mode and what it means |
| `library` (optional) | always | file count |

Returns `{ ready, nextStep?, items }`, where `nextStep` is the first required item not done. With `atLaunch`
(only [`ezapply`'s start-up check](cli.md#ezapply-panelts)), a paired extension counts as done even before it
connects: right after a start it can't have reconnected yet (it notices the companion within its 30 s alarm), so
requiring the live connection would call every workspace unfinished and open the setup page on each launch.
The onboarding page
shows these items as its steps (`agent_file` as a banner, `attach_mode` within preferences;
[ui](ui.md#the-onboarding-page-onboard)).

## Keeping the workspace current (`workspace_changes`)
`workspace_check` says whether things exist; `FreshnessService` (`freshness/service.ts`) says whether what's
derived is still current with what it came from. Most of what the agent works from is derived from something
the user keeps changing elsewhere; without this check a re-index or re-import would happen only when the user
remembered to ask.

| Kind | Derived part | Out of date when | Ended by |
|---|---|---|---|
| `repo-pushed` | `knowledge/<repo>/` | `git ls-remote <url> HEAD` (`RepoService.remoteHead`) differs from `meta.json` `indexedSha`, for a selected, indexed repo with no running timer | `knowledge_mark_indexed` after `ezapply-index-repo`; `done` is refused; `later` puts it off for a set time (below) |
| `repo-deselected` | `knowledge/<repo>/`, still read by `claims_list` | its repo isn't in `repos.yaml` (only checked while `repos.yaml` is valid) | `done`, which deletes the knowledge folder and the repo's cache (`RepoService.forget`), or selecting the repo again |
| `template-source` | `templates/<kind>/` | the hash of the importable files in `importedFrom` (a folder, or one `.tex` file) differs from `template.json` `sourceHash` | `template_import` (records the new hash), or `done` when it doesn't matter |
| `template-untracked` | `templates/<kind>/` | `importedFrom` is in a Claude Code scratchpad (`inScratchpad`: a `claude` path segment with a `scratchpad` segment below it), a copy that never changes; replaces `template-source` for that kind. Its `detail` names a library document with the same text as the template, if any | `template_import` from the user's own file, or `done`, which drops `importedFrom` and `sourceHash` (nothing left to watch) |
| `library-template` | `templates/` | a LaTeX document in `library/` (a `.tex` file with `\documentclass` and `\begin{document}`, four folders deep at most) that no template was imported from (the file, or a folder holding it), whose text differs from both templates' main files, and that isn't recorded in `synced.library` at its current hash. Its `detail` gives the `source` to import (its folder when it `\input`s files beside it) | `template_import` from it, or `done` when it isn't a template, which records its hash in `synced.library` until it changes |
| `resume-edited` | `profile.yaml` | the hash of the resume template's main file and `contentFiles` differs from `state.json` `synced.resume`; carries `diff` against `templates/.synced/resume/` (at most 200 lines) | `done` after the profile is updated from the diff |
| `profile-identity` | the cover template's `\myname`, `\mycontact` | the hash of the profile's `identity`, `contact` and `links` differs from `synced.profileIdentity` (only while a cover template exists and the profile is valid) | `done` after the fields are updated |

Each change is `{ id, kind, summary, detail, diff?, affects[] }`. The `id` names the exact state
(`repo-pushed:owner/name@<sha7>`, `template-source:resume@<hash>`, `library-template:library/resume.tex@<hash>`,
`resume-edited@<hash>`; `template-untracked:<kind>` has no state to name), so a change that was
put off and then changed again comes back under a new id, and acting on an id that's no longer current is
refused. `affects` (`claims`, `resume`, `cover`, `profile`, `forms`) says what the change feeds; the card marks it
`needed` against a conversation's work ([below](#acting-on-a-change-workspaceupdates)).

- **The repos are checked once per chat** (a run of `ezapply`), in the background from startup, and the heads kept
  for it: every posting gets its own conversations, and a check per conversation would repeat for nothing.
  `workspace_changes { refresh: true }` runs it again. Repos put off with a running timer are skipped. `ls-remote` only, never a fetch, so nothing in
  `repo-cache/` changes before the user agrees (re-indexing fetches anyway). Four repos at a time, 10 s each,
  through the same hardened git invocation as `repo_sync` (HTTPS only, the token in git's environment). A repo
  that can't be reached, or a logged-out user, goes into `notChecked` with the error's hint, never into an
  error. `workspace_changes` waits up to 15 s for a check still running, then answers with `pending: true`.
  Only the remote heads are kept from the check. On every call, the selection and the knowledge folders are
  read again: a repo whose `indexedSha` moved since the check (re-indexed, so `repo_sync` fetched at least the
  head the check saw) drops out, and so do repos no longer selected. `repo-deselected` is worked out entirely
  then, so deleting that knowledge or selecting the repo again ends it. *Why not keep the whole result:* after a
  re-index in the same chat the agent would be offered the same re-index again.
- **The local checks run on every call:** they cost milliseconds and catch an edit made mid-chat. They're
  listed while the repo check is still `pending`, along with `repo-deselected`.
- **Hashes** cover what an import copies (build output skipped, as `template_import` skips it), so compiling
  in the user's own folder isn't a change, and line endings are normalised. The `% !TEX program` line an
  import may add exists only in the workspace copy, so it isn't one either.
- **First sight is the baseline.** With no `synced.resume` or `synced.profileIdentity` yet, the check records
  the current state and reports nothing: it can't tell what changed before. A template imported before
  `sourceHash` existed is compared with its workspace copy file by file (without the added `% !TEX program`
  line): equal, the hash is recorded silently; different, it's reported as differing from the copy.
- **`later` on a repo's new commits starts a timer.** **Later** with a duration on `repo-pushed` changes
  (`FreshnessService.mark`) writes `state.json` `deferred.repos["<owner>/<name>"] = { until, at }`: 24 hours by
  default (`DEFER_DEFAULT_HOURS`), longer when the user says, capped at 90 days (`DEFER_MAX_HOURS`; a longer
  `hours` is cut to it, and the returned `until` says so) so no repo is silenced for good: deselecting it is how
  to stop for good. While it runs the repo isn't checked at all, in this chat or any other: the background
  check skips it (no `ls-remote`), and one put off after the check ran is filtered out of the result. So pushes
  made meanwhile don't ask either, unlike an id hidden for the chat. Once `until` passes, the next check
  compares the head with `indexedSha` as usual, which reports pushes made while it was put off too. The
  timer ends early when the repo is re-indexed (`RepoService.markIndexed` drops it) or deselected
  (`ProfileService.writeRepos`, behind both `repos_selection_set` and the setup page, drops timers of repos no
  longer listed). Expired timers are dropped on any write to `state.json` (`Workspace.updateState`), and only
  running timers of selected repos count. The list carries them as `deferred[] { repo, until }`, which the card
  shows and the agent answers "what did I put off?" from. *Why a timer per repo, not per id:*
  a change's id names the head, so a repo pushed to daily would come back under a new id every day; and a
  per-conversation `later` would ask about the same push in every posting's conversation.
- **`later` on anything else** is kept in the companion's memory by id, per conversation (a panel conversation's
  key, or the setup page's `setup`), until ezapply stops: that conversation doesn't show it again, another does.
  `hours` on these is refused: a template or profile behind its source feeds the next document, so asking in
  each conversation is right for them.
- **Several changes at once** (Update all, or all the repos): every id is checked before any is marked, and one
  that isn't current, `done` on a `repo-pushed`, or `hours` alongside a change that isn't a repo's refuses the
  whole request.
- **A template source that's gone** (moved, an unplugged drive) goes into `notChecked`; nothing nags about it.
- **A source nobody edits, and a file nobody imported.** A template imported from a copy Claude made in its
  scratchpad would be watched through that copy, which never changes, and a newer resume the user put in
  `library/` would go unnoticed while the agent tailored from the old template. So imports from a scratchpad
  are refused, and the two kinds above catch a template imported that way (by an older build) and a template
  dropped into `library/` without a word. *Why only a
  scratchpad, not the whole temp folder:* the temp folder also holds folders the user unpacked and works in,
  and the tests' own fixtures; a scratchpad is always Claude's copy. *Why report library documents on first
  sight,* unlike the resume baseline: a LaTeX document in `library/` that isn't the template is exactly what
  this is for, and `done` silences one that isn't a template.
- **Not checked:** repositories the app can see that were created after the selection (it would need
  `github_list_repos` and a memory of repos the user turned down), and how much a push changed (GitHub's compare
  API is rate-limited for public repos; `ezapply-index-repo` finds a push that changes nothing indexed
  cheaply). Managed files from an older build aren't this check's: `ezapply init` refreshes them.

The list reaches the user, not the agent: the panel's Workspace changes card and the setup page's Changes list
show it ([ui](ui.md#workspace-changes)), read again whenever the list may have changed (`FreshnessService.onChange`
fires after the repo check, a mark or an update, and the panel pushes `changed`). `workspace_changes` stays for the
agent, read-only, to answer what's out of date or put off.

### Acting on a change (`WorkspaceUpdates`)
`panel.workspaceChanges { key }` lists the changes for a conversation, and `panel.workspaceChange { key, ids,
action, … }` acts on them ([agent](agent.md#the-panels-side-panelts)); the setup page's `change` action calls the
same code with the key `setup`. Each change comes as `{ id, kind, summary, needed, working?, note? }`:

- **`needed`** is the change's `affects` against the conversation's work: a posting's `tailor` conversation draws
  on claims, the resume, the cover letter and the profile; `fill` on the profile and forms. The general
  conversation and the setup page need none. Tailor documents or Fill form pressed with a needed change pending
  shows the card first ([ui](ui.md#workspace-changes)).
- **`working`** while the agent's task on it is queued or running, or its file dialog is open; **`note`** keeps
  what went wrong in the background (a dialog that couldn't open, an import that failed) until it's acted on again.

**Update**, per kind, by code where it's mechanical and as an agent task where it needs judgement:

| Kind | Done by | What happens |
|---|---|---|
| `template-source` | Code | Imported again from its source with its main file (`replace`, the old copy kept in `templates/.old/`), then compiled. A failed build becomes a `fix-template-build` task carrying the replaced copy's path, which may hold the font path or engine line the environment needs |
| `template-untracked` | Code | The system's file dialog (`pick`: the folder or the `.tex` file the user edits), then the same import and build. It runs in the background: the dialog waits as long as the user takes, past the extension's 60 s relay timeout, so the answer is `dialog` and the change is `working` until it closes |
| `library-template` | Code | Imported as the `kind` the user chose (resume or cover letter); **Neither** is `done` |
| `profile-identity` | Code, else agent | In a cover template the user didn't import (ezapply's default, or one restyled from it), `\myname` and `\mycontact` are rewritten from the profile (TeX-escaped, contact as place, email, phone, links; `fillCoverIdentity`, which the setup page's **Put my name and contact in it** calls too), the profile's identity recorded as matched, and the template compiled. An imported template, or one without both macros, becomes a `fill-cover-identity` task |
| `repo-deselected` | Code | Selected again in `repos.yaml` (from the app when it lists the repo, else by address). **Delete its knowledge** is `done` with `confirm`, without which it's refused |
| `resume-edited` | Agent | An `update-profile` task with the diff |
| `repo-pushed` | Agent | All the repos pressed together in one `index-repos` task |

The tasks are setup tasks ([ui](ui.md#the-agents-side-tasks)), sent to the general conversation as "Workspace
task tN" and reported with `onboarding { taskId, result }`. A change a task works on is marked done when the
task reports success (`update-profile`, `fill-cover-identity`), or ends on its own when the knowledge is marked
indexed (`index-repos`) or the template imported again (`fix-template-build`).

**Order.** In one request, code updates run first, templates then the cover's fields, and the agent's tasks are
queued after them, so `update-profile` reads a resume imported a moment before.

*Why buttons, not an agent skill:* the user's press is the consent, so no update happens without it and the
agent can't mark a change done the user never saw (there's no tool for it); what's mechanical costs no agent
turn; and nothing costs a call at the start of each session. The agent gets only what needs judgement, as a
task with its own instructions.
