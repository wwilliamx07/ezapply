# The extension's reconnect storm: details

- The companion log shows it: thousands of `bridge: extension connected` a minute from one extension id, with no
  `extension disconnected` between them, since `BridgeServer.adopt` closes the previous socket with `Replaced` and
  only the current connection's close is logged.
- Once one stale `onclose` has run, each caller that finds `socket === null` opens another socket, and the panel's
  reads on each "connected" push are such callers, which is what keeps it going.
- `panel.conversation`'s 60 s timeout is the background's `connection.request(…, 60_000)` in
  `extension/src/background/panel.ts`. The companion answered on a socket that was gone. With the race fixed, a
  dropped socket fails the call at once ("Connection closed"), and the timeout is only a backstop again.
- Leave the companion's `Replaced` rule as it is: one live connection, the newest wins.

**References when built:** `components/extension.md` (connection), `components/companion.md` (bridge).
