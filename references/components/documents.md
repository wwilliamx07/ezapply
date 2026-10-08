# Documents (`companion/src/documents/`)

Compiling LaTeX, checking the result, and handling PDFs. `DocumentsService` holds the logic; the
`documents` tool group ([mcp-tools.md](../mcp-tools.md#documents)) is a thin layer over it.

## Where each operation may read and write

| Operation | Allowed folders (workspace-relative) |
|---|---|
| TeX source (`tex_compile`, `tex_diff`) | `postings/`, `templates/` |
| Read PDFs (`pdf_render`, `pdf_text`, `pdf_info`, merge inputs) | `postings/`, `templates/`, `library/` |
| Write PDFs (merge output, images → PDF, compress output) | `postings/`, `library/` |
| Images for `pdf_from_images` | `postings/`, `library/` |
| `open_file` | `postings/`, `templates/`, `library/` |

Anything else fails with `path_not_allowed`.

## TeX engines (`tex/engines.ts`)
`TexEngine { id, available(), compile(req) }` with implementations:

| Id | How it runs |
|---|---|
| `latexmk` | `latexmk` with `tex.latexmkFlags` (default `-xelatex`, so auto builds with XeLaTeX for system fonts); needs Perl, so availability runs `latexmk -v` |
| `xelatex`, `lualatex`, `pdflatex` | run directly, up to 3 passes while the log asks for a rerun |
| `tectonic` | `tectonic -X compile` with `-Z search-path=` for the template folders |

- **Selection, per file** (`pickEngine` in `service.ts`), first match wins:
  1. **The file's `% !TEX program` comment** (`readTexProgram`): the first line within the first 20 of the
     file being compiled that reads `% !TEX program = <engine>` or TeXShop's `% !TEX TS-program = <engine>`,
     any case, spaces optional, BOM ignored. The value must be one of `PROGRAM_ENGINES`: `pdflatex`,
     `xelatex`, `lualatex`, `tectonic`, and is only ever matched against that list, never run as written.
     latexmk isn't allowed: it's a build driver and the comment wouldn't say which engine it should drive.
     The named engine runs directly, so `tex.latexmkFlags` can't override it. An unknown value (including
     one with options, like `pdflatex --shell-escape`) fails with `bad_request`; a named engine that isn't
     installed fails with `not_found` and the install hint. Neither falls back to another engine, because
     another engine can change the fonts and the page count.
  2. **`tex.engine`** in `ezapply.config.json`, when it isn't `auto`.
  3. **`auto`** (default): the first available of latexmk, xelatex, lualatex, tectonic. pdflatex is never
     auto-picked: it can't load system fonts.

  The result's `engineFrom` says which applied: `magic-comment`, `config` or `auto`. The comment exists
  because one workspace setting can't build both documents: many LaTeX resumes (e.g. Jake Gutierrez's
  template) are pdfLaTeX-only (`\pdfgentounicode`, `glyphtounicode`), and even when guarded they come out
  longer under XeLaTeX's Latin Modern metrics, while the default cover letter needs XeLaTeX (`fontspec`).
  Tailored copies are copies of the template's main file, so they carry the comment with them, and
  latexdiff keeps the new file's first line, so `-diff.tex` builds with the same engine.
