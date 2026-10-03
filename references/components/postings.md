# Postings (`companion/src/postings/`)

A posting is a job page the user captured with **Set posting**. Each one gets a folder, and one posting at
a time is **active**: the default context for every request.

## Capture (`PostingsService.capture`)
Captures and metadata updates are serialized (one at a time) so two quick clicks can't race.

1. **Canonical URL** (`canonicalizeUrl`): lowercase host, trailing slashes dropped, only query parameters
   that identify a job kept (`gh_jid`, `jobid`, `job_id`, `jid`, `jk`, `currentjobid`, `id`, `reqid`), and on
   Workday the leading locale segment (`/en-US/`) dropped: Workday links to the same job with and without
   it. On Oracle (`oracleJobPath`) the language segment is dropped and so is everything after the job id, so
   a capture on the application pages (`…/job/123/apply/section/1`) is the job's own posting. Each registry site
   says its own (`canonicalPath`): Lever drops `/apply` and Ashby `/application`, so a capture of the
   application is the posting's ([registry](protocol.md#the-site-registry-sitests)). A capture whose canonical URL matches an existing posting reuses that folder. Stored postings are
   matched by their `canonicalUrl` and by their `url` canonicalized again, so postings saved before a
   canonicalization change still match.
2. **Extraction** (`extractPosting`, below) from the visible HTML.
3. **Folder id** for a new posting: `<YYYY-MM-DD>_<company slug ≤30>_<role slug ≤50>` (company falls back to
   `unknown`, role to the page title); `-2`, `-3`… on collision.
4. **Files written**: `capture/raw.html` (body verbatim), `capture/visible.html`, `capture/visible.txt`,
   `capture/jsonld.json`, `posting.md`, then `meta.json`.
5. **Metadata merge**: on a re-capture, values Claude already corrected (company, role, requisition,
   location, deadline, `bundleRequired`, status) win over fresh extraction. The tenant is read from the URL
   and Claude never sets it, so a fresh reading replaces an older one (that's how postings saved while
   myworkdaysite tenants were misread as `wd5` get fixed).
6. `state.json` → `activePostingId` = this posting. The extension shows "Active: company: role".

## Extraction (`extract.ts`)
Input is the **visible** HTML only, so hidden text (collapsed sections, prompt-injection traps) never
reaches `posting.md`.

- Scripts, styles, SVG, iframes and similar are stripped.
- **Embedded boards:** when the extension captured an embedded job board frame (`frameUrl`), the content's
  own site decides how it's read (a Workday board is read as Workday, with its tenant), while the company
  still comes from the page the user was on; `posting.md` notes "Embedded from: <frameUrl>". See
  [extension](extension.md#set-posting).
- Metadata, in order of trust: JSON-LD `JobPosting` (title, hiring organization, identifier, location) →
  Workday page structure (role, location, requisition, tenant) → the page title split on separators
  on ` | `, ` - `, ` – ` (non-Workday; Oracle titles read "<role> - <Company> Careers") → company from the
  URL: on Workday the tenant (`workdayTenant`: the subdomain on myworkdayjobs.com, the path segment after
  `recruiting` on myworkdaysite.com); on an Oracle Cloud host (`*.oraclecloud.com`) nothing, since the host
  names Oracle's pod, not the employer; on LinkedIn and
  Indeed nothing (their job paths, `/jobs/view/<id>` and `/viewjob`, don't name the company), except Indeed
  company pages (`/cmp/<company>`); on another ATS host (Greenhouse, Lever, Ashby, iCIMS…) the first path
  segment (`boards.greenhouse.io/acme`); otherwise the site's own domain name.
- **Tenant:** a Workday posting's tenant, or for any other registry site its own reading of the content's URL
  (`siteTenant`): an Oracle career site (host and site number, `jobs.umbrella.example/cx_1`), a Greenhouse board, a
  Lever company, an Ashby organization.
- Body: on Workday, the job description container; elsewhere Mozilla Readability's main content,
  falling back to the whole body. Converted to markdown with Turndown.
- `posting.md` starts with a header (`# role`, company, location, requisition, URL, a rule) then the body.

Extraction is a starting point: Claude corrects metadata with `posting_update_meta` after reading.

## Other operations
- `list()`: every posting with a valid `meta.json`, newest update first (invalid ones are logged and
  skipped).
- `details(id)`: meta plus folder, the paths of `posting.md`, `visible.txt` and `raw.html`, the files in the
  folder (excluding `.history`, `.build`, `.previews`), and whether it's active.
- `activate(id)`, `activeId()`, `requireActiveId()` (fails with `no_active_posting` and a hint to use
  Set posting or `posting_activate`).
- **Ids** come from Claude (`posting_activate`, `posting_update_meta`), so `folder(id)` accepts only plain
  folder names (`[\w.-]+`, not `.` or `..`) and refuses anything else with `bad_request`: an id like `../x`
  would otherwise resolve outside `postings/`. `list()` skips folders with other names.
- `updateMeta(id, patch)`: validated, serialized, bumps `updatedAt`.

## Folder layout
See [data-formats.md](../data-formats.md#postings) for every file. Besides the capture files, a posting
folder holds `notes.md`, the tailored `.tex`/`.pdf` files, bundles, `.history/` snapshots, `.build/`
compiler output, `.previews/` rendered pages, and `form-log.jsonl`.

## Status
`captured`, `drafting`, `attached`, `filled`, `submitted`, `archived`. Skills set `drafting`; the form
tools move it forward automatically (`attached` on upload, `filled` at review, `submitted` on the
confirmation page), never backward, and only for the posting whose tenant (a Workday tenant, an Oracle career site, a Greenhouse board…) the application
tab is on
([mcp-tools](../mcp-tools.md#forms)). `archived` is set by hand.

## No database
The posting folder is the application record: `meta.json` (status and details) and `form-log.jsonl`
(every fill, upload and step, with the source of each value). A database (the original plan had SQLite) would only
duplicate that, so there is none; lookups go through `postings_list`.

## Duplicates
`postings_list` with `company` (substring over company and tenant) finds earlier applications to the same
employer, e.g. to answer "Have you applied here before?".
