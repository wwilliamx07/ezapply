# Browser extension (`packages/extension`)

A Manifest V3 extension for Chrome and Firefox 128+. Its toolbar button opens the **side panel**, where the user
works with ezapply ([below](#the-side-panel)); Alt+Shift+P sets the posting without it. Otherwise it quietly
carries out the form reads, fills and uploads the companion asks for, on the application pages of every site in
the [registry](protocol.md#the-site-registry-sitests): Workday, Oracle Recruiting Cloud, Greenhouse, Lever, Ashby,
Phenom, Dayforce and SAP SuccessFactors, each told by what its pages show. It has no popup; documents are reviewed
on the companion's review page.

## Source layout

| Path | Role |
|---|---|
| `src/ext.ts` | `ext`: Firefox's promise-based `browser`, else Chrome's `chrome` (typed as Chrome's API); `isFirefox` |
| `src/background/index.ts` | Entry: wiring, the toolbar button (opens the panel), Capture (the panel's button and the shortcut), lifecycle listeners and the reconnect alarm, `browser.status` and `panel.update` handlers |
| `src/background/panel.ts` | `servePanels`: the side panels' ports, their requests relayed to the companion, what only the background can do, the companion's updates passed on; `panelUpdate` ([the side panel](#the-side-panel)) |
| `src/panel/main.tsx`, `src/panel/transport.ts`, `static/panel.html` | The side panel's page: the UI package's `PanelApp` ([ui](ui.md#the-side-panel-srcpanel)) with `portTransport`, a runtime port to the background |
| `src/background/connection.ts` | `CompanionConnection`: the WebSocket, handshake, pairing, keepalive, reconnects, RPC |
| `src/background/forms.ts` | Handlers for the form methods: choose the tab (and the frame, for an embedded application), check access to it, tell its site, pick the site's adapter, inject and call it |
| `src/background/frames.ts` | [Telling a page's site](#telling-a-pages-site-framests): `pageSite` (runs in the page: the first site whose signature its document matches), `tabSite` (a tab's own page), `tabSites` (a tab and its frames on a form site), `frameSite`, and `frameUrl` |
| `src/background/access.ts` | `askForAccess`: a form call that finds its page's origin withheld opens `grant.html` (or brings it forward) and waits for the grant ([access](#access-to-websites)) |
| `src/grant/grant.ts`, `static/grant.html` | The access window: names the host that needed it, and its **Allow access** click makes the `permissions.request` (`originsFrom`: `<all_urls>` or host patterns only, from its URL) |
| `src/background/settings.ts` | Typed wrapper over `storage.local`: settings, connection state, pending capture, active label |
| `src/background/badge.ts` | Toolbar badge and tooltip, with the number of cards waiting in the panel (`setCardsWaiting`) |
| `src/env.d.ts` | Stylesheet imports (the panel's) for TypeScript |
| `src/background/browser-id.ts` | `detectBrowser`: which browser this is, sent in `hello` so the companion opens pages and files there. Firefox from `runtime.getBrowserInfo()`; Chromium browsers from `navigator.userAgentData.brands`, checking Edge, Brave, Opera (and Opera GX, which installs as `opera.exe` too) and Vivaldi before Google Chrome and Chromium (they list the brand they build on too). Vivaldi hides its own brand and is reported as what it builds on; nothing known means no `browser`, and the companion uses the system default |
| `src/capture/capture.ts` | `capturePage`: runs in each frame of the posting's page (self-contained, serialized by `executeScript`) |
| `src/capture/frames.ts` | `chooseFrame` (which frame holds the posting) and `unreadableBoard` (an embedded job board it couldn't read) |
| `src/options/options.ts`, `static/options.html` | Options page: status, access to websites when it's withheld, manual pairing |
| `src/adapters/engine/` | The adapter engine every site runs on → [adapters.md](adapters.md) |
| `src/adapters/widgets/` | Shared widget drivers → [adapters.md](adapters.md#shared-drivers-widgets) |
| `src/adapters/sites/<site>/` | A definition per site: [Workday](workday-adapter.md), [Oracle Recruiting Cloud](oracle-adapter.md), [Greenhouse, Lever, Ashby, Phenom, Dayforce, SAP SuccessFactors](sites.md); `sites/index.ts` lists them |
| `static/manifest.json` | The Chrome manifest; the Firefox one is derived from it at build time. Its host permissions are written by the build from the protocol's `HOST_PERMISSIONS` |
| `build.mjs` | esbuild bundles (one adapter per registry site, the panel) and both output folders |

## Manifest
- Permissions: `activeTab`, `scripting`, `storage`, `tabs`, `alarms`, `webNavigation`, and in Chrome `sidePanel`. `webNavigation` lists a
  tab's frames ([embedded applications](#embedded-applications)); in Chrome it adds no install warning beside
  `tabs` (both are "Read your browsing history"). In Firefox it's a warning of its own ("Access browser activity
  during navigation").
- Host permissions: `<all_urls>` (the protocol's `HOST_PERMISSIONS`), granted at install, and no optional ones.
  The build writes them; a test checks both builds. Every site, because the extension tells a form site by what
  its pages show, on whatever host (Phenom and Oracle run on employers' own domains), and reading a page needs
  access to it ([why](protocol.md#the-site-registry-sitests)). It also covers `tabs.captureVisibleTab`
  (`tab.screenshot`). Chrome warns "Read and change all your data on all websites" at install.
- `side_panel.default_path: panel.html` (Chrome); Firefox's build has `sidebar_action` with the same page
  instead (`default_title: ezapply`, not opened at install). The action's title is "ezapply".
- `commands.set-posting`: Alt+Shift+P runs Capture. Not `_execute_action`, which now opens the panel.
- Options page embedded (`open_in_tab: false`).

## Builds (`npm run build -w @ezapply/extension`)
esbuild bundles `background.js` (ESM), `options.js`, `panel.js` and `panel.css` (ESM, minified, JSX: the UI
package's panel and React, with the base and panel stylesheets; about 700 KB, most of it React and the protocol's
schemas, which the panel's answer checks use), and one adapter per registry site, `<site>-main.js` from
`src/adapters/sites/<site>/main.ts` (IIFE, 50–80 KB each and without zod: they import only the protocol's
import-free subpaths) for
`chrome120` and `firefox128`, with linked source maps. Each adapter gets its `ADAPTER_VERSION` stamped in: the first 12 hex characters of a SHA-256 of the bundle, written over a placeholder of the same length
(so the source map stays exact). Any change to the adapter therefore replaces older copies in open tabs,
with no version number to remember to bump.

| Folder | For | Manifest differences |
|---|---|---|
| `dist/` | Chrome (Load unpacked) | `background.service_worker`, `minimum_chrome_version: 120` |
| `dist-firefox/` | Firefox (Load Temporary Add-on → `manifest.json`) | `background.scripts` (event page); `sidebar_action` for `side_panel`, without the `sidePanel` permission; `browser_specific_settings.gecko`: id `ezapply@ezapply.local`, `strict_min_version: 128.0`, `data_collection_permissions: none`; `content_security_policy.extension_pages`: `script-src 'self'; connect-src ws://127.0.0.1:*` |

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
  "disconnected" with the reason "ezapply isn't running: start it with ./ezapply in your workspace (Capture
  still works)",
  and retry with backoff from 1 s up to 5 s (while the background stays awake; see wake-ups). The companion lives only while `ezapply` (or `ezapply chat`) runs, so a
  refused or closed connection means no chat is running.
- `hello` carries `browser` (`detectBrowser`), so the companion opens pages and PDFs in this browser, and
  `pendingCapture: true` when a capture is queued, so a freshly started companion waits
  for it before answering `posting_active`.
- **Without a code (not paired):** connect to the default port (17373) with an empty code. It succeeds
  only while pairing is open; the `welcome` then carries the code, which is saved without reconnecting.
  Failures quietly leave the state "not paired" and the alarm tries again.
- **Wake-ups:** a 30 s alarm, browser startup, install/update, and settings changes all call
  `ensureConnected()`, which is a no-op when already connected or connecting. While a side panel is open and
  not connected, it also asks every 5 s (`portTransport`'s `connection` request, which calls
  `ensureConnected()`). The message keeps Chrome's service worker awake, so starting ezapply is noticed within
  5 s while the panel is open. The alarm can't do this itself: Chrome fires alarms at most every 30 s, so with
  no panel open a reconnect still takes up to 30 s. The alarm is created every
  time the background starts, if it doesn't exist (`ensureReconnectAlarm`): Firefox drops alarms when the
  browser closes and Chrome may clear them on restart, so an alarm made only at install left the extension
  disconnected after a browser restart, until the user clicked Capture. Creating it only when missing
  keeps a wake-up from pushing the next firing back. `test/background.test.ts` loads the background with a
  stubbed API and checks this.
- **Firefox keepalive:** its MV3 background is an event page unloaded after 30 s without an extension
  event, and socket traffic doesn't count. Each ping therefore also writes `storage.session`; the
  resulting `storage.onChanged` event resets the idle timer.
- **Settings changes** (`port`, `pairingToken`) reconnect only when they differ from the live connection's.
- Connection states: `unconfigured`, `connecting`, `connected { companionVersion }`,
  `disconnected { reason }`, `error { message, hint? }`, stored for the badge and options page.

## The side panel
The toolbar button opens it: Chrome by itself (`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` at
every background start), Firefox's sidebar by `sidebarAction.toggle()` in the click, the only place Firefox lets it
open. The page (`panel.html`) is the UI package's `PanelApp` ([ui](ui.md#the-side-panel-srcpanel)) with a transport
over a runtime port (`ezapply-panel`) to the background:
- **`call`**: a `panel.*` method relayed to the companion over the bridge (60 s timeout); anything else is refused,
  so the panel can't capture or fill through the relay. It needs the companion connected.
- **`capture`**: Capture on the current tab of the panel's window. The panel calls
  `permissions.request({ origins: <all_urls> })` inside its own click first (Firefox asks only during the user's
  gesture), then the background captures as below and answers with the outcome (the posting, or why not).
- **`tab`**: the window's current tab, its site told as for a form call, and what it is to the active posting
  (`panel.tab`); none without a connection or a web page.
- **`openTab`**: an `http(s)` address in a new tab of the panel's window (the posting's application).
- **`connection`**: the connection's state, as the badge shows it.

The background pushes to every open panel: the connection's state when it changes, "the tab changed" when a tab is
activated or navigates, and the companion's `panel.update`s. It tells the companion how many panels are open
(`panel.watch`) when one opens or closes and on every connection. The panel's port is opened again if the
background restarts (Chrome ends an idle service worker); calls made meanwhile fail with "try again".

## Capture
The panel's **Capture**, or Alt+Shift+P, on an `http(s)` page → ask for access to every site, synchronously in
the click or the shortcut's handler (Firefox allows `permissions.request` only there; already granted, it resolves
without asking; [access](#access-to-websites))
→ once that's settled, inject `capturePage` into every frame the extension may read → pick the frame that holds
the posting → tell that frame's site ([telling a page's site](#telling-a-pages-site-framests)), sent as `site`
unless it's none → send `posting.capture` (60 s timeout) → save the "Company: Role" label and flash ✓. Not
connected: store the capture as pending (only the latest is kept; badge `…`) and send it on the next connection.
Pages that can't be captured, or failures, flash `!` with the reason in the tooltip. Details of what's captured:
[postings.md](postings.md).

**Embedded job boards.** Career pages often show a Greenhouse, Lever, iCIMS, Workday or Oracle board in an iframe,
and a capture of the top frame alone holds only the company's page around it.
- `executeScript` runs with `allFrames: true` (falling back to the top frame if that fails). With access to every
  site it reads every frame; with that withheld, the click's `activeTab` grant covers the tab's own origin, and
  frames from other sites are skipped without an error.
- `chooseFrame`: the top frame, unless it has no `JobPosting` JSON-LD and a child frame does, or a child
  frame (with at least 300 characters) shows more text than the page around it. The payload keeps the tab's
  URL and title, takes the content from that frame, and sets `frameUrl`.
- A frame that isn't rendered (its body fails `checkVisibility`, as in the `display:none` iframe of an invisible
  reCAPTCHA) reports no visible text. Its `innerText` would otherwise fall back to `textContent`, scripts
  included, and could outweigh the page itself: a job page that shows its description without `JobPosting`
  data (LinkedIn's) was captured as the reCAPTCHA frame, with an empty description.
- `unreadableBoard`: when the chosen frame has no `JobPosting` data but contains a visible iframe of at least
  300×300 from a known job board host that couldn't be read (only when access to websites is withheld), nothing
  is captured: the board's URL opens in a new tab next to the page, and the badge says to click Capture there.

## Telling a page's site (`frames.ts`)
A page (or a frame) is a site's when its body shows it: `pageSite` runs in the page (isolated world,
`injectImmediately`, self-contained) with the registry's signatures (`siteSignatures()`) and returns the first
site whose selector its document matches, in registry order. A selector the browser can't parse is skipped.
Where that gives nothing, the URL decides (`detectSite`): a page that shows no site, a discarded tab, a browser
page, an origin the user withheld, a page that didn't answer within 1.5 s (`READ_MS`; with `injectImmediately` a
page still loading answers at once, from what it has so far).
- `tabSite(tab)`: the tab's own page. `tabSites(tab)`: the tab's site and its `frames` on a form site, in one
  `executeScript` with `allFrames: true`, each frame by its body else its URL (`webNavigation.getAllFrames` gives
  every frame's URL, answering or not; only `https` frames). `frameSite(tabId, frameId, url)`: one frame.
- Read on every call, never cached: a single-page site renders another page under the same URL, and a page still
  loading may not show its signature yet. `browser.status` reads every open tab this way, in parallel.
- A provider's site counts as the site on every page it serves, not only the application: a Phenom job page is
  `phenom`, as a Workday job page is `workday`, and its adapter reports it as a `posting` page with an Apply action.
- Why the body: [the site registry](protocol.md#the-site-registry-sitests).

## Access to websites
The extension holds every site from the install (`<all_urls>`). Firefox lets the user withhold that, and Chrome
lets them limit it to some sites or to a click. Where it's missing:
- **Capture** asks for it in the click, the one moment a request is allowed without a window of its own.
- **A form call** checks `permissions.contains` for its page's origin (the frame's, for an embedded application)
  before reading anything. Missing, it can't ask itself (`permissions.request` needs a user gesture, and a call
  from the companion is none), so it opens a small extension window (`grant.html`, `askForAccess`) naming the
  host, whose **Allow access** click asks for every site; the call waits up to 15 s (`GRANT_WAIT_MS`), then fails
  with a hint to call again once allowed. A retry brings the same window forward rather than opening another (in
  memory: a background that restarts may open a second).
- **The options page** shows a **Grant access** row while it's missing.

## Embedded applications
A company's careers page often shows its Greenhouse (or Ashby, or Lever) application in an iframe, and the form
tools then act on that frame ([which tab](../mcp-tools.md#forms)).
- **Finding them:** `browser.status` lists, per tab, `frames: [{ frameId, url, site }]`: frames other than the top
  one whose page shows a form site, else whose URL is a form site's (`tabSites`,
  [telling a page's site](#telling-a-pages-site-framests)). Only `http(s)` tabs that aren't discarded are read;
  the frame list comes from `webNavigation.getAllFrames`, which lists frames whether or not they can be read.
- **Acting on one:** form methods take `frameId`. The handler looks the frame up again (`webNavigation.getFrame`),
  so a frame that reloaded or a page that moved on fails the call with `not_found` ("call get_form again"), as a
  closed tab does; the companion resolves the frame again on every call. Access is checked for the frame's
  origin, its site told by its own page, and the adapter is injected into `{ tabId, frameIds: [frameId] }` only,
  so the frame gets its own adapter instance and its own submit guard, like any page.
- **Per tab still:** `tab.show` switches the tab and raises its window. It reads `hidden` in the frame, and takes
  `focused` from `windows.get` (the browser window's focus): a frame's own `document.hasFocus()` is false whenever
  focus is in the page around it. `tab.screenshot` takes the whole tab.
- **Not covered:** a form rendered straight into the company's page with no frame (`todo.md`, "Application
  forms on an employer's own page").

## Serving form requests (`forms.ts`)
1. **Tab:** the explicit `tabId`; else the focused window's active tab if its page is an application site's (a
   registry site, [told by its page](#telling-a-pages-site-framests)); else the most recently used such tab. None →
   `not_found` ("ask the user to open the application"). The companion normally chooses the tab itself
   (preferring the active posting's tenant) and always passes it; the fallback serves callers that don't. With
   `frameId`, that frame of the tab ([embedded applications](#embedded-applications)).
2. **Access:** `permissions.contains` for the page's origin (the frame's, for an embedded application), before
   anything is read. Missing, the call asks for every site and waits up to 15 s ([access](#access-to-websites)).
   A page that isn't on the web is never readable, and its URL decides.
3. **Site:** the tab (or the frame) must be an application site, by what its page shows, else by its URL
   ("not an application page of a supported site" otherwise). That picks the adapter: `<site>-main.js`, installed
   as `window.__ezapply_<site>`.
4. Inject the adapter into the page's MAIN world (idempotent; only the frame, with `frameId`), then call its
   `window.__ezapply_<site>[method](...args)` through a second `executeScript`, with the waits set first
   (`setTiming`) and then debug mode (`setDebug`, the call's `debug` or null). Results and thrown errors
   come back as `{ __ok }` / `{ __error }`, with `__debug` when the call was debugged: the adapter's trace
   ([adapters](adapters.md#debug-mode-the-adapter-trace)). The handler returns it beside the result
   (protocol's `WithDebug`), or sets it on the error it throws, so it reaches the companion in the response's
   `debug` and never in the result. After a debugged call where a field failed, with `failures` asked for, a
   screenshot of the tab joins the trace when the tab is the active one in its window: one per call, after it,
   because the page's MAIN world can't reach the extension mid-call, and the browser allows only a couple of
   captures a second. A capture that fails is left out; it never fails the call.
5. `tab.screenshot` uses `tabs.captureVisibleTab` and only works on the visible tab (otherwise a hint to
   switch to it). It needs `<all_urls>` or `activeTab`; the extension holds `<all_urls>` (not yet run live
   with it: [status](../status.md#not-yet-verified-for-real)).
6. `tab.show` (sent by the companion before every form call): with `activate` and `focusWindow`, and the
   tab's window not the focused one (or minimized), `windows.update(windowId, { focused: true })`, with
   `state: "normal"` when it's minimized, and `windowFocused: true` in the result. Then, with `activate` and the
   tab not active, `tabs.update(tabId, { active: true })`. Then it reads `document.visibilityState` and
   `document.hasFocus()` with one `executeScript` in the isolated world. The page learns of a switch, or of its window coming to the front, asynchronously, so after one
   it's read up to 10 times, 50 ms apart (until it's visible, and focused when the window was raised), from the
   background, whose timers aren't throttled. Without access to the page it falls back to the tab's active
   state, and `focused` is left out. `focused` says whether a raise worked, and debug mode records it: a page in
   a window behind another app gets no focus events from Chrome, which widgets that track focus depend on
   (Workday's split dates weren't taken there; [workday adapter](workday-adapter.md)).
   - **Window focus only when asked.** Raising the window pulls the browser in front of the terminal the user
     may be typing in, and takes keyboard focus. The companion asks for it (`focusWindow`) only on calls that
     change the page, only when `forms.focusBrowser` is on, and never while a review page waits. A failed
     `windows.update` is swallowed: the tab is still switched to.
   - **Restoring a minimized window** sets `state: "normal"`, so a window minimized from maximized comes back
     at its normal size. Asking for it outright means not depending on how each browser treats `focused: true`
     on a minimized window.
   - **Windows' focus-stealing rules** may keep the window behind and flash its taskbar button instead. Then
     `windowFocused` is true and `focused` false, and the companion's `browserBehind` hint asks the user to
     click the browser.
   - **Hidden stays hidden.** A minimized window, or on Windows one fully covered by others (Chrome tracks
     occlusion), keeps its pages hidden even when the tab is active. That's reported as `hidden: true`, not
     forced.

`browser.status` lists every tab with a URL: id, window, URL, title, active, `focused` (active in the window
the user last focused), `lastAccessed` when the browser reports it, `site` (what its page shows, else its URL's),
and `frames` (embedded applications, when there are any). The companion picks form tabs from it.

## Badge and options
- Badge: green = connected, grey = connecting or disconnected, amber = not paired or a capture is pending
  (`…`), red = error; briefly ✓ or `!` after a capture; the number of cards waiting in the panel (amber), pushed by
  the companion even while no panel is open. The tooltip shows the status, the cards waiting, any pending capture,
  and the active posting.
- Options page: connection status (live), a **Grant access** row while access to websites is missing ("No access
  to websites, so ezapply can't read or fill application forms"), the extension id the companion pins (Chrome's
  id or Firefox's install UUID, from the page's own origin), and manual port and code fields (only needed for a
  non-default port).

## Constraints worth knowing
- zod runs with `jitless` (MV3 forbids `eval`).
- `capturePage`, `pageSite` and the injected function in `forms.ts` must be self-contained: `executeScript`
  serializes their source, so they can't reference imports or outer variables.
- The first install opens the options page.
