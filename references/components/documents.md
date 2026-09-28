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
   `{ ok, engine, engineFrom, pdf, pages, pageLimit?, pageLimitExceeded?, diagnostics, logPath, durationMs, snapshot }`.
   Failures also carry `engine` and `engineFrom`.

- **Page limit:** files whose name contains `resume` or `cv` are checked against `resume.pageLimit`
  (default 1); `maxPages` overrides it for any file.
- **History:** each successful build copies the `.tex` and `.pdf` to `<dir>/.history/<timestamp>/`. The
  newest 30 snapshots are kept. "Go back to the previous version" restores from there.

## Review before attaching
How a finished document reaches an application is the **attach mode**, `documents.attach` in
`ezapply.config.json` (set by `attach_mode_set`; onboarding asks):
- **`after-approval`** (default): Claude shows the documents in the browser and attaches only what the user
  approves there.
- **`immediately`**: attached as soon as it's built, without a review step.

The default is the reviewing one because what's attached goes to an employer; a user who trusts the loop can
switch.

**The review page** (`ReviewService`, `documents/review.ts`). `review_open` takes 1–6 PDFs from one posting
folder, reads their bytes, and opens `http://127.0.0.1:<port>/review/<id>?t=<token>` through the `Opener`. The
page shows each PDF in the browser's own viewer (an iframe of `/review/<id>/file/<n>`, served as
`application/pdf`, inline, only to the same origin) with a box "What should change? Leave empty to approve
it as shown", and one submit button. The files are served from the bytes read at `review_open`, so the user
approves exactly what they saw even if Claude rebuilds meanwhile. Answering records each document with an
empty box as approved and returns the others with the user's words; `review_wait` blocks until then (or its
timeout). Claude revises the documents with change requests, rebuilds, and reviews the changed ones again. A
newer review of the same posting replaces an open one (the old page says so), an answered page says so, and
a review expires after 2 hours, or when the chat ends. Every URL needs the random
token, compared in constant time; wrong or missing tokens get a 404.

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
| `pdfText(path, pages?)` | pdf.js | Text per page in reading order, as an applicant-tracking system would see it |
| `pdfInfo(path)` | pdf-lib (+ pdf.js for the text-layer check) | Pages, bytes, page sizes, encryption, text layer present, title and author |
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
