# Data formats

Every file ezapply reads or writes. Each stored format has a `schemaVersion`; a breaking change bumps it
and adds a migration (run by `ezapply init`). Schemas are zod definitions in the named source file.

## Machine level (`~/.ezapply/`, or `$EZAPPLY_APP_DIR`)

### `config.json` (`companion/src/config/app.ts`, mode 0600)
| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `host` | always `127.0.0.1` |
| `port` | default 17373 |
| `mcpToken` | bearer token for `/mcp` (43 base64url chars), presented by the relay |
| `pairingToken` | the extension's code, `XXXX-XXXX-XXXX-XXXX` from an unambiguous alphabet; rotated when a paired extension is forgotten |
| `pairedExtensionId?` | pinned Chrome extension id (stored bare, as before Firefox support, so older configs still match) or Firefox install UUID |
| `workspace` | absolute workspace path |

A running companion writes only the pairing fields, into the file as it is at that moment, so edits made while
a chat runs survive. A file that isn't valid JSON or doesn't match the schema is reported with what to do (fix
it, or delete it and run `ezapply init`), not as a stack trace.

**From earlier builds.** The file used to be `daemon.json`; loading the config moves it to `config.json` when
there's no `config.json` yet, so the tokens and pairing carry over. Its `idleTimeoutMinutes` (the background
daemon's idle stop) is dropped on the next write. `daemon-state.json` (when the extension was last connected,
for the daemon's start-up wait) is deleted by `ezapply init`; nothing reads it.

### `github-app.json` (`companion/src/github/service.ts`)
`{ schemaVersion: 1, appId?, slug, clientId, htmlUrl, owner?, createdAt, origin?, localBaseUrl? }`: the public
parts of the user's GitHub App. `origin`: `created` (from the manifest on this machine) or `reused` (an app the
user already had); `createdAt` is when this machine started using it. `appId` can be missing for a reused app
not installed anywhere yet. `localBaseUrl` is `http://127.0.0.1:<port>` when it was set up here, where its
callback URL points (absent for apps set up before it was recorded).

### OS keychain (service `ezapply`)
- `github-app-client-secret`: the app's client secret.
- `github-user-token`: JSON `{ accessToken, refreshToken, expiresAt, refreshExpiresAt, login, name, userId }`
  (times in epoch ms, `null` when not expiring).

### `logs/companion.log`
pino JSON lines. Page HTML and text, form values, tokens and authorization headers are redacted. Rotated past
5 MB (checked at start and every 10 minutes) to `companion.log.1`, the previous `.1` to `.2`, the oldest
dropped.

## Workspace root

