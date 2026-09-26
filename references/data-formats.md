# Data formats

Every file ezapply reads or writes. Each stored format has a `schemaVersion`; a breaking change bumps it
and adds a migration (run by `ezapply init`). Schemas are zod definitions in the named source file.

## Machine level (`~/.ezapply/`, or `$EZAPPLY_APP_DIR`)

### `daemon.json` (`companion/src/config/daemon.ts`, mode 0600)
| Field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `host` | always `127.0.0.1` |
| `port` | default 17373 |
| `mcpToken` | bearer token for `/mcp` and `/control/*` (43 base64url chars) |
| `pairingToken` | the extension's code, `XXXX-XXXX-XXXX-XXXX` from an unambiguous alphabet; rotated when a paired extension is forgotten |
| `pairedExtensionId?` | pinned Chrome extension id (stored bare, as before Firefox support, so older configs still match) or Firefox install UUID |
| `workspace` | absolute workspace path |

### `github-app.json` (`companion/src/github/service.ts`)
`{ schemaVersion: 1, appId, slug, clientId, htmlUrl, owner?, createdAt }`: the public parts of the user's
GitHub App.

### OS keychain (service `ezapply`)
- `github-app-client-secret`: the app's client secret.
- `github-user-token`: JSON `{ accessToken, refreshToken, expiresAt, refreshExpiresAt, login, name, userId }`
  (times in epoch ms, `null` when not expiring).

### `logs/companion.log`
pino JSON lines. Page HTML and text, form values, tokens and authorization headers are redacted.

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
  "decisions": { "provider": "none" }
}
```
Every field has a default; a missing file means all defaults. `tex.engine` applies only to `.tex` files
without a `% !TEX program = pdflatex|xelatex|lualatex|tectonic` comment in their first 20 lines; the
comment wins ([documents](components/documents.md#tex-engines-texenginests)). `latexmkFlags` apply only
when latexmk runs, which a comment never selects.

### `state.json`
`{ schemaVersion: 1, activePostingId? }`.

### `.mcp.json`, `.claude/settings.json`
Claude Code's own formats; ezapply's entries are described in [workspace.md](components/workspace.md#claude-code-settings).

## Postings

### `postings/<id>/`
`<id>` = `<YYYY-MM-DD>_<company slug>_<role slug>` (+ `-2`… on collision).

| File | Written by | Contents |
|---|---|---|
| `meta.json` | daemon | `PostingMeta` (below) |
| `capture/raw.html` | daemon | `document.body.innerHTML` at capture, verbatim |
| `capture/visible.html` | daemon | body HTML with invisible elements removed |
| `capture/visible.txt` | daemon | `document.body.innerText` |
| `capture/jsonld.json` | daemon | array of the page's JSON-LD blocks (strings) |
| `posting.md` | daemon | cleaned description with a header (role, company, location, requisition, URL) |
| `notes.md` | Claude | requirements, key terms, evidence map, gaps |
| `resume.tex/.pdf`, `cover.tex/.pdf`, `<Last>_<First>_<Company>_Application.pdf` | Claude, daemon | tailored documents and bundles |
| `form-log.jsonl` | daemon | autofill audit trail (below) |
| `.build/<name>/` | daemon | TeX aux files and logs |
| `.history/<timestamp>/` | daemon | snapshot of `.tex` + `.pdf` per successful build (newest 30 kept) |
| `.previews/<name>-p<n>.png` | daemon | rendered pages |

### `postings/<id>/meta.json` (`protocol/src/postings.ts`)
`schemaVersion` 1, `id`, `url`, `canonicalUrl`, `pageTitle`, `site` (`workday` | `generic`), `tenant?`,
`company?`, `role?`, `reqId?`, `location?`, `deadline?`, `bundleRequired?`, `status`, `tabId?`,
`capturedAt`, `updatedAt`. `status`: `captured` | `drafting` | `attached` | `filled` | `submitted` |
`archived`.

### `form-log.jsonl`
One JSON object per line, each with `ts`:
- `{ event: "fill", fieldId, value, source, answerId?, ok, error? }`, `source` ∈ `profile`, `answer-bank`,
  `computed`, `user`, `judgment`
- `{ event: "upload", fieldId, file, ok, error? }`
- `{ event: "next", advanced, pageKind, step? }`
- `{ event: "confirmation-seen", url }`

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
`{ schemaVersion: 1, main: "<file>.tex", origin?: default | imported | custom, example?: "example/<file>", importedFrom?, importedAt? }`

### `templates/cover/format.md`
Written by Claude from an example letter: the structure every letter follows (paragraphs and their roles,
salutation, sign-off, subject line, length). No quoted text.

## Knowledge base (`companion/src/repos/service.ts`)

### `knowledge/<owner>__<name>/meta.json`
`{ schemaVersion: 1, repo, url, indexedSha, indexedAt, fileCount?, depthPolicy }`

### `knowledge/<owner>__<name>/claims.yaml`
`{ schemaVersion: 1, repo, claims: [ { id (kebab-case), claim (≥10 chars), skills[], impact (string|null), evidence[] (≥1) { path, lines? ("12" or "12-40"), sha? (≥7) }, confidence (high|medium), user_edited } ] }`

## Extension storage
`storage.local`: `port`, `pairingToken`, `connState`, `pendingCapture` (a `CapturePayload`),
`activeLabel`. `storage.session` (Firefox): `keepalive` timestamp.
