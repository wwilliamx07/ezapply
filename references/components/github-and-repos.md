# GitHub and the repo cache (`companion/src/github/`, `companion/src/repos/`)

ezapply reads the user's GitHub projects to build the [knowledge base](knowledge-base.md). Access is
**read-only by construction**, and the code is mirrored into a cache nothing may modify.

## GitHub App (`GitHubService`)
Each user gets their **own private GitHub App**, created in one click through GitHub's App Manifest flow,
with only `contents: read` and `metadata: read`. The user's choice of repositories on GitHub's install
screen is the first layer of repo selection.

**Why not the device flow:** a GitHub App registered from a manifest can't enable the device flow, and
asking the user to register an app by hand is error-prone. So the app is created from a manifest and login
uses the OAuth web flow with callbacks on the companion. **For more users later:** publish one app; the same
routes work with a shared client id (the secret kept server-side, or the device flow once a published app
enables it).

### Login flow
All browser-facing steps are pages served by the companion under `/github/*`, each guarded by a one-time
state value that expires after 30 minutes.

1. `github_login` returns a `/github/start?nonce=…` URL (the nonce is issued to Claude, so a web page can't
   start the flow) and opens it through the `Opener` in the browser the extension runs in (the system default until the
   extension has connected), which accepts only `http://127.0.0.1:<port>/` URLs. The result says whether that
   worked (`openedBrowser`, and `openedIn`), and its `tell`
   text gives the user the URL to open when it didn't (no `xdg-open` on a headless Linux, say). (It used to
   call the file opener, which checks that its argument exists on disk: a URL never does, so no browser
   ever opened while the text said one had.)
2. **First time only** (`/github/start` with no app registered): a page posts an App Manifest to GitHub
   (`ezapply-<random>`, private, read-only permissions, callback and setup URLs on the companion). The user
   clicks "Create".
3. `/github/app-created`: the companion converts the code into app credentials. The client secret goes to the
   OS keychain, the public parts to `~/.ezapply/github-app.json`. The private key and webhook secret are
   discarded (no server-to-server calls). Redirect to the install page.
4. The user installs the app on chosen repos. `/github/installed` then redirects to the OAuth authorize
   page (or, for a later "update access" visit when already logged in, just says done).
5. `/github/callback`: exchange the code for a user access token (plus refresh token and expiries), read
   `/user`, store `{ tokens, login, name, userId }` in the keychain, wake `github_login_wait`.

Without the first-time steps (app already registered), `/github/start` goes straight to authorize.

### Reusing an existing app
Someone with an ezapply app from another computer or an earlier install doesn't need another one:
the onboarding page asks (its GitHub step opens the same `/github/` flow in a new tab), and `github_login` with
`app: "existing"` connects it (`app: "new"` forces the manifest flow
even when an app is registered; neither given: the registered app, else a new one). GitHub offers no way to
list a user's apps before they sign in, and never shows an app's client secret again, so:
1. `/github/start` (with a nonce whose choice is `existing`) serves a form page with the steps: open
   github.com/settings/apps and edit the ezapply-… app, add this companion's callback URL
   (`http://127.0.0.1:<port>/github/callback`) if it's missing, copy the Client ID, and generate a new client
   secret. GitHub keeps an app's older secrets valid, so other computers keep working.
2. The user pastes the app's name (or its GitHub address), the Client ID and the secret into that page, which
   posts to `POST /github/reuse` on the companion, the only POST route. The secret never passes through the
   chat. The form carries a one-time state of its own, so a web page can't post credentials to the companion.
   Malformed fields bring the form back with the problem (never echoing the secret) and a fresh state.
3. The credentials are kept in memory with the OAuth state, and the user is sent to authorize with that
   Client ID. Nothing is written yet.
4. `/github/callback` exchanges the code with those credentials. Only if that works does the companion store
   the secret in the keychain and write `github-app.json` (`origin: "reused"`). A user token only sees
   installations of the app that issued it, so `/user/installations` names the app for certain (its id and
   slug); the typed name is the fallback for an app not installed anywhere yet, and then the page links to
   its install page. Wrong credentials leave the registered app, secret and token as they were, and the
   error page says to check that the Client ID and secret are from the same app.

Creating a new app over a registered one deletes the old app's token (tokens belong to the app that issued
them). A port mismatch doesn't stop `github_login` when an app is chosen, since the choice replaces the app.

### Tokens
- Stored in the OS keychain (service `ezapply`, keys `github-app-client-secret`, `github-user-token`) via
  `@napi-rs/keyring`. Tests use an in-memory store.
- `token()` refreshes when the access token is within 5 minutes of expiry. If the refresh token expired,
  the stored token is deleted and the error hint says to call `github_login`.
