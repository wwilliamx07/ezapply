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
| `pairedExtensionId?` | pinned extension id (the 32 a–p of `chrome-extension://…`); `extension_pair` with `replace: true` forgets it, so another copy can pair |
| `workspace` | absolute workspace path |

A running companion writes only the pairing fields, into the file as it is at that moment, so edits made while
ezapply runs survive. A file that isn't valid JSON or doesn't match the schema is reported with what to do (fix
it, or delete it and run `ezapply init`), not as a stack trace.

**From older builds.** When there's no `config.json`, loading the config renames an older build's `daemon.json`
to it, so the tokens and pairing carry over; keys the schema doesn't know (`idleTimeoutMinutes`) are dropped on
the next write. Nothing reads a `daemon-state.json` beside it, and it can be deleted.

### `github-app.json` (`companion/src/github/service.ts`)
`{ schemaVersion: 1, appId?, slug, clientId, htmlUrl, owner?, createdAt, origin?, localBaseUrl? }`: the public
parts of the user's GitHub App. `origin`: `created` (from the manifest on this machine) or `reused` (an app the
user already had); `createdAt` is when this machine started using it. `appId` can be missing for a reused app
not installed anywhere yet. `localBaseUrl` is `http://127.0.0.1:<port>` when it was set up here, where its
callback URL points; GitHub's status reports `portMismatch` when ezapply now listens elsewhere (a file without
it is never checked).

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
  "notifications": { "turnEnd": true },   // a system notification when the panel's agent ends a turn or asks; see components/extension.md#notifications-notifyts
  "debug": { "enabled": false, "maxMB": 500, "markup": "failures" }   // debug mode: record every form call under debug/
}
```
Every field has a default; a missing file means all defaults. `debug.markup` (also read for every call, a bad value falling back to `"failures"`) says which of the page's
markup debug mode saves: `"failures"` before each call and at every field that fails, `"always"` after each call
too, `"none"` never (the adapter's trace is still recorded). Unknown keys are dropped when the file is read, so
`ezapply init` upgrades an older build's file (`migrateWorkspaceConfig` in `cli/src/workspace-init.ts`), leaving
anything the user changed: `debug.autofill` becomes `debug.enabled` (left alone, it would turn debug mode off
without a word; a `debug.enabled` already set wins); `forms.focusBrowser` and `context.restartOnCapture`, which
nothing reads, are removed (with their object, when it holds nothing else); an untouched
`tex.engine: "latexmk"` becomes `"auto"`, since latexmk fails on MiKTeX without Perl. `tex.engine` applies only to `.tex` files
without a `% !TEX program = pdflatex|xelatex|lualatex|tectonic` comment in their first 20 lines; the
comment wins ([documents](components/documents.md#tex-engines-texenginests)). `latexmkFlags` apply only
when latexmk runs, which a comment never selects.

### `autofill-timing.yaml` (`companion/src/forms/timing.ts`)
The form adapters' waits, for the user to tune. Every site uses the same named waits, each site with values of
its own ([waits owned by the site](components/adapters.md#waits-owned-by-the-site)). Written by `ezapply init` if missing and never
overwritten; read for every form call, so a saved edit applies to the next one.
```yaml
scale: 1                  # multiplies the defaults of the waits left unset (not pollMs; 0.1–10)
# fillTimeoutSeconds: 120 # how long the companion waits for one fill_fields (10–600)
# dropdownOpenMs: 200     # every wait, commented out at its default, with a line on what it does
# workday:                # a site's own section: its keys change that site only, over the top-level ones
#   dropdownOpenMs: 400
```
Keys: `STANDARD_WAITS` in `protocol/src/timing.ts` (ms, 0–120000; `pollMs` 5 or more). A top-level key
changes the wait on every site; a key under a site's id (`workday:`, `oracle:`, `greenhouse:`, `lever:`,
`ashby:`, `phenom:`, `dayforce:`, `successfactors:`) changes it on that site only and wins. The defaults are each site's own waits (its registry entry);
where they differ between sites the template lists each site's. A missing file or key means the site's own. A mistake (bad YAML, an unknown key, a value out of range) falls back
to the default for that part, is logged, and shows in `get_form` as `timingIssues`; it never fails a call.

### `ezapply` / `ezapply.cmd` (workspace launcher, `cli/src/workspace-init.ts`)
Written by every `ezapply init`, for this OS only. POSIX: `#!/bin/sh` and `exec "<node>" "<cli main.js>" "$@"`
(mode 755). Windows: `@echo off` and `"<node>" "<cli main.js>" %*`. Lets `./ezapply` run from the
workspace ([cli](components/cli.md#init-workspace-initts)).

### `debug/<date>-<postingId>/` (`companion/src/forms/debug.ts`)
Written only while `debug.enabled` is on (`ezapply debug on`). It's read for every form call, so it applies
to the next call. One folder per posting and day (`no-posting` when the tab isn't credited to one). The
folder holds:
- `index.jsonl`: one line per form call: `{ seq, ts, tool, ok, ms, queuedMs, failedFields?, tabHidden?,
  windowInBackground?, error?, debug: true }`. Reading starts here.
  `windowInBackground`: the page had no focus (`shown.focused` false), so the browser window was behind
  another app, usually the terminal.
- `NNNN-<tool>.json`: the whole call, with these fields:
  - `params`: an upload's file contents are replaced by its size;
  - the `tab` (for an embedded application: the frame's `url` and `site`, its `frameId` and the page's
    `hostUrl`), `posting`, `postingMatch` (verdict and evidence), `application` and `postingMismatch`,
    `extensionVersion`, `browser`, `timing` and
    `fillTimeoutMs`, `shown` (what `tab.show` did and saw: `emulated` (focus emulation was on), `changesPage`, `hidden`,
    `focused`),
    and `queuedMs` (time behind earlier calls on the tab);
  - `bridge`: every request to the extension, with its parameters, time and full result (the adapter's
    answer before the companion slims it), or its error, and for each adapter call (`form.*`) its `trace`
    (below);
  - `notes`: `noTrace` when the extension sent no trace (built before it);
  - `result`: what the agent got, or `error`.
- `NNNN-before.html`, `NNNN-after.html`: the whole page, cleaned (scripts, styles, stylesheet links, SVG
  contents and inline handlers removed; live values written into attributes, never a password's), before the
  call's first adapter call and after its last ([markup](components/adapters.md#debug-mode-the-adapter-trace)).
  Before with `debug.markup` `failures` or `always`; after with `always`.
- `NNNN-fail-<fieldId>.html`: at each field that failed (unless `none`): its section, every popup or listbox
  open on screen, and the last one the page closed during the field. `<fieldId>` has each run of characters other
  than letters, digits, `.`, `_` and `-` replaced by one `_`, and is cut at 80; a repeat gets `-2`, `-3`.
- `NNNN-fail.png`: a screenshot of the tab after an adapter call where a field failed, when the tab was the active
  one in its window (`-2`… for more in one call).
- `NNNN-<file>.fixture.html`: written by `ezapply debug export` ([cli](components/cli.md)): a saved page with
  the values blanked and the profile's strings, the tenant and the job title replaced, behind a header comment
  saying what was done.

A bridge entry's `trace` (`engine/src/trace.ts`, `DebugTrace`), times in ms from the start of
the call in the page:
- `ms`; `page`: `{ before, after }`, each `{ url, step?, visibility, focused }`;
- `events`, in order, each `{ t, k, … }`. `k`: `query` (`sel`, `in` the element or `document` it was run on, `n`
  elements found, `x` repeats in a row, so a polling wait's queries are one entry each); `press`, `key` (`key`),
  `input` (`value`, up to 80 characters), `type` (`text`, consecutive characters joined), `blur`, `react`
  (`handler`, `missing` when the element had none), `select` (`value`) and `upload` (`name`, the file's;
  SuccessFactors), each with `el`, a summary of the element (tag, automation id
  or id, role, and its label or text up to 40 characters); `wait` (`kind` `waitFor`, `settle` or `sleep`, `name`
  the wait in `T` the caller passed or its length, `max`, `quiet` and `quietMs` for a settle, `ms` taken, `end`
  `condition`, `quiet`, `max` or `slept`); `branch` (`name`: `dropdown re-open`, `date entered again`, `date
  part set directly`, `typeahead search again`, `selected on Enter`, `upload by drop`, `search the list`, with details); `match`
  (`wanted`, `of` options, `chosen`, or the `options` on a miss, up to 40); `listbox` (Workday:
  `shown`, `stale`, `read`, `options`, up to 80) and `list` (Oracle: `options`, up to 80); `field` (`op` `fill`,
  `upload`, `remove`, `list` or `search`, `fieldId`, and once it ends `ms`, `ok`, `error`) and `field-end`;
- `mutations`: the page's DOM changes, `+` and `-` (`el`, `n` elements in it; only the topmost node of each
  change) and `attr` (`el`, `a`, `from`, `to`; only `aria-expanded`, `aria-selected`, `aria-invalid`, `value`,
  `disabled` and `hidden`), a run of the same change one entry with `x`;
- `errors`: `{ k: "error" | "rejection" | "console", message, at? }`; `requests`: `{ method, path, status, ms }`
  (`path` the origin and path only, `status` a number or `failed…`; no `status` if it hadn't ended);
- `failedFields`; `dropped`: entries past each list's cap (events 5000, mutations 2000, errors 200, requests
  500); `markup`: `{ before?, after?, failures?: [{ fieldId, file }] }` and `screenshot`, as the file names
  above (the content goes into the files).

A call that fails or times out is still recorded. Records are written after the call returns, off its path.
`debug.maxMB` caps the folder: past it, the oldest sessions are deleted (never the one being written), checked at
each session's first record and every 50 records.
`ezapply debug clean` deletes it all. It holds the user's personal data and is never sent anywhere
([security](security.md)).

### `state.json`
`{ schemaVersion: 1, synced?: { resume?: { hash, at }, profileIdentity?: { hash, at }, library?: { "<library/… path>": { hash, at } } }, deferred?: { repos?: { "<owner>/<name>": { until, at } } } }`.

An `activePostingId` written by an earlier version is ignored and dropped at the next write; nothing needed it
migrated, since there's no active posting any more ([which posting](mcp-tools.md#postings)).

`synced` is what the workspace check ([companion](components/companion.md#keeping-the-workspace-current-workspace_changes))
compares against: `resume`, the hash of the resume template's main file and content files when the profile was
last brought in line with it; `profileIdentity`, the hash of the profile's `identity`, `contact` and `links`
when the cover template's fields were last set from them; `library`, per LaTeX document in `library/` the user
said isn't a template, the hash of it and the `.tex` files it pulls in at the time (it's reported again once
that changes). All are 12 hex characters of SHA-256 and written
by the companion only (on first sight, or by `workspace_change_mark { as: "done" }`).

`deferred.repos` holds the repos whose new commits the user put off (`workspace_change_mark { as: "later" }` on
a `repo-pushed` change): `until` (ISO time; at most 90 days after `at`) and `at`, when it was put off. Until then
the repo isn't checked. Re-indexing or deselecting the repo removes its entry, and entries past `until` are
removed on any write. Both keys are optional, so adding them needed no `schemaVersion` bump. Writes to
`state.json` run one at a time.

### `agent/`
The side panel's conversations ([agent](components/agent.md)), written by the companion only.
- `conversations.json`: `{ schemaVersion: 1, conversations: { "<posting id>/tailor | <posting id>/fill | general": { sessionId, startedAt,
  agent?, started, agentSessionId?, totalCostUsd?, earlier[] { sessionId, startedAt, endedAt? } } } }`. `agent`
  (`claude` or `antigravity`; absent, from before there was a choice, is `claude`) is the agent the session is
  with. `sessionId` is ezapply's id for the session: the Claude Code session the conversation's process starts
  (`--session-id`) or, once `started` (the agent answered once), resumes. `agentSessionId` is Antigravity's own id
  for it, which a later process continues (`--conversation`). `totalCostUsd` is the session's spend so far, Claude
  Code's estimate. `agent` and `agentSessionId` were added as optional fields an older file parses without, so
  `schemaVersion` stayed 1. Reset moves the session to
  `earlier` (the newest 50), where `claude --resume <id>` still opens it. A file that doesn't parse is treated as
  empty. A key that's a bare posting id is an older build's one conversation per posting: the companion moves it
  to `<posting id>/tailor`, with its logs, once per run
  ([agent](components/agent.md#conversations-servicets)); the keys changed, not the shape, so `schemaVersion`
  stayed 1.
- No `settings.json` any more: the agent settings are the extension's ([below](#extension-storage)). One an
  older build wrote is removed by `ezapply init`, and read by nothing before that.
- `<conversation>/<sessionId>.jsonl` (a posting's under `<posting id>/tailor/` or `<posting id>/fill/`): the session's events, one `AgentEvent` per line (`protocol/src/panel.ts`):
  the user's messages (written again when Claude takes one), Claude's text, tool calls folded to one line, a tool's
  error, settled cards, each turn's end with its cost, notices. A line cut short by a crash is skipped.

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
| `capture/visible.txt` | companion | `document.body.innerText`; empty when the frame wasn't rendered |
| `capture/jsonld.json` | companion | array of the page's JSON-LD blocks (strings) |
| `posting.md` | companion | cleaned description with a header (role, company, location, requisition, URL) |
| `notes.md` | Claude | starts with `## Application requirements` (the posting's instructions for applying), then job requirements, key terms, evidence map, gaps |
| `resume.tex/.pdf`, `cover.tex/.pdf`, `<Last>_<First>_<Company>_Application.pdf` | Claude, companion | tailored documents and bundles |
| `form-log.jsonl` | companion | the application's audit trail (below) |
| `approvals.json` | companion | `{ schemaVersion: 1, approvals: { "<file>": { sha256, approvedAt, reviewId } } }`: the version of each document the user approved on the review page; `upload_file` checks it in the `after-approval` attach mode |
| `reviewed.json` | companion | The version of each document the user last answered a review of, with its text ([below](#postingsidreviewedjson-companionsrcdocumentsreviewts)) |
| `.build/<name>/` | companion | TeX aux files and logs |
| `.history/<timestamp>/` | companion | snapshot of `.tex` + `.pdf` per successful build (newest 30 kept) |
| `.previews/` | older builds | rendered page images nothing writes now; hidden from posting listings |

### `postings/<id>/reviewed.json` (`companion/src/documents/review.ts`)
`{ schemaVersion: 1, documents: { "<file>": { sha256, at, reviewId, approved, pages?: string[] } } }`, keyed by the
document's path in the posting folder, as approvals are. Written when the user answers a review: for each of its
documents, the hash of the bytes shown, when, whether it was approved, and its text per page as `pdf_text` reads
it (absent for a PDF without text). The next review of a document by the same name shows what changed since
([ui](components/ui.md#what-changed-since-the-last-review-changests-protocolsrctextdiffts)), and `pdf_text {
sinceReviewed }` reads it. A file that doesn't parse is treated as empty. A renamed document has no history.

### `postings/<id>/meta.json` (`protocol/src/postings.ts`)
`schemaVersion` 1, `id`, `url`, `canonicalUrl`, `frameUrl?` (the embedded job board frame the content came
from), `pageTitle`, `site` (`workday` | `oracle` | `greenhouse` | `lever` | `ashby` | `phenom` | `dayforce` | `successfactors` | `generic`, of the content: as its page
showed it to the extension, else by its URL), `tenant?` (the employer's space on its site, read from the URL as
that site reads it: a Workday tenant, an Oracle career site as `host/site`, a
Greenhouse board, a Lever company, an Ashby organization, a Phenom careers host, a Dayforce client, a SuccessFactors `company`), `company?`, `role?`, `reqId?`, `location?`, `deadline?`, `bundleRequired?`, `status`, `tabId?`,
`application?`, `capturedAt`, `updatedAt`. `status`: `captured` | `drafting` | `attached` | `filled` | `submitted` |
`archived`. `id` is also the folder name: letters, digits, `_`, `.`, `-` only.

`application` (`PostingApplication`): the application the posting is tied to, `{ url, site, tenant?, job?, from,
at }`. `from`: `apply-link` (the captured page links to it), `host-page-job` (the page's URL names an embedded
board's job: Greenhouse's `gh_jid`; no tenant), `bound` (the first form call that changed a page bound the tab),
`user` (`tab_bind { tabId }`). A posting on a form site's own page needs none: its URL is its
application (`posting-url`, worked out, not stored). A posting without one is searched for it in
`capture/raw.html` the first time a form call is about it, once per run (again after its `reqId` changes). A re-capture keeps a `user` one, else takes what
the page now shows, else keeps the old one. No `schemaVersion` bump: it's optional, older builds drop it when they
rewrite the file, and it's found again from the capture ([which posting](mcp-tools.md#forms)).

### `form-log.jsonl`
One JSON object per line, each with `ts`. Written only for form activity on a tab that may be this posting's
application ([which posting](mcp-tools.md#forms): its job, the tab's binding, its tenant or its title, or nothing
saying otherwise):
- `{ event: "fill", fieldId, value, source, answerId?, ok, error? }`, `source` ∈ `profile`, `answer-bank`,
  `computed`, `user`, `judgment`
- `{ event: "step-check", step?, stepIndex?, warnings[] }`: written by `go_next` before it moves, with what
  still looked off on the step (`checklist`); the review page's `handoff.steps` reads the last per step
- `{ event: "upload", fieldId, file, ok, error? }`
- `{ event: "remove", fieldId, removed, remaining, reason?, ok, error? }`
- `{ event: "remove-row", sectionId, removed?, reason?, ok, error? }` (`removed`: the row's title)
- `{ event: "next", advanced, pageKind, step?, stepIndex? }` (`step`: the title, `stepIndex` its place in the
  progress bar; live titles are often all "Application")
- `{ event: "back", moved, pageKind, step? }`
- `{ event: "confirmation-seen", url }`

Any event can also carry `focusNotEmulated: true` (focus emulation wasn't on for the call, so the tab ran as the
browser left it), `tabHidden: true` (the page was still hidden, so the browser throttled it) and `windowInBackground: true` (the
page was on screen but without focus: the window was behind another app), so a slow step, or a field that wasn't
taken, can be matched to a hidden tab or a window behind afterwards. They're left out when false. An event on a
form site's tab carries `matchedBy`: what tied the tab to this
posting (`job`, `binding`, `page-reqid`, `tenant`, `title`, or `unconfirmed` for the call that bound it).
Readers (the checklist, the hand-off) skip events and fields they don't know, so lines from older builds are
harmless.

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

Written by Claude (onboarding's `draft-profile` task, updates from the resume) and by the onboarding page's form,
which sets the keys above in place: the file's comments, order and keys of the user's own stay; a field the form
leaves empty is removed; lists are written whole. A write that wouldn't validate isn't made
([ui](components/ui.md#writing-the-users-files)). A new file starts with a one-line comment.

### `profile/answers.yaml`
```yaml
schemaVersion: 1
entries:
  - id: sponsorship_future              # lowercase, digits, underscores; unique
    canonical: "Will you now or in the future require visa sponsorship?"
    answer: "No"                        # string | null (always ask) | { default, byCompany: { Acme: "Yes" } }
    suggested: "No"                     # proposal only; never used on a form until copied into answer
    source: profile.workAuthorization.requiresSponsorshipFuture  # profile path; with answer null, answered from it
    sensitive: false                    # true = always ask, even when answered
    variants: ["Do you require sponsorship now or later?"]
    notes: ""
```
The onboarding page sets `answer` by id, in place, keeping the file's comments and every other field.

### `profile/repos.yaml`
`{ schemaVersion: 1, repos: [ { fullName: "owner/name", source: app | public-url, note? } ] }`

### `profile/preferences.md`
Markdown that Claude reads as it is. The onboarding page writes it under fixed headings, each only when it has text:

```markdown
# Preferences

## Tone
## What to emphasize
## Never mention
## Target roles and locations
## Cover letters
```

and reads those sections back into its fields (headings matched case-insensitively). Text under any other `##`
heading, or before the first heading, is kept, after them. `workspace_check` counts its words
(`preferences` is done at 10).

## Templates

### `templates/<kind>/template.json`
`{ schemaVersion: 1, main: "<file>.tex", origin?: default | imported | custom, contentFiles?: ["sections/x.tex", …], example?: "example/<file>", importedFrom?, importedAt?, sourceHash? }`

`contentFiles`: the `.tex` files the main file pulls in with `\input`, `\include` or `\subfile`, relative to
the main file's folder; tailored copies need them beside the copied main file. Recorded by `template_import`
and `template_set_main`.

`importedFrom`: the absolute folder, or single `.tex` file, the template was imported from. Never a Claude
scratchpad now (`template_import` refuses one); an older one pointing there is reported as `template-untracked`,
and marking that done removes `importedFrom` and `sourceHash`.

`sourceHash`: 12 hex characters of SHA-256 over the files in `importedFrom` that an import copies (paths and
contents, line endings normalised; build output skipped; for a single file, that file), as of the last time
the template was current with it. Written by `template_import`, and by `workspace_change_mark` when the user decides a change there
needs no re-import. A template imported before the field existed gets it on the first check that finds the
source unchanged.

### `templates/.synced/resume/`
The resume template's main file and content files as they were when the profile was last brought in line with
them (`state.json` `synced.resume`): the workspace check diffs the template against it. Managed by the
companion, replaced on every `done`, and outside the TeX search path.

### `templates/cover/format.md`
Written by Claude from an example letter: the structure every letter follows (paragraphs and their roles,
salutation, sign-off, subject line, length). No quoted text.

## Knowledge base (`companion/src/repos/service.ts`)

### `knowledge/<owner>__<name>/meta.json`
`{ schemaVersion: 1, repo, url, indexedSha, indexedAt, fileCount?, depthPolicy }`

### `knowledge/<owner>__<name>/claims.yaml`
`{ schemaVersion: 1, repo, claims: [ { id (kebab-case), claim (≥10 chars), skills[], impact (string|null), files[] (≥1, repo paths: files or folders), confidence (high|medium), user_edited } ] }`

The old form, `evidence[] { path, lines?, sha?, hash? }` in place of `files`, is still read (each entry as its
`path`) and is rewritten as `files` by the next `knowledge_mark_indexed`; `schemaVersion` stayed 1
([why files](components/knowledge-base.md#claims-claimsyaml)).

## Extension storage
`storage.local`: `port`, `pairingToken`, `connState`, `pendingCapture` (a `CapturePayload`),
and `agentPrefs`: the panel's agent settings, `{ agent, choices: { claude?, antigravity? } }`, each
choice `{ permissionMode, model?, effort }` (`AgentPrefs`, [agent](components/agent.md#permission-mode-model-and-effort)).
Read field by field (`readAgentPrefs`): one missing or not offered any more takes its default on its own.
