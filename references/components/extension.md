# Browser extension (`packages/extension`)

A Manifest V3 extension for Chrome and Firefox 128+. It has one button, **Set posting**, and otherwise
quietly carries out the form reads, fills and uploads the companion asks for, on Workday and Oracle
Recruiting Cloud application pages. It has no popup and no
review UI: that happens in Claude Code and the PDF viewer.

## Source layout

| Path | Role |
|---|---|
| `src/ext.ts` | `ext`: Firefox's promise-based `browser`, else Chrome's `chrome` (typed as Chrome's API); `isFirefox` |
| `src/background/index.ts` | Entry: wiring, Set posting, lifecycle listeners and the reconnect alarm, `browser.status` handler |
| `src/background/connection.ts` | `CompanionConnection`: the WebSocket, handshake, pairing, keepalive, reconnects, RPC |
| `src/background/forms.ts` | Handlers for the form methods: choose the tab, pick the site's adapter, check site access, inject and call it |
| `src/background/settings.ts` | Typed wrapper over `storage.local`: settings, connection state, pending capture, active label |
| `src/background/badge.ts` | Toolbar badge and tooltip |
| `src/background/browser-id.ts` | `detectBrowser`: which browser this is, sent in `hello` so the companion opens pages and files there. Firefox from `runtime.getBrowserInfo()`; Chromium browsers from `navigator.userAgentData.brands`, checking Edge, Brave, Opera (and Opera GX, which installs as `opera.exe` too) and Vivaldi before Google Chrome and Chromium (they list the brand they build on too). Vivaldi hides its own brand and is reported as what it builds on; nothing known means no `browser`, and the companion uses the system default |
| `src/capture/capture.ts` | `capturePage`: runs in each frame of the posting's page (self-contained, serialized by `executeScript`) |
| `src/capture/frames.ts` | `chooseFrame` (which frame holds the posting) and `unreadableBoard` (an embedded job board it couldn't read) |
| `src/options/options.ts`, `static/options.html` | Options page: status, Workday site access, access to open Oracle sites, manual pairing |
| `src/adapters/workday/` | The Workday adapter → [workday-adapter.md](workday-adapter.md) |
| `src/adapters/oracle/` | The Oracle Recruiting Cloud adapter → [oracle-adapter.md](oracle-adapter.md) |
| `src/adapters/common/` | What both share: DOM helpers, the waits, the submit guard |
| `static/manifest.json` | The Chrome manifest; the Firefox one is derived from it at build time |
| `build.mjs` | esbuild bundles and both output folders |

## Manifest
- Permissions: `activeTab`, `scripting`, `storage`, `tabs`, `alarms`.
- Host permissions: `*://*.myworkdayjobs.com/*`, `*://*.myworkdaysite.com/*` (needed to inject the adapter
  without a click), exactly `WORKDAY_HOST_PERMISSIONS` from the protocol (a test checks both builds). Not
  `*.workday.com`: that matched Workday's marketing site and employees' own tenants (`*.myworkday.com`),
  which aren't application sites. Capture needs none: the button click grants `activeTab`.
- Optional host permissions: `https://*/*` (`ORACLE_OPTIONAL_HOST_PERMISSIONS`, tested). Oracle career sites
  can be on any host, so each is granted one origin at a time, when the user asks
  ([site access](oracle-adapter.md#site-access)); nothing is granted by the install.
- `commands._execute_action`: Alt+Shift+P runs Set posting.
- Options page embedded (`open_in_tab: false`).

## Builds (`npm run build -w @ezapply/extension`)
esbuild bundles `background.js` (ESM), `options.js`, and the adapters `workday-main.js` and `oracle-main.js`
(IIFE, about 60 KB each and without zod: they import only the protocol's import-free subpaths) for
`chrome120` and `firefox128`, with linked source maps. Each adapter gets its `ADAPTER_VERSION` stamped in: the first 12 hex characters of a SHA-256 of the bundle, written over a placeholder of the same length
(so the source map stays exact). Any change to the adapter therefore replaces older copies in open tabs,
with no version number to remember to bump.

| Folder | For | Manifest differences |
|---|---|---|
| `dist/` | Chrome (Load unpacked) | `background.service_worker`, `minimum_chrome_version: 120` |
| `dist-firefox/` | Firefox (Load Temporary Add-on → `manifest.json`) | `background.scripts` (event page); `browser_specific_settings.gecko`: id `ezapply@ezapply.local`, `strict_min_version: 128.0`, `data_collection_permissions: none`; `content_security_policy.extension_pages`: `script-src 'self'; connect-src ws://127.0.0.1:*` |

`dist/` stays at the same path because Chrome derives an unpacked extension's id from its folder, and the
companion pins that id. Firefox's fixed gecko id keeps its per-profile install UUID (the pinned value) stable
across reloads. 128 is the first Firefox with `scripting.executeScript({ world: "MAIN" })`.

The explicit Firefox CSP is required: Firefox's default MV3 policy includes `upgrade-insecure-requests`,
which silently rewrites `ws://127.0.0.1:<port>` to `wss://`, and the companion has no TLS, so the extension
could never connect ("can't establish a connection to wss://127.0.0.1:17373/bridge"). The replacement
drops that directive and allows connections only to loopback. Chrome's default policy doesn't upgrade, so
the Chrome manifest keeps it. `test/manifest.test.ts` guards this.

## Connection (`CompanionConnection`)
- **With a stored code:** connect to `ws://127.0.0.1:<port>/bridge`, send `hello` with the code. On
  `welcome`, start RPC and the 20 s ping. On close: `Unauthorized`/`ProtocolMismatch` → error state
  showing the companion's message and hint (no backoff retries); `Replaced` → nothing; otherwise
  "disconnected" with the reason "ezapply isn't running: start ezapply chat (Set posting still works)",
  and retry with backoff from 1 s up to 30 s. The companion lives only while an `ezapply chat` is open, so a
  refused or closed connection means no chat is running.
- `hello` carries `browser` (`detectBrowser`), so the companion opens pages and PDFs in this browser, and
  `pendingCapture: true` when a capture is queued, so a freshly started companion waits
  for it before answering `posting_active`.
- **Without a code (not paired):** connect to the default port (17373) with an empty code. It succeeds
  only while pairing is open; the `welcome` then carries the code, which is saved without reconnecting.
  Failures quietly leave the state "not paired" and the alarm tries again.
- **Wake-ups:** a 30 s alarm, browser startup, install/update, and settings changes all call
  `ensureConnected()`, which is a no-op when already connected or connecting. The alarm is created every
  time the background starts, if it doesn't exist (`ensureReconnectAlarm`): Firefox drops alarms when the
  browser closes and Chrome may clear them on restart, so an alarm made only at install left the extension
  disconnected after a browser restart, until the user clicked Set posting. Creating it only when missing
  keeps a wake-up from pushing the next firing back. `test/background.test.ts` loads the background with a
  stubbed API and checks this.
- **Firefox keepalive:** its MV3 background is an event page unloaded after 30 s without an extension
  event, and socket traffic doesn't count. Each ping therefore also writes `storage.session`; the
  resulting `storage.onChanged` event resets the idle timer.
- **Settings changes** (`port`, `pairingToken`) reconnect only when they differ from the live connection's.
- Connection states: `unconfigured`, `connecting`, `connected { companionVersion }`,
  `disconnected { reason }`, `error { message, hint? }`, stored for the badge and options page.

## Set posting
Click (or Alt+Shift+P) on an `http(s)` page → on an Oracle page, ask for access to its origin, synchronously
in the click handler (Firefox allows `permissions.request` only there; [why](oracle-adapter.md#site-access)) → inject `capturePage` into every frame the extension may read
→ pick the frame that holds the posting → send `posting.capture` (60 s timeout) → save the "Company: Role"
label and flash ✓. Not connected: store the capture as pending (only the latest is kept; badge `…`) and
send it on the next connection. Pages that can't be captured, or failures, flash `!` with the reason in the
tooltip. Details of what's captured: [postings.md](postings.md).

**Embedded job boards.** Career pages often show a Greenhouse, Lever, iCIMS, Workday or Oracle board in an iframe,
and a capture of the top frame alone holds only the company's page around it.
- `executeScript` runs with `allFrames: true` (falling back to the top frame if that fails). The click's
  `activeTab` grant covers the tab's own origin; frames from other sites are skipped without an error.
- `chooseFrame`: the top frame, unless it has no `JobPosting` JSON-LD and a child frame does, or a child
  frame (with at least 300 characters) shows more text than the page around it. The payload keeps the tab's
  URL and title, takes the content from that frame, and sets `frameUrl`.
- `unreadableBoard`: when the chosen frame has no `JobPosting` data but contains a visible iframe of at least
  300×300 from a known job board host that couldn't be read, nothing is captured; the board's URL opens in a
  new tab next to the page, and the badge says to click Set posting there.

## Serving form requests (`forms.ts`)
1. **Tab:** the explicit `tabId`; else the focused window's active tab if it's an application site (Workday
   or Oracle); else the most recently used one. None → `not_found` ("ask the user to open the application"). The companion
   normally chooses the tab itself (preferring the active posting's tenant) and always passes it; the
   fallback serves callers that don't.
2. The tab must be an application site (`detectSite` → `workday` or `oracle`), which picks the adapter:
   `workday-main.js` (`window.__ezapplyWorkday`) or `oracle-main.js` (`window.__ezapplyOracle`).
3. **Site access:** the handler checks `permissions.contains` for the tab's origin first. Workday: Firefox lets
   users withhold or revoke host permissions; the hint is **Grant site access** in the options page. Oracle:
   the origin must have been granted; the hint is Set posting on that tab, or **Grant access** in the options
   page.
4. Inject the adapter into the page's MAIN world (idempotent), then call its `window.__ezapply…[method](...args)`
   through a second `executeScript`. Results and thrown errors
   come back as `{ __ok }` / `{ __error }`.
5. `tab.screenshot` uses `tabs.captureVisibleTab` and only works on the visible tab (otherwise a hint to
   switch to it).

`browser.status` lists every tab with a URL: id, window, URL, title, active, `focused` (active in the window
the user last focused), `lastAccessed` when the browser reports it, and site. The companion picks form tabs
from it.

## Badge and options
- Badge: green = connected, grey = connecting or disconnected, amber = not paired or a capture is pending
  (`…`), red = error; briefly ✓ or `!` after a capture. The tooltip shows the status, any pending capture,
  and the active posting.
- Options page: connection status (live), a **Grant site access** row when Workday host permissions are
  missing, a **Grant access** row for each open Oracle career site whose origin isn't granted, the extension id the companion pins (Chrome's id or Firefox's install UUID, from the page's own
  origin), and manual port and code fields (only needed for a non-default port).

## Constraints worth knowing
- zod runs with `jitless` (MV3 forbids `eval`).
- `capturePage` and the injected function in `forms.ts` must be self-contained: `executeScript` serializes
  their source, so they can't reference imports or outer variables.
- The first install opens the options page.
