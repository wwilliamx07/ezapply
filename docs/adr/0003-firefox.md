# 0003: Firefox support

- Status: accepted
- Date: 2026-09-25

## One source, two builds
`npm run build` bundles once (targets `chrome120` and `firefox128`) and writes two folders:
`dist/` for Chrome, unchanged, and `dist-firefox/` with a Firefox manifest. Chrome derives an unpacked
extension's id from its folder path, so moving the Chrome build would break existing pairings.

The Firefox manifest differs only where Firefox requires it:
- `background.scripts` instead of `service_worker`. Firefox runs the MV3 background as an event page.
- A fixed `gecko.id`. It keeps the `moz-extension://` UUID stable across reloads, and that UUID is what the
  companion pins.
- `strict_min_version: 128.0`, the first release with `scripting.executeScript({ world: "MAIN" })`.

Code uses `ext` (`src/ext.ts`): Firefox's promise-based `browser`, else `chrome`.

## Pairing
The companion accepts `moz-extension://<uuid>` origins alongside `chrome-extension://<id>`, and pins
whichever pairs first. Chrome ids stay bare, so existing configs still match. To switch browsers, run
`ezapply pair --reset`.

## Differences handled at runtime
- **Idle background.** Firefox unloads an event page after 30s without an extension event, and WebSocket
  traffic does not count. While connected, each 20s keepalive also writes to `storage.session`, whose
  `storage.onChanged` event resets the timer (bug 1851373). While disconnected, the 30s reconnect alarm
  wakes it as in Chrome.
- **Host permissions.** Firefox lets the user withhold or revoke them. The options page shows a
  **Grant site access** button when they are missing, and form tools fail with that hint instead of an
  injection error.

## Not yet verified live
The build passes `web-ext lint` and the shared tests. It has not been loaded into a real Firefox yet:
check pairing, Set posting, the keepalive over several minutes, and `tab.screenshot`.