- **Import-time detection** (`detectTexProgram`, `withTexProgram`): `template_import` adds
  `% !TEX program = pdflatex` as the first line of the imported main file when it has no comment, uses
  `\pdfgentounicode`, `\pdfglyphtounicode` or `\input{glyphtounicode}`, and doesn't mention `fontspec` or
  `\setmainfont` ([profile-and-templates](profile-and-templates.md#importing-a-latex-template-template_import)).
  Compile time never guesses: a file without a comment uses `tex.engine`.
- **Availability** is re-checked until found: `which()` doesn't cache misses, and latexmk's Perl check
  only remembers success. A TeX install mid-session is picked up without a restart. The distribution check
  (MiKTeX or TeX Live, which spell some options differently) likewise remembers only a definite answer:
  an `ezapply chat` started before MiKTeX was installed would otherwise keep treating it as unknown and pass the TeX
  Live flag (harmless: MiKTeX accepts `-no-shell-escape`, but loses `--max-print-line`).
- **No engine:** `not_found` with the install command for this OS (winget MiKTeX + package auto-install
  on Windows, `brew install --cask mactex-no-gui` on macOS, `texlive-xetex latexmk` on Linux).
- **Safety:** shell escape is always off (`--disable-write18` on MiKTeX, `-no-shell-escape` on TeX Live),
  because posting text ends up in `.tex` files. Every run has a timeout (`tex.timeoutSeconds`, default
  120) and is killed with its process tree on expiry.
- **Search path:** the `.tex` file's folder plus `templates/resume/` and `templates/cover/` (via
  `TEXINPUTS`), so a tailored copy in a posting folder finds the template's class and style files.

## Compile (`compile`)
1. Resolve the path (must be a `.tex` under `postings/` or `templates/`), pick the engine (above). Builds of
   the same file run one after another: they share its `.build/` folder.
2. Build into `<dir>/.build/<name>/` (aux files stay out of the posting folder).
3. Parse the log into diagnostics (below).
4. On failure: `ok: false`, the diagnostics, and a hint: fix the first error; or the timeout; or the tail of
   the engine output when the log has nothing parsable.
5. On success: copy the PDF to `<dir>/<name>.pdf`, count pages, check the page limit, snapshot, and return
   `{ ok, engine, engineFrom, pdf, pages, pageLimit?, pageLimitExceeded?, overflow?, diagnostics, logPath, durationMs, snapshot }`.
   Failures also carry `engine` and `engineFrom`.

- **Page limit:** files whose name contains `resume` or `cv` are checked against `resume.pageLimit`
  (default 1); `maxPages` overrides it for any file. Over the limit, `overflow { lines, text }` holds the text of
  the pages past it (`pdfText`, first 400 characters) and its non-empty line count, and the hint says how
  many lines to cut. A live resume took five compiles to fit when the result said only "2 pages": three lines
  of skills had spilled over.
- **History:** each successful build copies the `.tex` and `.pdf` to `<dir>/.history/<timestamp>/`. The
  newest 30 snapshots are kept. "Go back to the previous version" restores from there.

## Review before attaching
How a finished document reaches an application is the **attach mode**, `documents.attach` in
`ezapply.config.json` (set by `attach_mode_set`, or on the onboarding page's preferences step):
- **`after-approval`** (default): Claude shows the documents in the browser and attaches only what the user
  approves there.
- **`immediately`**: attached as soon as it's built, without a review step.

The default is the reviewing one because what's attached goes to an employer; a user who trusts the loop can
switch.

**The review page** (`ReviewService`, `documents/review.ts`; the page itself is the UI package's,
[ui](ui.md#the-review-page-reviewid)). `review_documents { files }` takes 1–6 PDFs from one posting folder, reads
their bytes, and opens `http://127.0.0.1:<port>/review/<id>?t=<token>` through the `Opener`. Opening reads what
the page shows beside each document: its page count, page size, text layer and encryption (`pdfInfoOf` on the
bytes; a file that isn't a readable PDF has none), its text per page (`pdfText` on the bytes), and the version the
user last answered a review of, by its name in the posting folder (`reviewed.json`). The page shows each PDF in
pdf.js, takes comments on selected passages and a request for the whole document, and marks what changed since
the last review. The files are served from the bytes read when the review opened, so the user approves exactly
what they saw even if Claude rebuilds meanwhile. Answering records each document with no request and no comment as
approved, and returns the others with the user's request and comments (`{ page, quote, note }`: the agent gets the
quoted words, not where they sit on the page).

**What changed since the last review.** When a review is answered, each of its documents is recorded in
`postings/<id>/reviewed.json` ([format](../data-formats.md#postingsidreviewedjson)) with its hash, whether it was
approved, and its text per page. The next review of a document by the same name gets that as `previous`: the
same bytes ("unchanged since you approved it"), or the text to compare, which the page diffs word by word and
marks on the PDF ([how](ui.md#what-changed-since-the-last-review-changests-protocolsrctextdiffts)). The agent gets the
same changes from `pdf_text { path, sinceReviewed: true }`, to quote in its report after a revision instead of
describing it from memory. Approvals stay per version (the hash): the diff is a reading aid. *Why not latexdiff:*
it needs Perl and a LaTeX source, and the user approves the PDF; `tex_diff` stays for the agent.

**One call opens and waits.** `review_documents` blocks until the answer (or its timeout, default 10 minutes).
Claude Code moves an MCP call still running after 120 s to the background and delivers its result as a task
notification, so a long wait doesn't hold the chat. On a timeout, `review_documents { reviewId }` waits again;
an answer given while nothing waits is kept, and the next wait returns it at once. When no browser opened, the
call returns right away with the URL for Claude to give the user, since nobody would see the page otherwise.
*Why one tool:* opening and waiting used to be two tools (`review_open`, `review_wait`). In one
session the agent opened three reviews without waiting, and the user's change requests sat in
the companion until they asked why they'd been dropped. The skills now also say the page is a snapshot: after
any rebuild, review the changed files again.

Claude revises the documents with change requests, rebuilds, and reviews the changed ones again. A
newer review of the same posting replaces an open one (the old page says so), an answered page says so, and
a review expires after 2 hours, or when the chat ends; an open page hears each of these (Server-Sent Events). Every
URL needs the random token or the cookie it became, compared in constant time; wrong or missing tokens get a
404, and an answer from another origin a 403.

**Sending closes the tab.** There is no page after answering: the answer (`POST <review>/answer`, JSON) is
answered `204`, and the page closes its tab. A browser lets a script close a tab only while the tab's history
holds one page, which is the case for a tab the `Opener` opened on the review URL (taking the token off the
address bar replaces that entry, adding none). Where the browser still refuses (the user pasted the link into a
tab they'd used), the page says "Sent to Claude. You can close this tab." A 409 (the review was answered
meanwhile, or replaced) shows the page as it now is; a failed request (ezapply closed) says so and keeps what the
user wrote, which is also kept across a reload. The page's scripts come from the companion, none inline, and its
token becomes a cookie on the review's path ([ui](ui.md#how-a-page-talks-to-the-companion)). Closing the tab was
seen working in Chromium with the tab opened from the command line, as the `Opener` does; not yet tried in
Firefox, nor on this page.

**Approvals** go to `postings/<id>/approvals.json`: per document (path relative to the posting folder) the
SHA-256 of the approved bytes, when, and the review. `upload_file` in the `after-approval` mode refuses a file
from `postings/` unless its current bytes hash to an approval, so an edited or rebuilt document needs approving
again, and a bundle made from approved parts is reviewed as a document of its own. The user's own documents
in `library/` never need approval. `posting_active` reports the mode, each approval with `current` (still the
same bytes), and an open review.

**Only the page approves.** No tool approves a document, and a chat message saying "approved" doesn't: the
skills ask the user to press it on the page. So a prompt injection in a posting or a form can't approve
anything either.

## Log parsing (`tex/log.ts`)
`parseTexLog` turns a TeX log (file-line-error style, unwrapped lines) into up to 60 de-duplicated
diagnostics `{ severity, kind, message, file?, line? }`. Kinds: `error`, `missing-file`, `missing-font`,
`missing-glyph`, `overfull`, `underfull`, `undefined-reference`, `rerun`, `warning`. Skills treat overfull
boxes and missing glyphs as defects to fix.

## Diff (`tex_diff`)
`latexdiff --flatten old new` → `<new>-diff.tex` next to the new file, compiled (no page limit) to a
change-highlighted `<new>-diff.pdf`. Optional: without latexdiff it
fails with a hint.

## PDF toolkit (`pdf/toolkit.ts`)

| Function | Backend | Behaviour |
|---|---|---|
| `pdfRender(path, page, scale)` | pdf.js + `@napi-rs/canvas` | PNG of one page (scale 1 = 72 dpi); the tool also saves it under `.previews/` |
| `pdfText(source, pages?)` | pdf.js | Text per page in reading order, as an applicant-tracking system would see it. `source` is a path or bytes (a review's snapshot; copied, since pdf.js takes over the buffer it's given) |
| `pdfInfo(path)`, `pdfInfoOf(bytes, path)` | pdf-lib (+ pdf.js for the text-layer check) | Pages, bytes, page sizes, encryption, text layer present, title and author; `pdfInfoOf` for bytes in hand |
| `pdfMerge(inputs, output, opts)` | pdf-lib | Inputs in order with optional page ranges (`"1-2,4"`), a bookmark per input, page sizes normalized (`auto` = to the first page, `letter`, `a4`, `none`), title/author metadata. Returns `sections[] { label, source, firstPage, lastPage }` and `normalizedPages` |
| `pdfFromImages(images, output, pageSize)` | `@napi-rs/canvas` + pdf-lib | One image per page, centred with an 18 pt margin, never upscaled; landscape images get a landscape page |
| `pdfCompress(path, output, target?)` | pdf-lib, then Ghostscript if installed | Lossless re-save first; if still over target, Ghostscript downsampling presets. Reports before/after, method, whether the target was met |


**Normalizing page sizes** keeps each page's own content and annotations: the page is copied, its content
wrapped in a scale-and-translate that fits it centred on the target paper (turned to the page's own
orientation, honouring `/Rotate` and MediaBoxes that don't start at 0,0), its annotation coordinates
(`Rect`, `QuadPoints`, `Vertices`, `L`, `CL`, `InkList`; `RD` scaled only) moved the same way, and its
MediaBox set to the target (other boxes dropped). A page that already has the target size in either
orientation is left alone. It used to redraw such pages as form XObjects, which drops annotations, so a
Letter resume bundled after an A4 transcript lost its clickable LinkedIn and GitHub links.

`open_file` goes through the `Opener` (`util/open.ts`): a PDF, image or text file opens in the browser the
extension runs in, anything else (and everything when that browser isn't known or found) through
`explorer.exe` / `open` / `xdg-open`; started detached without a shell and not waited for, so a viewer it
launches is never killed by a timeout ([companion](companion.md#opening-pages-and-files-utilopents)).

Encrypted or unreadable PDFs fail with `bad_request` and a clear message rather than being skipped.
Outputs are written atomically; a target another program holds open (Acrobat locks the PDFs it shows) fails
with a hint to close it. When compressing misses the target and Ghostscript isn't installed, the hint carries
this OS's install command.
