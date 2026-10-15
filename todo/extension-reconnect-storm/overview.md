# The extension's reconnect storm

**What.** After the companion has been open a while, the extension can fall into a loop of opening a new WebSocket
every few milliseconds, each replacing the last: the panel flickers between connected and not, and a panel call can
hang until its 60 s timeout (`panel.conversation timed out after 60000ms`).

**Why.** `CompanionConnection` (`extension/src/background/connection.ts`) has two races:
- `ensureConnected` checks `socket || connecting`, then awaits storage and the browser check before it sets
  `connecting`, so two callers at once (the panel's 5 s check, a panel call, the alarm) both open a socket.
- Its `onclose` handler clears `this.socket`, `this.peer` and the keepalive without checking that the closing socket
  is still the current one. When the companion replaces socket A with B (`CloseCode.Replaced`), A's `onclose` wipes
  B's state, so the next caller opens C, which replaces B, and so on. A request sent on A is never failed: `failAll`
  runs on B's peer, so A's caller waits out its timeout.

**Plan.**
1. Set `connecting` before the first await, and in every socket handler act only if that socket is `this.socket`;
   fail a closing socket's own peer.
2. Tests: two `ensureConnected` calls at once open one socket; a replaced socket's close leaves the new one
   connected; a request on a replaced socket fails at once.
3. Log a replaced connection on the companion side, so a storm shows in `companion.log` as such.

[details](details.md)
