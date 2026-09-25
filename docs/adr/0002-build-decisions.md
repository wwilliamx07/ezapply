# 0002: Decisions made while building M3–M9

- Status: accepted
- Date: 2026-09-25

## GitHub: App Manifest flow + OAuth web flow (not the device flow)
The plan called for a GitHub App with the device flow. A GitHub App registration can't enable the device
flow from a manifest, and asking the user to register an app by hand is error-prone. Instead:
- The daemon serves a local page that posts an **App Manifest** to GitHub. The user clicks "Create", and
  GitHub redirects back with a code, which we convert into app credentials. The client secret goes to the
  OS keychain. The private key is discarded, since we make no server-to-server calls.
- The user installs the app on the repos they choose. GitHub's install screen is the first layer of repo
  selection.
- Login is the OAuth **web flow** with the callback on the daemon. Every browser-facing step is guarded
  by a one-time state value (30 min TTL), and the start link needs a nonce issued to Claude.
- Permissions: `contents: read`, `metadata: read`. Nothing can be written.

For multiple users later: publish one app, and the same routes work with a shared client id (the secret
stays server-side, or switch to the device flow once a published app enables it).

## Repo cache: partial clones, credentials per command, HTTPS only
`git clone --filter=blob:none` keeps history (needed for `repo_contributions`) without every blob. The
token is passed as `-c http.extraHeader=…` on each command and never written to `.git/config`.
- Real remotes only allow `https` (`protocol.allow=never` + `protocol.https.allow=always`).
- Hooks, symlinks and credential helpers are disabled.
- Files are marked read-only after each sync, and Claude Code permission rules deny edits.

## Workday adapter runs in the page's MAIN world
Workday widgets are React components, and some only respond to React's own handlers. Isolated-world
content scripts can't see those handlers. So:
- `workday-main.js` is injected on demand with `chrome.scripting.executeScript({ world: "MAIN" })`.
- The service worker calls its methods through a second `executeScript`.
- Fillers use real DOM events first (native value setter, pointer/mouse sequence, keyboard) and fall back
  to React props only when the DOM route didn't take effect.

The submit guard lives in the same world. Capture-phase listeners cancel **untrusted** events aimed at
any submit control, and the adapter refuses to touch submit controls or advance past the review step.
Calling React props directly would bypass DOM listeners, so the adapter never calls them on buttons.

## No SQLite application log
Each posting folder already holds the full record: `meta.json` (status and details) and `form-log.jsonl`
(every fill, upload and step, with the source of each value). A database would duplicate that. Duplicate
detection uses `postings_list` with a company filter.

## Live verification
Posting, start-choice and sign-in detection were verified on a live public tenant, and snapshots are
kept as fixtures. Steps behind sign-in can't be reached without an account. Those fillers are tested
against a behavioural fixture, and the first real application is their live test.
`npm run recon:workday <url>` repeats the public-page check whenever Workday changes.