- **One refresh at a time.** GitHub App refresh tokens are single-use, and onboarding indexes repos in
  parallel subagents whose `repo_sync` calls all ask for a token. Concurrent callers share one refresh in
  flight; the refresh re-reads the stored token first (another call may just have refreshed it), and if
  GitHub rejects the refresh token after someone else replaced it, the new stored token is used. Without
  this the second caller got `bad_refresh_token` and the user had to log in again mid-onboarding.
- A stored token that can't be parsed reads as logged out (and is logged), never as a crash.
- `github_logout` revokes the token with GitHub (best effort) and deletes it locally. The app and cached
  repos stay.
- `github_status`: `{ appRegistered, appSlug?, manageUrl?, portMismatch?, loggedIn, login?, name?, tokenExpiresAt? }`.
  `manageUrl` is where the user grants access to more repos.

### The app remembers its port
The app's callback and setup URLs contain the companion's port at creation time, so after
`ezapply init --port N` GitHub would redirect logins to the old port. `github-app.json` records
`localBaseUrl` at creation; when it differs from where the companion listens, `github_status` reports
`portMismatch { appUrl, localUrl, hint }` (move ezapply back and restart the chat, or change the Callback URL and Setup URL
in the app's settings on GitHub), `github_login` refuses with that hint, and `workspace_check` counts
`github_login` as not done. Apps created before this field existed can't be checked.

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
  `clean -fdx`. Syncs of the same repo run one after another (they'd collide on git's `index.lock`). Returns `{ repo, path, headSha, indexedSha, changedSince, affectedClaims, fileCount }`, where
  `changedSince` is `null` (never indexed, or the indexed commit is gone after a force-push), `[]` (current),
  or each file changed since the indexed commit with its line counts (`git diff --numstat --no-renames`), and
  `affectedClaims` names the claims whose `files` include a changed path. The numstat runs before the cache is
  made read-only again, with the same hardening and token as the fetch: the clone is blobless, so it also
  fetches the old side's blobs, which `repo_diff` needs and couldn't fetch itself into a read-only `.git`.
- **Diff** (`repo_diff`): `git diff --no-ext-diff --no-textconv --no-renames <indexedSha> HEAD -- <paths>`, with
  hooks and every transport off, so it never touches the network and the repo's `.gitattributes` can't make
  git run a diff driver. Paths that leave the repo, are absolute or start with `-` are refused. Output past
  60k characters is cut, with a note to ask for fewer paths.
- **Hardening on every git command:** HTTPS only for real remotes (`protocol.allow=never`,
  `protocol.https.allow=always`, so no `file://`, ssh, `ext::` or submodule transports), symlinks off, hooks
  off, credential helpers off, and the token passed per command, never written to `.git/config`.
  `GIT_TERMINAL_PROMPT=0` and no askpass, so git never prompts.
- **The token travels in the environment** (`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.extraHeader`,
  `GIT_CONFIG_VALUE_0=Authorization: Basic …`), not as `-c http.extraHeader=…` on the command line: on Linux
  other local users can read a process's arguments (`/proc/<pid>/cmdline`) but not its environment. This
  needs git 2.31 or later; an older git ignores the variables and private repos fail to authenticate.
- **Read-only:** after each sync every file is marked read-only; only a sync clears it, briefly. Claude
  Code's workspace settings also deny Edit/Write/NotebookEdit under `repo-cache/`, and the skills forbid
  building, installing or running anything from it.
- **Missing git:** `not_found` with the install command for this OS (see [documents](documents.md) for how
  a mid-session install is picked up).
- Auth failures come back with a hint to check the app installation (`github_status.manageUrl`) or that the
  URL is public.

## New commits and forgotten repos
- **`remoteHead`**: `git ls-remote -- <url> HEAD` with the same hardening and token handling as a sync, and a
  10 s timeout. It fetches nothing, so the cache stays as it was. The workspace check compares it with each
  indexed repo's `indexedSha` once per chat ([keeping the workspace current](companion.md#keeping-the-workspace-current-workspace_changes)).
- **`forget`**: deletes a repo's `repo-cache/` mirror (made writable first, queued behind any sync of it) and
  its `knowledge/` folder. Only `workspace_change_mark` calls it, for a repo no longer selected, after the
  user agrees.
- **Timers:** a repo whose new commits the user put off isn't asked about by `remoteHead` until its timer
  (`state.json` `deferred.repos`) runs out. `markIndexed` drops the repo's timer, and writing `repos.yaml` drops
  the timers of repos it no longer lists ([keeping the workspace current](companion.md#keeping-the-workspace-current-workspace_changes)).

## Contributions (`repo_contributions`)
From commit history only (no file contents): total commits, the user's commits (matched by GitHub noreply
email, login or display name), share, first and last commit dates, the top 25 areas (first two path
segments) they changed, and the top 8 authors. If nothing matches, the hint says to ask the user which
author name or email they commit with. Claims in shared repos are limited to the user's own work.