### `ezapply.config.json` (`companion/src/config/workspace.ts`)
```jsonc
{
  "schemaVersion": 1,
  "resume": { "pageLimit": 1, "pageSize": "letter" },      // "letter" | "a4"
  "tex": {
    "engine": "auto",           // auto | latexmk | xelatex | lualatex | pdflatex | tectonic
    "latexmkFlags": ["-xelatex"],
    "timeoutSeconds": 120        // 10–600
  },
  "pdf": { "defaultMaxBytes": 5242880 },   // upload limit when a form's is unknown
  "documents": { "attach": "after-approval" },   // or "immediately"; see components/documents.md
  "decisions": { "provider": "none" },
  "context": { "restartOnCapture": true }   // ezapply chat: a new posting starts a fresh Claude session
}
```
Every field has a default; a missing file means all defaults. `tex.engine` applies only to `.tex` files
without a `% !TEX program = pdflatex|xelatex|lualatex|tectonic` comment in their first 20 lines; the
comment wins ([documents](components/documents.md#tex-engines-texenginests)). `latexmkFlags` apply only
when latexmk runs, which a comment never selects.

### `autofill-timing.yaml` (`companion/src/forms/timing.ts`)
The form adapters' waits (Workday and Oracle use the same named waits), for the user to tune. Written by `ezapply init` if missing and never
overwritten; read for every form call, so a saved edit applies to the next one.
```yaml
scale: 1                  # multiplies the defaults of the waits left unset (not pollMs; 0.1–10)
# fillTimeoutSeconds: 120 # how long the companion waits for one fill_fields (10–600)
# dropdownOpenMs: 2000    # every wait, commented out at its default, with a line on what it does
```
Keys and defaults: `DEFAULT_TIMING` in `protocol/src/timing.ts` (ms, 0–120000; `pollMs` 5 or more). A
missing file or key means the default. A mistake (bad YAML, an unknown key, a value out of range) falls back
to the default for that part, is logged, and shows in `get_form` as `timingIssues`; it never fails a call.

### `ezapply` / `ezapply.cmd` (workspace launcher, `cli/src/workspace-init.ts`)
Written by every `ezapply init`, for this OS only. POSIX: `#!/bin/sh` and `exec "<node>" "<cli main.js>" "$@"`
(mode 755). Windows: `@echo off` and `"<node>" "<cli main.js>" %*`. Lets `./ezapply chat` run from the
workspace ([cli](components/cli.md#init-workspace-initts)).

### `state.json`
`{ schemaVersion: 1, activePostingId? }`.

### `.mcp.json`, `.claude/settings.json`
Claude Code's own formats; ezapply's entries are described in [workspace.md](components/workspace.md#claude-code-settings).

## Postings

### `postings/<id>/`
`<id>` = `<YYYY-MM-DD>_<company slug>_<role slug>` (+ `-2`… on collision).

| File | Written by | Contents |
|---|---|---|
| `meta.json` | companion | `PostingMeta` (below) |
| `capture/raw.html` | companion | `document.body.innerHTML` at capture, verbatim |
| `capture/visible.html` | companion | body HTML with invisible elements removed |
| `capture/visible.txt` | companion | `document.body.innerText` |
| `capture/jsonld.json` | companion | array of the page's JSON-LD blocks (strings) |
| `posting.md` | companion | cleaned description with a header (role, company, location, requisition, URL) |
| `notes.md` | Claude | starts with `## Application requirements` (the posting's instructions for applying), then job requirements, key terms, evidence map, gaps |
| `resume.tex/.pdf`, `cover.tex/.pdf`, `<Last>_<First>_<Company>_Application.pdf` | Claude, companion | tailored documents and bundles |
| `form-log.jsonl` | companion | autofill audit trail (below) |
| `approvals.json` | companion | `{ schemaVersion: 1, approvals: { "<file>": { sha256, approvedAt, reviewId } } }`: the version of each document the user approved on the review page; `upload_file` checks it in the `after-approval` attach mode |
| `.build/<name>/` | companion | TeX aux files and logs |
| `.history/<timestamp>/` | companion | snapshot of `.tex` + `.pdf` per successful build (newest 30 kept) |
| `.previews/<name>-p<n>.png` | companion | rendered pages |

### `postings/<id>/meta.json` (`protocol/src/postings.ts`)
`schemaVersion` 1, `id`, `url`, `canonicalUrl`, `frameUrl?` (the embedded job board frame the content came
from), `pageTitle`, `site` (`workday` | `oracle` | `generic`, of the content), `tenant?` (the Workday tenant or the
Oracle career site as `host/site`, read from the URL), `company?`, `role?`, `reqId?`, `location?`, `deadline?`, `bundleRequired?`, `status`, `tabId?`,
`capturedAt`, `updatedAt`. `status`: `captured` | `drafting` | `attached` | `filled` | `submitted` |
`archived`. `id` is also the folder name: letters, digits, `_`, `.`, `-` only.

### `form-log.jsonl`
One JSON object per line, each with `ts`. Written only for form activity on a tab of this posting's tenant
(Workday tenant or Oracle career site; or when either has no tenant):
- `{ event: "fill", fieldId, value, source, answerId?, ok, error? }`, `source` ∈ `profile`, `answer-bank`,
  `computed`, `user`, `judgment`
- `{ event: "upload", fieldId, file, ok, error? }`
- `{ event: "remove", fieldId, removed, remaining, reason?, ok, error? }`
- `{ event: "remove-row", sectionId, removed?, reason?, ok, error? }` (`removed`: the row's title)
- `{ event: "next", advanced, pageKind, step?, stepIndex? }` (`step`: the title, `stepIndex` its place in the
  progress bar; live titles are often all "Application")
- `{ event: "back", moved, pageKind, step? }`
- `{ event: "confirmation-seen", url }`

Any event can also carry `tabActivated: true` (the companion switched to the application tab before the call)
and `tabHidden: true` (the page was still hidden, so the browser throttled it), so a slow step can be matched to
a hidden tab afterwards. They're left out when false.

## Profile (`companion/src/profile/schema.ts`)

### `profile/profile.yaml`
`schemaVersion` 1 and:
- `identity { firstName, lastName, middleName?, preferredName?, pronouns? }`
- `contact { email, phone? { countryCode (+1), number, type (mobile/home/work) }, address { line1?, line2?, city, region?, postalCode?, country } }`
- `links { linkedin?, github?, portfolio?, other[] { label, url } }`
- `workAuthorization { authorizedIn[], requiresSponsorshipNow?, requiresSponsorshipFuture?, citizenship[], securityClearance? }`
- `jobPreferences { relocate?, workMode? (remote/hybrid/onsite/any), desiredLocations[], earliestStart?, willingToTravelPercent? }`
- `work[] { company, title, location?, employmentType?, start (YYYY-MM), end (YYYY-MM or null = current), highlights[] }`
- `education[] { school, degree, field?, start?, end?, gpa?, honors[], coursework[] }`
- `skills[] { category, items[] }`, `languages[] { language, proficiency }`,
  `certifications[] { name, issuer?, date?, url? }`
- `eeo { gender?, race?, hispanicOrLatino?, veteranStatus?, disability?, sexualOrientation? }`

### `profile/answers.yaml`
```yaml
schemaVersion: 1
entries:
  - id: sponsorship_future              # lowercase, digits, underscores; unique
    canonical: "Will you now or in the future require visa sponsorship?"
    answer: "No"                        # string | null (always ask) | { default, byCompany: { Acme: "Yes" } }
    suggested: "No"                     # proposal only; never used on a form until copied into answer
    source: profile.workAuthorization   # where the answer should come from, if not fixed
    sensitive: false                    # true = always ask, even when answered
    variants: ["Do you require sponsorship now or later?"]
    notes: ""
```

### `profile/repos.yaml`
`{ schemaVersion: 1, repos: [ { fullName: "owner/name", source: app | public-url, note? } ] }`

### `profile/preferences.md`
Free text.

## Templates

### `templates/<kind>/template.json`
`{ schemaVersion: 1, main: "<file>.tex", origin?: default | imported | custom, contentFiles?: ["sections/x.tex", …], example?: "example/<file>", importedFrom?, importedAt? }`

`contentFiles`: the `.tex` files the main file pulls in with `\input`, `\include` or `\subfile`, relative to
the main file's folder; tailored copies need them beside the copied main file. Recorded by `template_import`
and `template_set_main`.

### `templates/cover/format.md`
Written by Claude from an example letter: the structure every letter follows (paragraphs and their roles,
salutation, sign-off, subject line, length). No quoted text.

## Knowledge base (`companion/src/repos/service.ts`)

### `knowledge/<owner>__<name>/meta.json`
`{ schemaVersion: 1, repo, url, indexedSha, indexedAt, fileCount?, depthPolicy }`

### `knowledge/<owner>__<name>/claims.yaml`
`{ schemaVersion: 1, repo, claims: [ { id (kebab-case), claim (≥10 chars), skills[], impact (string|null), evidence[] (≥1) { path, lines? ("12" or "12-40"), sha? (≥7), hash? (12 hex) }, confidence (high|medium), user_edited } ] }`

`hash`: SHA-256 of the cited lines (line endings and trailing whitespace ignored), first 12 hex characters,
written by `knowledge_mark_indexed` on evidence with `lines`; `claims_check` fails when the lines no longer
match. Adding it didn't change `schemaVersion` (it's optional; older files are stamped on their next
`knowledge_mark_indexed`).

## Extension storage
`storage.local`: `port`, `pairingToken`, `connState`, `pendingCapture` (a `CapturePayload`),
`activeLabel`. `storage.session` (Firefox): `keepalive` timestamp.
