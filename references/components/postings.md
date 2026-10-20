# Postings (`companion/src/postings/`)

A posting is a job page the user captured with **Capture**. Each one gets a folder, and one posting at
a time is **active**: the default context for every request.

## Capture (`PostingsService.capture`)
Captures and metadata updates are serialized (one at a time) so two quick clicks can't race.

1. **Canonical URL** (`canonicalizeUrl`): lowercase host, trailing slashes dropped, only query parameters
   that identify a job kept: the common ones (`jobid`, `job_id`, `jid`, `jk`, `currentjobid`, `id`, `reqid`) and
   every registry site's `jobParams` ([registry](sites.md#the-registry); Greenhouse's `gh_jid`, Phenom's `jobseqno`,
   SuccessFactors' `career_job_req_id` with `company`, each explained on its site's page). The path is what the
   URL's registry site says (`canonicalPath`, [registry](sites.md#the-registry)): Workday drops the leading locale
   segment (`/en-US/`), since it links to the same job with and without it; Oracle (`oracleJobPath`) the language
   segment and everything after the job id, so a capture on the application pages (`…/job/123/apply/section/1`)
   is the job's own posting; Dayforce the locale and what follows the job id; Lever drops `/apply` and Ashby
   `/application`, and Phenom reads `hvhapply` as `apply`, so a capture of the application is the posting's. A capture whose canonical URL matches an existing posting reuses that folder. Stored postings are
   matched by their `canonicalUrl` and by their `url` canonicalized again, so postings saved before a
   canonicalization change still match.
2. **Extraction** (`extractPosting`, below) from the visible HTML.
3. **Folder id** for a new posting: `<YYYY-MM-DD>_<company slug ≤30>_<role slug ≤50>` (company falls back to
   `unknown`, role to the page title); `-2`, `-3`… on collision.
4. **Files written**: `capture/raw.html` (body verbatim), `capture/visible.html`, `capture/visible.txt`,
   `capture/jsonld.json`, `posting.md`, then `meta.json`.
5. **Metadata merge**: on a re-capture, the stored company, role, requisition, location, deadline,
   `bundleRequired` and status win over fresh extraction, which only fills gaps, so what Claude corrected stays.
   The URL, page title, site and tab are the new capture's. The tenant is read from the URL
   and Claude never sets it, so a fresh reading replaces an older one (that's how postings saved while
   myworkdaysite tenants were misread as `wd5` get fixed).
   **The application** (below) is looked for in the page; a re-capture keeps one the user set, else takes what
   the page now shows, else keeps the old one.
