# Browser extension (`packages/extension`)

A Manifest V3 extension for Chrome and Firefox 128+. It has one button, **Set posting**, and otherwise
quietly carries out the form reads, fills and uploads the companion asks for. It has no popup and no
review UI: that happens in Claude Code and the PDF viewer.

## Source layout

| Path | Role |
|---|---|
| `src/ext.ts` | `ext`: Firefox's promise-based `browser`, else Chrome's `chrome` (typed as Chrome's API); `isFirefox` |
| `src/background/index.ts` | Entry: wiring, Set posting, lifecycle listeners, `browser.status` handler |
| `src/background/connection.ts` | `CompanionConnection`: the WebSocket, handshake, pairing, keepalive, reconnects, RPC |
| `src/background/forms.ts` | Handlers for the form methods: choose the tab, check site access, inject and call the adapter |
| `src/background/settings.ts` | Typed wrapper over `storage.local`: settings, connection state, pending capture, active label |
| `src/background/badge.ts` | Toolbar badge and tooltip |
| `src/capture/capture.ts` | `capturePage`: runs in the posting's page (self-contained, serialized by `executeScript`) |
| `src/options/options.ts`, `static/options.html` | Options page: status, site access, manual pairing |
| `src/adapters/workday/` | The Workday adapter → [workday-adapter.md](workday-adapter.md) |
| `static/manifest.json` | The Chrome manifest; the Firefox one is derived from it at build time |
| `build.mjs` | esbuild bundles and both output folders |

## Manifest
- Permissions: `activeTab`, `scripting`, `storage`, `tabs`, `alarms`.
- Host permissions: `*://*.myworkdayjobs.com/*`, `*://*.myworkdaysite.com/*`, `*://*.workday.com/*`
  (needed to inject the adapter without a click). Capture needs none: the button click grants `activeTab`.
- `commands._execute_action`: Alt+Shift+P runs Set posting.
- Options page embedded (`open_in_tab: false`).

## Builds (`npm run build -w @ezapply/extension`)
esbuild bundles `background.js` (ESM), `options.js` and `workday-main.js` (IIFE, small and without zod) for
`chrome120` and `firefox128`, with linked source maps.

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
  "disconnected" and retry with backoff from 1 s up to 30 s. After `Idle` (4005) the reason reads "ezapply
  is idle; it starts again with Claude Code (Set posting still works)" until the next `welcome`.
- `hello` carries `pendingCapture: true` when a capture is queued, so a freshly started companion waits
  for it before answering `posting_active`.
- **Without a code (not paired):** connect to the default port (17373) with an empty code. It succeeds
  only while pairing is open; the `welcome` then carries the code, which is saved without reconnecting.
  Failures quietly leave the state "not paired" and the alarm tries again.
- **Wake-ups:** a 30 s alarm, browser startup, install/update, and settings changes all call
  `ensureConnected()`, which is a no-op when already connected or connecting.
- **Firefox keepalive:** its MV3 background is an event page unloaded after 30 s without an extension
  event, and socket traffic doesn't count. Each ping therefore also writes `storage.session`; the
  resulting `storage.onChanged` event resets the idle timer.
- **Settings changes** (`port`, `pairingToken`) reconnect only when they differ from the live connection's.
- Connection states: `unconfigured`, `connecting`, `connected { companionVersion }`,
  `disconnected { reason }`, `error { message, hint? }`, stored for the badge and options page.

## Set posting
Click (or Alt+Shift+P) on an `http(s)` page → inject `capturePage` → send `posting.capture` (60 s timeout)
→ save the "Company: Role" label and flash ✓. Not connected: store the capture as pending (only the latest
is kept; badge `…`) and send it on the next connection. Pages that can't be captured, or failures, flash `!`
with the reason in the tooltip. Details of what's captured: [postings.md](postings.md).

## Serving form requests (`forms.ts`)
1. **Tab:** the explicit `tabId`; else the focused window's active tab if it's Workday; else the most
   recently used Workday tab. None → `not_found` ("ask the user to open the application").
2. The tab must be a Workday URL (`detectSite`).
3. **Site access:** Firefox lets users withhold or revoke host permissions, so the handler checks
   `permissions.contains` for the tab's origin first and fails with a hint to click **Grant site access**
   in the options page.
4. Inject `workday-main.js` into the page's MAIN world (idempotent), then call
   `window.__ezapplyWorkday[method](...args)` through a second `executeScript`. Results and thrown errors
   come back as `{ __ok }` / `{ __error }`.
5. `tab.screenshot` uses `tabs.captureVisibleTab` and only works on the visible tab (otherwise a hint to
   switch to it).

`browser.status` lists every tab with a URL: id, window, URL, title, active, and site.

## Badge and options
- Badge: green = connected, grey = connecting or disconnected, amber = not paired or a capture is pending
  (`…`), red = error; briefly ✓ or `!` after a capture. The tooltip shows the status, any pending capture,
  and the active posting.
- Options page: connection status (live), a **Grant site access** row when Workday host permissions are
  missing, the extension id the companion pins (Chrome's id or Firefox's install UUID, from the page's own
  origin), and manual port and code fields (only needed for a non-default port).

## Constraints worth knowing
- zod runs with `jitless` (MV3 forbids `eval`).
- `capturePage` and the injected function in `forms.ts` must be self-contained: `executeScript` serializes
  their source, so they can't reference imports or outer variables.
- The first install opens the options page.
