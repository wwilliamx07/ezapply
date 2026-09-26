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
  only remembers success. A TeX install mid-session is picked up without a restart.
- **No engine:** `not_found` with the install command for this OS (winget MiKTeX + package auto-install
  on Windows, `brew install --cask mactex-no-gui` on macOS, `texlive-xetex latexmk` on Linux).
- **Safety:** shell escape is always off (`--disable-write18` on MiKTeX, `-no-shell-escape` on TeX Live),
  because posting text ends up in `.tex` files. Every run has a timeout (`tex.timeoutSeconds`, default
  120) and is killed with its process tree on expiry.
- **Search path:** the `.tex` file's folder plus `templates/resume/` and `templates/cover/` (via
  `TEXINPUTS`), so a tailored copy in a posting folder finds the template's class and style files.

## Compile (`compile`)
1. Resolve the path (must be a `.tex` under `postings/` or `templates/`), pick the engine (above).
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
| `pdfMerge(inputs, output, opts)` | pdf-lib | Inputs in order with optional page ranges (`"1-2,4"`), a bookmark per input, page sizes normalized (`auto` = to the first page, `letter`, `a4`, `none`), title/author metadata. Returns `sections[] { label, source, firstPage, lastPage }` |
| `pdfFromImages(images, output, pageSize)` | `@napi-rs/canvas` + pdf-lib | One image per page, centred with an 18 pt margin, never upscaled; landscape images get a landscape page |
| `pdfCompress(path, output, target?)` | pdf-lib, then Ghostscript if installed | Lossless re-save first; if still over target, Ghostscript downsampling presets. Reports before/after, method, whether the target was met |
| `openInDefaultApp(path)` | OS | `explorer.exe` (no shell parses the path) / `open` / `xdg-open` |

Encrypted or unreadable PDFs fail with `bad_request` and a clear message rather than being skipped.
Outputs are written atomically.
