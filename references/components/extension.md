# Browser extension (`packages/extension`)

A Manifest V3 extension for Chrome 120+ and other Chromium browsers. Its toolbar button opens the **side panel**, where the user
works with ezapply ([below](#the-side-panel)); Alt+Shift+P sets the posting without it. Otherwise it quietly
carries out the form reads, fills and uploads the companion asks for, on the application pages of every site in
the [registry](protocol.md#the-site-registry-sitests): Workday, Oracle Recruiting Cloud, Greenhouse, Lever, Ashby,
Phenom, Dayforce and SAP SuccessFactors, each told by what its pages show. It has no popup; documents are reviewed
on the companion's review page.

## Source layout

| Path | Role |
|---|---|
| `src/ext.ts` | `ext`: Chrome's `chrome`, under one name |
| `src/background/index.ts` | Entry: wiring, the toolbar button (opens the panel), Capture (the panel's button and the shortcut), lifecycle listeners and the reconnect alarm, `browser.status` and `panel.update` handlers |
| `src/background/panel.ts` | `servePanels`: the side panels' ports, their requests relayed to the companion, what only the background can do, the companion's updates passed on; `panelUpdate` ([the side panel](#the-side-panel)) |
| `src/panel/main.tsx`, `src/panel/transport.ts`, `static/panel.html` | The side panel's page: the UI package's `PanelApp` ([ui](ui.md#the-side-panel-srcpanel)) with `portTransport`, a runtime port to the background |
| `src/background/connection.ts` | `CompanionConnection`: the WebSocket, handshake, pairing, keepalive, reconnects, RPC |
| `src/background/forms.ts` | Handlers for the form methods: choose the tab (and the frame, for an embedded application), check access to it, tell its site, pick the site's adapter, inject and call it; `tab.show` and `tab.screenshot` |
| `src/background/emulation.ts` | [Focus emulation](#focus-emulation-emulationts): `emulateFocus` (attach the debugger to a tab and turn it on), `captureAttached` (a screenshot through the debugger), `releaseAll`, the idle detach and the user's Cancel |
| `src/background/frames.ts` | [Telling a page's site](#telling-a-pages-site-framests): `pageSite` (runs in the page: the first site whose signature its document matches), `tabSite` (a tab's own page), `tabSites` (a tab and its frames on a form site), `frameSite`, and `frameUrl` |
| `src/background/access.ts` | `askForAccess`: a form call that finds its page's origin withheld opens `grant.html` (or brings it forward) and waits for the grant ([access](#access-to-websites)) |
| `src/grant/grant.ts`, `static/grant.html` | The access window: names the host that needed it, and its **Allow access** click makes the `permissions.request` (`originsFrom`: `<all_urls>` or host patterns only, from its URL) |
| `src/background/settings.ts` | Typed wrapper over `storage.local`: settings, connection state, pending capture, active label |
| `src/background/badge.ts` | Toolbar badge and tooltip, with the number of cards waiting in the panel (`setCardsWaiting`) |
| `src/env.d.ts` | Stylesheet imports (the panel's) for TypeScript |
| `src/background/browser-id.ts` | `detectBrowser`: which browser this is, sent in `hello` so the companion opens pages and files there. From `navigator.userAgentData.brands`, checking Edge, Brave, Opera (and Opera GX, which installs as `opera.exe` too) and Vivaldi before Google Chrome and Chromium (they list the brand they build on too). Vivaldi hides its own brand and is reported as what it builds on; nothing known means no `browser`, and the companion uses the system default |
| `src/capture/capture.ts` | `capturePage`: runs in each frame of the posting's page (self-contained, serialized by `executeScript`) |
| `src/capture/frames.ts` | `chooseFrame` (which frame holds the posting) and `unreadableBoard` (an embedded job board it couldn't read) |
| `src/options/options.ts`, `static/options.html` | Options page: status, access to websites when it's withheld, manual pairing |
| `src/adapters/engine/` | The adapter engine every site runs on → [adapters.md](adapters.md) |
| `src/adapters/widgets/` | Shared widget drivers → [adapters.md](adapters.md#shared-drivers-widgets) |
| `src/adapters/sites/<site>/` | A definition per site: [Workday](sites.md#workday-sitesworkday), [Oracle Recruiting Cloud](sites.md#oracle-recruiting-cloud-sitesoracle), [Greenhouse, Lever, Ashby, Phenom, Dayforce, SAP SuccessFactors](sites.md); `sites/index.ts` lists them |
| `static/manifest.json` | The manifest. Its host permissions are written by the build from the protocol's `HOST_PERMISSIONS` |
| `build.mjs` | esbuild bundles (one adapter per registry site, the panel) and `dist/` |

## Manifest
- Permissions: `activeTab`, `scripting`, `storage`, `tabs`, `alarms`, `webNavigation`, `sidePanel` and
  `debugger`. `webNavigation` lists a tab's frames ([embedded applications](#embedded-applications)); it adds no
  install warning beside `tabs` (both are "Read your browsing history"). `debugger` runs
  [focus emulation](#focus-emulation-emulationts); its install warning ("Access the page debugger backend") sits
  beside the one for every site, which already covers reading and changing pages.
- `content_security_policy.extension_pages`: `script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:*`.
  The extension's pages and background may run only its own scripts and connect only to the companion on
  loopback. Nothing in them fetches anything else (the adapters run in the page's world, under the page's
  policy). `test/manifest.test.ts` guards it.
- Host permissions: `<all_urls>` (the protocol's `HOST_PERMISSIONS`), granted at install, and no optional ones.
  The build writes them; a test checks both builds. Every site, because the extension tells a form site by what
  its pages show, on whatever host (Phenom and Oracle run on employers' own domains), and reading a page needs
  access to it ([why](protocol.md#the-site-registry-sitests)). It also covers `tabs.captureVisibleTab`
  (`tab.screenshot` of a tab in front). Chrome warns "Read and change all your data on all websites" at install.
- `side_panel.default_path: panel.html`. The action's title is "ezapply".
- `commands.set-posting`: Alt+Shift+P runs Capture. Not `_execute_action`, which now opens the panel.
- Options page embedded (`open_in_tab: false`).

## Builds (`npm run build -w @ezapply/extension`)
esbuild bundles `background.js` (ESM), `options.js`, `panel.js` and `panel.css` (ESM, minified, JSX: the UI
package's panel and React, with the base and panel stylesheets; about 700 KB, most of it React and the protocol's
schemas, which the panel's answer checks use), and one adapter per registry site, `<site>-main.js` from
`src/adapters/sites/<site>/main.ts` (IIFE, 50–80 KB each and without zod: they import only the protocol's
import-free subpaths) for
`chrome120`, with linked source maps. Each adapter gets its `ADAPTER_VERSION` stamped in: the first 12 hex characters of a SHA-256 of the bundle, written over a placeholder of the same length
(so the source map stays exact). Any change to the adapter therefore replaces older copies in open tabs,
with no version number to remember to bump.

The output is `dist/`, loaded in Chrome with Load unpacked (`background.service_worker`,
`minimum_chrome_version: 120`). It stays at the same path because Chrome derives an unpacked extension's id from
its folder, and the companion pins that id.

**Chromium only.** Firefox was supported until focus emulation, which needs `chrome.debugger`, an API Firefox
lacks. A Firefox build would have run every application tab throttled or pulled to the front, so it was dropped
rather than kept as the slower path.

## Connection (`CompanionConnection`)
- **With a stored code:** connect to `ws://127.0.0.1:<port>/bridge`, send `hello` with the code. On
  `welcome`, start RPC and the 20 s ping. On close: `Unauthorized`/`ProtocolMismatch` → error state
  showing the companion's message and hint (no backoff retries); `Replaced` → nothing; otherwise
  "disconnected" with the reason "ezapply isn't running: start it with ./ezapply in your workspace (Capture
  still works)",
  and retry with backoff from 1 s up to 5 s (while the background stays awake; see wake-ups). The companion lives only while `ezapply` runs, so a
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
  time the background starts, if it doesn't exist (`ensureReconnectAlarm`): Chrome may clear alarms on restart,
  so an alarm made only at install left the extension
  disconnected after a browser restart, until the user clicked Capture. Creating it only when missing
  keeps a wake-up from pushing the next firing back. `test/background.test.ts` loads the background with a
  stubbed API and checks this.
- **Settings changes** (`port`, `pairingToken`) reconnect only when they differ from the live connection's.
- Connection states: `unconfigured`, `connecting`, `connected { companionVersion }`,
  `disconnected { reason }`, `error { message, hint? }`, stored for the badge and options page.

## The side panel
The toolbar button opens it: Chrome does that by itself (`sidePanel.setPanelBehavior({ openPanelOnActionClick:
true })` at every background start). The page (`panel.html`) is the UI package's `PanelApp` ([ui](ui.md#the-side-panel-srcpanel)) with a transport
over a runtime port (`ezapply-panel`) to the background:
- **`call`**: a `panel.*` method relayed to the companion over the bridge (60 s timeout); anything else is refused,
  so the panel can't capture or fill through the relay. It needs the companion connected.
- **`capture`**: Capture on the current tab of the panel's window. The panel calls
  `permissions.request({ origins: <all_urls> })` inside its own click first (a request is allowed only during the
  user's gesture), then the background captures as below and answers with the outcome (the posting, or why not).
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
the click or the shortcut's handler (`permissions.request` needs the user's gesture; already granted, it resolves
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
The extension holds every site from the install (`<all_urls>`). Chrome lets the user limit that to some sites
or to a click. Where it's missing:
- **Capture** asks for it in the click, the one moment a request is allowed without a window of its own.
- **A form call** checks `permissions.contains` for its page's origin (the frame's, for an embedded application)
  before reading anything. Missing, it can't ask itself (`permissions.request` needs a user gesture, and a call
  from the companion is none), so it opens a small extension window (`grant.html`, `askForAccess`) naming the
  host, whose **Allow access** click asks for every site; the call waits up to 15 s (`GRANT_WAIT_MS`), then fails
  with a hint to call again once allowed. A retry brings the same window forward rather than opening another (in
  memory: a background that restarts may open a second).
- **The options page** shows a **Grant access** row while it's missing.

**Why every site.** A job site's application can be on any host: Oracle's and Phenom's on the employer's own
domain, an embedded board inside a careers page. A tab on a host the extension doesn't hold can't be read, so its site
could only be guessed from the URL, and asking for one origin at a time meant a prompt before every new employer. A
host list (`*.oraclecloud.com`) was rejected too: it misses employers' own domains, and it would reach every Oracle
Cloud customer's own staff applications on those hosts.

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
- **Per tab still:** focus emulation covers the whole tab. `tab.show` reads `hidden` in the frame, and takes `focused` from the top page under focus emulation, else
  from `windows.get` (the browser window's focus): a frame's own `document.hasFocus()` is false whenever focus is
  in the page around it. `tab.screenshot` takes the whole tab.
- **Not covered:** a form rendered straight into the company's page with no frame (`todo/`, "Application
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
   screenshot of the tab joins the trace (through the debugger while focus emulation holds the tab, else only when
   it's the active one in its window): one per call, after it,
   because the page's MAIN world can't reach the extension mid-call, and the browser allows only a couple of
   captures a second. A capture that fails is left out; it never fails the call.
5. `tab.screenshot`: while focus emulation holds the tab, `Page.captureScreenshot` through the debugger, which
   works with the tab in the background or its window minimized (the tab keeps rendering). Otherwise
   `tabs.captureVisibleTab`, which only works on the visible tab (otherwise a hint to switch to it). That needs
   `<all_urls>` or `activeTab`; the extension holds `<all_urls>` (not yet run live with it:
   [status](../status.md#not-yet-verified-for-real)).
6. `tab.show` (sent by the companion before every form call):
   [focus emulation](#focus-emulation-emulationts) (`emulateFocus`), which switches and raises nothing. Then it
   reads `document.visibilityState` and `document.hasFocus()` with one `executeScript` in the isolated world. The
   page learns of focus emulation asynchronously, so it's read up to 10 times, 50 ms apart, until it's visible
   and focused, from the background, whose timers aren't throttled. A page that still isn't is given it once more
   (off, then on: a page that navigated may have lost it) and read again. The result is
   `{ emulated: true, hidden, focused }`. When the tab can't be attached, the page is read once and reported as
   it is (`emulated: false`): nothing is switched to or raised. Without access to the page it falls back to the
   tab's active state, and `focused` is left out. `focused` is recorded in debug mode: a page without focus gets
   no focus events, which widgets that track focus depend on
   ([Workday's dates](sites.md#dates-typed-into-workdays-split-widget)).

   **Why nothing is brought to the front.** Earlier builds switched to the tab and raised the browser window
   (`windows.update`, restoring a minimized one) when focus emulation wasn't there. That pulled the browser in
   front of the terminal the user was typing in, took keyboard focus, could be refused by Windows' focus-stealing
   rules, and a window kept minimized or covered stayed hidden anyway. Focus emulation needs none of it.

## Focus emulation (`emulation.ts`)
Chrome slows a hidden page's timers to about once a second (once a minute for chained timers after five hidden
minutes), stops its animation frames, and under Energy Saver may freeze it outright. A page whose window is behind
another app gets no focus events. Every adapter wait is a timer, and Workday's widgets render on timers and
animation frames and track focus, so a hidden tab filled many times slower, past the companion's timeouts, and
Workday's split dates weren't taken behind the terminal ([the tab at full speed](../mcp-tools.md#forms)).

`emulateFocus(tabId)` attaches `chrome.debugger` to the tab (DevTools protocol `1.3`) and sends
`Emulation.setFocusEmulationEnabled({ enabled: true })`. The page then reports itself focused, and Chrome counts
the tab as being captured, which keeps it visible to the page and rendering wherever it is: in the background,
minimized, covered, behind another app. It's the browser's own state, so the page's timers, animation frames and
focus events all behave as in a tab in front, the page's own code included.

**Why the debugger, not a script in the page.** Scripts that replace `setTimeout` (a worker clock, as HackTimer
does) or `document.visibilityState` speed up only the code that goes through them: Workday's own timers, animation
frames and CSS transitions stay throttled, and focus events still don't arrive. Bringing the tab and window to the
front (what `tab.show` did before) works only while the user leaves it there, and pulls the browser in front of
their terminal. Launch flags (`--disable-background-timer-throttling`) need a browser
started specially. Other browser-automation tools settled on the same command for the same problem.

- **When it's attached:** from the first form call on a tab (`tab.show`) until no call has come for 5 minutes
  (`IDLE_MS`, a timer per tab, reset by every call), the companion disconnects (`releaseAll`, from the connection's
  state listener), or the tab closes. Chrome shows "ezapply started debugging this browser" while any tab is
  attached, so it's kept to the fill. An attached debugger also keeps the service worker alive, so the idle timer
  isn't lost to an idle background.
- **Turned on again before every call:** a Chromium change that kept it across navigations was reverted, so a page
  that navigated may have lost it. `emulateFocus` sends it each time, and `tab.show` turns it off and on when the
  page still reports hidden or unfocused.
- **The user's Cancel:** closing Chrome's bar detaches the debugger (`onDetach`), and the next form call attaches
  it again, bar and all. Filling depends on it, and nothing else keeps a hidden tab at full speed; a user who
  wants it gone stops filling (it goes after 5 idle minutes) or stops ezapply.
- **Can't attach:** another debugger client holding the tab, a policy forbidding the debugger, or a page the
  debugger can't reach. Any failure detaches what was attached, and the page runs as the browser leaves it
  (`emulated: false`; the companion's hints say what to do). An "already attached" error (the
  background lost track of its own attachment) is taken as attached.
- **Screenshots** of an attached tab go through `Page.captureScreenshot`, which works off screen
  (`captureAttached`).
- **Clicks stay the adapter's own** DOM events: none go through the debugger, whose input events would take real
  focus.

`browser.status` lists every tab with a URL: id, window, URL, title, active, `focused` (active in the window
the user last focused), `lastAccessed` when the browser reports it, `site` (what its page shows, else its URL's),
and `frames` (embedded applications, when there are any). The companion picks form tabs from it.

## Badge and options
- Badge: green = connected, grey = connecting or disconnected, amber = not paired or a capture is pending
  (`…`), red = error; briefly ✓ or `!` after a capture; the number of cards waiting in the panel (amber), pushed by
  the companion even while no panel is open. The tooltip shows the status, the cards waiting, any pending capture,
  and the active posting.
- Options page: connection status (live), a **Grant access** row while access to websites is missing ("No access
  to websites, so ezapply can't read or fill application forms"), the extension id the companion pins (from the
  page's own origin), and manual port and code fields (only needed for a
  non-default port).

## Constraints worth knowing
- zod runs with `jitless` (MV3 forbids `eval`).
- `capturePage`, `pageSite` and the injected function in `forms.ts` must be self-contained: `executeScript`
  serializes their source, so they can't reference imports or outer variables.
- The first install opens the options page.
