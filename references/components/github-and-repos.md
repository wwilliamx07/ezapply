# GitHub and the repo cache (`companion/src/github/`, `companion/src/repos/`)

ezapply reads the user's GitHub projects to build the [knowledge base](knowledge-base.md). Access is
**read-only by construction**, and the code is mirrored into a cache nothing may modify.

## GitHub App (`GitHubService`)
Each user gets their **own private GitHub App**, created in one click through GitHub's App Manifest flow,
with only `contents: read` and `metadata: read`. The user's choice of repositories on GitHub's install
screen is the first layer of repo selection.

**Why not the device flow:** a GitHub App registered from a manifest can't enable the device flow, and
asking the user to register an app by hand is error-prone. So the app is created from a manifest and login
uses the OAuth web flow with callbacks on the daemon. **For more users later:** publish one app; the same
routes work with a shared client id (the secret kept server-side, or the device flow once a published app
enables it).

### Login flow
All browser-facing steps are pages served by the daemon under `/github/*`, each guarded by a one-time
state value that expires after 30 minutes.

1. `github_login` returns a `/github/start?nonce=…` URL (the nonce is issued to Claude, so a web page can't
   start the flow) and opens it in the default browser.
2. **First time only** (`/github/start` with no app registered): a page posts an App Manifest to GitHub
   (`ezapply-<random>`, private, read-only permissions, callback and setup URLs on the daemon). The user
   clicks "Create".
3. `/github/app-created`: the daemon converts the code into app credentials. The client secret goes to the
   OS keychain, the public parts to `~/.ezapply/github-app.json`. The private key and webhook secret are
   discarded (no server-to-server calls). Redirect to the install page.
4. The user installs the app on chosen repos. `/github/installed` then redirects to the OAuth authorize
   page (or, for a later "update access" visit when already logged in, just says done).
5. `/github/callback`: exchange the code for a user access token (plus refresh token and expiries), read
   `/user`, store `{ tokens, login, name, userId }` in the keychain, wake `github_login_wait`.

Without the first-time steps (app already registered), `/github/start` goes straight to authorize.

### Tokens
- Stored in the OS keychain (service `ezapply`, keys `github-app-client-secret`, `github-user-token`) via
  `@napi-rs/keyring`. Tests use an in-memory store.
- `token()` refreshes when the access token is within 5 minutes of expiry. If the refresh token expired,
  the stored token is deleted and the error hint says to call `github_login`.
- `github_logout` revokes the token with GitHub (best effort) and deletes it locally. The app and cached
  repos stay.
- `github_status`: `{ appRegistered, appSlug?, manageUrl?, loggedIn, login?, name?, tokenExpiresAt? }`.
  `manageUrl` is where the user grants access to more repos.

### Listing repos
`github_list_repos` walks every installation of the app the user can see (`/user/installations`, then each
installation's repositories, paginated) and returns `fullName`, `private`, `fork`, `archived`, `language`,
`sizeKb`, `pushedAt`, `description`, `stars`, `defaultBranch`, plus `selected`, newest push first. With no
installation it fails with the install URL in the hint.

## Selection
`profile/repos.yaml` lists the selected repos. `source: "app"` repos are fetched with the user's token;
`source: "public-url"` repos (public projects the user contributed to but doesn't own) are cloned
anonymously.

## Repo cache (`RepoService`)
`repo-cache/<owner>__<name>/`: one mirror per selected repo.

- **Sync** (`repo_sync`): first time, `git clone --filter=blob:none --no-tags --single-branch` (history is
  kept for contributions, blobs are fetched on demand); later, `fetch` + `reset --hard FETCH_HEAD` +
  `clean -fdx`. Returns `{ repo, path, headSha, indexedSha, changedSince, fileCount }`, where
  `changedSince` is `null` (never indexed: index everything), `[]` (current), or the files changed since
  the indexed commit.
- **Hardening on every git command:** HTTPS only for real remotes (`protocol.allow=never`,
  `protocol.https.allow=always`, so no `file://`, ssh, `ext::` or submodule transports), symlinks off, hooks
  off, credential helpers off, and the token passed as `-c http.extraHeader=…` per command, never written
  to `.git/config`. `GIT_TERMINAL_PROMPT=0` and no askpass, so git never prompts.
- **Read-only:** after each sync every file is marked read-only; only a sync clears it, briefly. Claude
  Code's workspace settings also deny Edit/Write/NotebookEdit under `repo-cache/`, and the skills forbid
  building, installing or running anything from it.
- **Missing git:** `not_found` with the install command for this OS (see [documents](documents.md) for how
  a mid-session install is picked up).
- Auth failures come back with a hint to check the app installation (`github_status.manageUrl`) or that the
  URL is public.

## Contributions (`repo_contributions`)
From commit history only (no file contents): total commits, the user's commits (matched by GitHub noreply
email, login or display name), share, first and last commit dates, the top 25 areas (first two path
segments) they changed, and the top 8 authors. If nothing matches, the hint says to ask the user which
author name or email they commit with. Claims in shared repos are limited to the user's own work.