6. Listeners (`onChange`) hear of it, so the panel's list follows; the extension flashes "Captured: company: role".
   Nothing is made "active": the panel's **+ Capture** opens the posting, and each posting's conversations work on it
   ([which posting](../mcp-tools.md#postings)).

## Extraction (`extract.ts`)
Input is the **visible** HTML only, so hidden text (collapsed sections, prompt-injection traps) never
reaches `posting.md`.

- Scripts, styles, SVG, iframes and similar are stripped.
- **The content's site** (`meta.site`): what the extension found on the page the content came from, by its body
  (`CapturePayload.site`, [telling a page's site](extension.md#telling-a-pages-site-framests)), else that page's
  URL. So a Phenom job page on an employer's domain is `phenom`, though its URL names no site.
- **Embedded boards:** when the extension captured an embedded job board frame (`frameUrl`), the content's
  own site decides how it's read (a Workday board is read as Workday, with its tenant), while the company
  still comes from the page the user was on; `posting.md` notes "Embedded from: <frameUrl>". See
  [extension](extension.md#capture).
- **A site's own reader** (`<site>/reader.ts` in [the sites package](sites.md#the-package), `POSTING_READERS` by site
  id, called only for a registry site), only for a site whose posting pages
  the generic reading gets wrong: today Workday's (its description, role, location and requisition by the hooks
  shared with the adapter, `WORKDAY_POSTING`; its titles are only the role). `extract.ts` names no site: a new site
  needing one gets a reader there, never a branch ([building adapters](../building-adapters.md#5-a-posting-reader-only-if-needed-sitereaderts)).
- Metadata, in order of trust: JSON-LD `JobPosting` (title, hiring organization, identifier, location) →
  the site's reader (role, location, requisition) → the page title (role and company only: "<role> at
  <company>", else split on ` | `, ` - `, ` – `, ` — `, with words like "Careers" dropped from the company;
  not when the reader says the title is only the role; Oracle titles read "<role> - <Company> Careers") → company from the
  URL: on a registry site's `providerHosts` ([registry](sites.md#the-registry)) what its `company` reads there (a
  Workday tenant; a Greenhouse, Lever or Ashby board's first path segment), else nothing, since the host names the
  provider (an Oracle Cloud pod, a Dayforce or SuccessFactors data centre), not the employer; on LinkedIn and
  Indeed nothing (their job paths, `/jobs/view/<id>` and `/viewjob`, don't name the company), except Indeed
  company pages (`/cmp/<company>`); on another job board ezapply has no site for (`JOB_BOARD_HOSTS`: iCIMS,
  SmartRecruiters…) the first path segment; otherwise the site's own domain name. `extract.ts` names no site.
- **Tenant:** the content's site's own reading of its URL (the registry's `tenant`): a Workday tenant, an Oracle career site (host and site number, `jobs.example.com/cx_1`), a
  Greenhouse board, a Lever company, an Ashby organization, a Phenom careers host, a Dayforce client, a SuccessFactors `company`.
- Body: the site's reader's description where it has one (Workday's description container); elsewhere Mozilla Readability's main content,
  falling back to the whole body. Converted to markdown with Turndown.
- `posting.md` starts with a header (`# role`, company, location, requisition, URL, a rule) then the body.

Extraction is a starting point: Claude corrects metadata with `posting_update_meta` after reading.

## The application (`application.ts`)
Which application a posting is tied to, so the form tools can tell its tab from another posting's
([which posting](../mcp-tools.md#forms)). Everything a URL says comes from the site registry (`isUrl`,
`tenant`, `job`, `hostPageJob`), so a new site is covered by its registry entry.
- **The posting's own URL** (or the frame it came from) on a form site is its application
  (`applicationFromUrl`, `from: "posting-url"`); nothing is stored.
- **Otherwise the captured page** (`findApplication` over the body's `href`s, resolved against the page):
  links whose site reads a job from them. One distinct site, tenant and job → it (`apply-link`). Several → the one
  matching `reqId` (`sameJob` with the link's site, so a Phenom `jobSeqNo` matches the requisition it embeds), else none: a careers page often lists other jobs. Links without a job (Workday's `…/login`)
  never count.
- **Else a job the page's URL names for an embedded board** (`hostPageJob`: Greenhouse's `gh_jid` on a
  company's careers page), `host-page-job`, with no tenant.
- **Postings captured earlier** get it from `capture/raw.html` the first time they're active in a form call
  (`application(id)`), and it's saved; one with nothing found isn't searched again until the companion restarts,
  its `reqId` changes or it's captured again.
- **Later:** the first form call that changes a page stores the tab's (`bound`), and `tab_bind
  { tabId }` the tab the user names (`user`); `setApplication`.

Verified on real captures: employers' careers pages are tied to their Workday requisitions by the page's Apply
link, and to a Greenhouse job by `gh_jid`. Pages that link to nothing in the registry (a school's job board, many
employers' own career sites, iCIMS) are bound on first use.

## Other operations
- `list()`: every posting with a valid `meta.json`, newest update first (invalid ones are logged and
  skipped).
- `details(id)`: meta plus folder, the paths of `posting.md`, `visible.txt` and `raw.html`, the files in the
  folder (excluding `.history`, `.build`, `.previews`).
- `ownPosting(session)`: the posting of the conversation the session is (wired from the agent service with
  `sessionPostings`), or none. `resolve(id?, session?)`: the posting a call is about: `id` when given (an unknown
  one is `not_found`; another than the conversation's own is `bad_request`), else the conversation's, else
  `no_posting` with a hint to name one from `postings_list`.
- `delete(id)`: removes the posting's folder for good, serialized with the other writes; its listeners hear of it. Only the side panel calls it
  (`panel.deletePosting`); no MCP tool can delete a posting, so Claude can't.
- **Ids** come from Claude (`posting_get`, `tab_bind`, `posting_update_meta`), so `folder(id)` accepts only plain
  folder names (`[\w.-]+`, not `.` or `..`) and refuses anything else with `bad_request`: an id like `../x`
  would otherwise resolve outside `postings/`. `list()` skips folders with other names.
- `updateMeta(id, patch)`: validated, serialized, bumps `updatedAt`. A `reqId` is trimmed, and one of more than
  three words is refused as a title (`checkReqId`): agents have put a job title there, which compares with no
  application's job id. An unknown id is `not_found`.

## Folder layout
See [data-formats.md](../data-formats.md#postings) for every file. Besides the capture files, a posting
folder holds `notes.md`, the tailored `.tex`/`.pdf` files, bundles, `.history/` snapshots, `.build/`
compiler output, `.previews/` (rendered pages, left by older versions), and `form-log.jsonl`.

## Status
`captured`, `drafting`, `attached`, `filled`, `submitted`, `archived`. Skills set `drafting`; the form
tools move it forward automatically (`attached` on upload, `filled` at review, `submitted` on the
confirmation page), never backward, and only for the posting the application tab is credited to
([which posting](../mcp-tools.md#forms)). `archived` is set by hand.

## No database
The posting folder is the application record: `meta.json` (status and details) and `form-log.jsonl`
(every fill, upload and step, with the source of each value). A database would only duplicate that, so there is
none; lookups go through `postings_list`.

## Duplicates
`postings_list` with `company` (substring over company and tenant) finds earlier applications to the same
employer, e.g. to answer "Have you applied here before?".
