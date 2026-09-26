# MCP tools

The `ezapply` MCP server's full surface, as registered in `companion/src/mcp/tools/`. Every tool validates
its input with zod, returns JSON text (images for `pdf_render` and `screenshot`), and on failure returns
`isError: true` with `{ error: { code, message, hint? } }`. Paths may be absolute or relative to the
workspace root and must fall under the folders listed for that tool (`path_not_allowed` otherwise).
Read-only tools carry the MCP `readOnlyHint`.

## Setup and status

| Tool | Input | Does |
|---|---|---|
| `workspace_check` | — | The onboarding checklist `{ ready, nextStep?, items[] }` ([details](components/companion.md#readiness-checklist-workspace_check)) |
| `extension_pair` | `replace?` | Opens pairing for 15 min and returns, per browser, the page, steps and path to load (plus a hint if not built). Already connected → `{ connected: true }`. `replace` first forgets the paired extension and rotates the code |
| `extension_pair_wait` | `timeoutSeconds` (5–900, default 180) | Waits for the extension to connect; `{ connected, extension? , hint? }` |
| `browser_status` | — | Companion version, bridge status, active posting id, and when connected the extension version and every tab with its site; when not, a hint |

## Postings

| Tool | Input | Does |
|---|---|---|
| `posting_active` | — | The active posting's metadata, folder, paths of `posting.md`, `visible.txt`, `raw.html`, its files, `active`. None → `no_active_posting` |
| `postings_list` | `status?`, `company?` (substring over company and tenant), `limit?` (default 25, max 200) | Postings newest first with id, company, role, status, site, url, updatedAt, active |
| `posting_activate` | `id` | Make it active; returns its details |
| `posting_update_meta` | `id?` (default active), `company?`, `role?`, `reqId?`, `location?`, `deadline?`, `bundleRequired?`, `status?` | Correct or add metadata; move status |

## Documents
TeX source under `postings/` or `templates/`; PDFs read from `postings/`, `templates/`, `library/`; output
under `postings/` or `library/`. Details: [documents.md](components/documents.md).

| Tool | Input | Does |
|---|---|---|
| `tex_compile` | `path`, `maxPages?` | Compile next to the file (no shell escape) with the engine named by the file's `% !TEX program` comment, else `tex.engine` ([documents](components/documents.md#tex-engines-texenginests)). `{ ok, engine, engineFrom, pdf, pages, pageLimit?, pageLimitExceeded?, diagnostics[], logPath, durationMs, snapshot, hint? }`. `*resume*`/`*cv*` files are checked against the page limit. Snapshots to `.history/` |
| `tex_diff` | `oldPath`, `newPath` | latexdiff → compiled change-highlighted PDF (needs latexdiff) |
| `pdf_render` | `path`, `page` (default 1), `scale` (0.5–3, default 1.5) | The page as an image; a copy saved to `.previews/` |
| `pdf_text` | `path`, `pages?` (`"1-2,4"`) | Text per page in reading order |
| `pdf_info` | `path` | Pages, bytes, page sizes, encrypted, text layer, title, author |
| `pdf_merge` | `inputs[] { path, pages?, label? }`, `output`, `bookmarks` (true), `normalize` (`auto`/`none`/`letter`/`a4`), `title?`, `author?` | One PDF with bookmarks and consistent page sizes; returns sections with page ranges |
| `pdf_from_images` | `images[]`, `output`, `pageSize` (`letter`/`a4`) | Images → PDF, one per page |
| `pdf_compress` | `path`, `output?` (default overwrite), `targetBytes?` (default config, 5 MB) | Lossless, then Ghostscript if installed; before/after, method, target met |
| `open_file` | `path` (under `postings/`, `templates/`, `library/`) | Opens in the user's default app |

## Profile and templates
Details: [profile-and-templates.md](components/profile-and-templates.md).

| Tool | Input | Does |
|---|---|---|
| `profile_check` | — | Validate `profile.yaml`: errors with paths, or commonly-needed fields still missing |
| `answers_check` | — | Validate `answers.yaml`; counts; unanswered entries with suggestions and sources; sensitive ids |
| `template_import` | `sourceDir` (absolute, outside the workspace), `kind` (`resume`/`cover`), `main?`, `replace?` | Copy a LaTeX project into `templates/<kind>/`; replaces the default cover without asking, anything else needs `replace`; the old one goes to `templates/.old/`. Adds `% !TEX program = pdflatex` to a pdfTeX-only main file and reports it in `texProgram` |
| `template_import_example` | `sourcePath` (absolute) | Copy a sample cover letter (PDF, PNG/JPG/WebP, TXT, MD; ≤20 MB) into `templates/cover/example/`; Word → hint to export PDF |
| `template_set_main` | `kind`, `main` (relative to `templates/<kind>/`) | Record the main file; marks a non-imported template `custom` |

## GitHub and knowledge base
Details: [github-and-repos.md](components/github-and-repos.md), [knowledge-base.md](components/knowledge-base.md).

| Tool | Input | Does |
|---|---|---|
| `github_status` | — | App registered, slug, `manageUrl`, logged in, login, name, token expiry |
| `github_login` | — | Opens the daemon's login page (creates the app the first time); returns the URL and a `tell` text for the user |
| `github_login_wait` | `timeoutSeconds` (5–900, default 300) | Waits for the browser flow; times out with a hint |
| `github_logout` | — | Revoke and delete the token |
| `github_list_repos` | — | Every repo the app can read, newest push first, with `selected` |
| `repos_selection_get` | — | Selected repos with cache and index state |
| `repos_selection_set` | `repos[] { fullName, source (app/public-url), note? }` | Replace `profile/repos.yaml` |
| `repo_sync` | `repo` (must be selected) | Clone or update the read-only cache; `{ path, headSha, indexedSha, changedSince, fileCount }` |
| `repo_contributions` | `repo` | The user's share of commits, dates, areas touched, top authors |
| `claims_check` | `repo` | Validate `claims.yaml` and every evidence path and line range |
| `knowledge_mark_indexed` | `repo` | Requires a clean `claims_check`; records the indexed commit |

## Forms
Workday only; `tabId` defaults to the active Workday tab. Each call is an RPC to the extension
([workday-adapter.md](components/workday-adapter.md)). Fills, uploads, steps and the confirmation page are
appended to the active posting's `form-log.jsonl`, and the posting status moves forward automatically.

| Tool | Input | Does |
|---|---|---|
| `get_form` | `tabId?` | The page's `FormSchema`. Seeing `review` sets status `filled`; `confirmation` sets `submitted` |
| `list_options` | `fieldId`, `tabId?` | Options of a dropdown or a typeahead's top level (`hasChildren` = nested menu) |
| `search_options` | `fieldId`, `query`, `tabId?` | Type into a typeahead and return matches |
| `fill_fields` | `fills[] { fieldId, value, source, answerId? }`, `tabId?` | Fill in one batch. `source`: `profile`, `answer-bank` (+`answerId`), `computed`, `user`, `judgment`. Per field: ok, read-back, error, available options |
| `upload_file` | `fieldId`, `path` (under `postings/` or `library/`, ≤25 MB), `tabId?` | Attach a file; success sets status `attached` |
| `add_repeatable` | `addButtonId`, `tabId?` | Press an add button (another work or education row) |
| `go_next` | `tabId?` | Next / Save and Continue. Refuses on review and on any submit control |
| `page_action` | `action` (`apply`, `apply_manually`, `autofill_with_resume`, `use_last_application`), `tabId?` | Start-page buttons |
| `screenshot` | `tabId?` | The visible part of the tab as an image (tab must be visible) |

There is deliberately no general click, navigate or script tool, and no submit.

## Decision tools (not registered)
`suggest_answers` and `decide` are reserved for a future `DecisionProvider` (e.g. Jev). With the only
provider being `none`, they don't exist. See [status.md](status.md#deferred).
