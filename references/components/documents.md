# Documents (`companion/src/documents/`)

Compiling LaTeX, checking the result, and handling PDFs. `DocumentsService` holds the logic; the
`documents` tool group ([mcp-tools.md](../mcp-tools.md#documents)) is a thin layer over it.

## Where each operation may read and write

| Operation | Allowed folders (workspace-relative) |
|---|---|
| TeX source (`tex_compile`, `tex_edit`, `tex_diff`) | `postings/`, `templates/` |
| Read PDFs (`pdf_text`, `pdf_info`, merge inputs) | `postings/`, `templates/`, `library/` |
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
  an `ezapply` started before MiKTeX was installed would otherwise keep treating it as unknown and pass the TeX
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
5. On success: copy the PDF to `<dir>/<name>.pdf`, count pages, check the page limit, lint the layout, snapshot,
   and return
   `{ ok, engine, engineFrom, pdf, pages, pageLimit?, pageLimitExceeded?, overflow?, lint?, freeLines?, diagnostics, logPath, durationMs, snapshot, hint? }`.
   Failures also carry `engine` and `engineFrom`.

- **Page limit** (`page-limit.ts`, shared with the review): files whose name contains `resume` or `cv` are
  checked against `resume.pageLimit` (default 1), and files whose name contains `cover` or `letter` against one
  page; `maxPages` overrides it for any file. *Why a letter has a limit:* without one, nothing measured its free space, and agents left letters
  well short of the page (the skill asks for a full one). Over the limit, `overflow { lines, text }` holds the text of
  the pages past it (`pdfText`, first 400 characters) and its non-empty line count, and the hint says how
  many lines to cut. A live resume took five compiles to fit when the result said only "2 pages": three lines
  of skills had spilled over.
- **Layout lint** (`pdf/lint.ts`): within the page limit, `lint[]` lists layout problems found from where the
  text sits on the page (`pdfLines`), each `{ kind, page, text, message }`, at most 8, and the hint points to
  them. Over the limit there's no lint: the cuts come first and move every line. A PDF the lint can't read
  gives no issues, never a failed build.
  - `short-line`: the last line of a wrapped bullet or paragraph holds one or two words (and under a fifth of
    the text width). A wrapped line follows a line reaching at least 80% of the text width, within 1.45 line
    heights, in the same size, without a list marker (`•`, `–`, `*` …), and the line before doesn't end a
    sentence. Three or four words aren't flagged: run on a live tailored resume, a fifth-of-the-width rule
    flagged four bullets ending in three or four words, common in a full resume, and each fix costs a compile.
  - `ragged-right`: a right-aligned entry (the span after a gap of over 1.5 em, ending in the right quarter:
    dates, places) ends more than 1.5 pt from the edge most such entries share.
  - `underfilled`: at the page limit, `freeLines` (below) is 3 or more. Room for the next strongest bullet.
    One or two free lines aren't flagged: chasing them costs a compile each, and `freeLines` already says so.
    With it, the hint is about the free space alone (how many lines, to fill with evidence before the rest of
    the lint, and that the review will refuse it) rather than "N layout issues". *Why:* given only the count,
    an agent fixed a short line in an underfilled letter by cutting words, leaving more of the page empty.
  - `off-page`: a line runs past the page's edge.

  Overfull and underfull lines come from the log (diagnostics), not the lint. *Why a lint and not an image of
  the page:* tailoring changes only the text inside a template the user approved, so what goes wrong is
  mechanical. A rendered page image costs about 2.5k tokens of context, re-sent on every later turn of the
  session, two per tailoring, to find what these checks name exactly. Changes to a
  template's look are the user's to ask for.
- **Content findings** (`content-lint.ts`, added to `lint` by `tex_compile` and `tex_edit`, with a sentence in
  the hint): what a program can check in a posting's `resume.tex` or `cover.tex` and the content files its
  template copied, under the skills' own rules, which the agent is told and still slips on. Only lines the
  tailoring changed are checked, a changed line being one not in the template's copy of that file: the template is
  the user's own wording. Each finding is `{ kind, file, line, text }`:
  - `unsourced-number`: a number (thousands separators and leading zeros aside) in no claim, the profile, the
    posting or the template;
  - `missing-src`: a resume bullet (a line starting with an `…item` command) with no `% src:` on it or on the
    comment line just above or below. A cover letter's paragraphs aren't required to carry one;
  - `unknown-src`: a `% src:` id that is neither a claim id nor a path the profile holds (`work.0.highlights.1`,
    `work[0]`, with or without `profile.`);
  - `never-mention`: a term from `preferences.md`'s "Never mention" (one per line or comma-separated, five words
    at most), matched as a word;
  - `unbacked-skill`: on the resume, an entry of a labelled list of three or more short items (`Languages:
    Python, Go, Rust`) that no claim or the profile names; the posting asking for a skill is no evidence of it.

  *Why the changed lines only, and these rules:* the skills said the same ("only numbers in the evidence", a src
  per bullet) and nothing checked them. Polarity, attestations and the evidence map aren't checked: a pattern
  would be wrong too often.
- **Free lines** (`freeLines` in `pdf/lint.ts`): within the limit, how many more lines fit below the last page's
  lowest line, with the bottom margin taken as equal to the space above the highest line and a line as the
  page's median line spacing. Returned on every build within its limit, so "one more line fits" is known
  rather than guessed; the skills aim for 0–2 ([workspace](workspace.md#the-agent-file-ezapplymd)).
- **History:** each successful build copies the `.tex` and `.pdf` to `<dir>/.history/<timestamp>/`, and
  `pdf_merge` its output the same way. The newest 30 snapshots per folder are kept. "Go back to the previous version" restores from there.

## Review before attaching
How a finished document reaches an application is the **attach mode**, `documents.attach` in
`ezapply.config.json` (set by `attach_mode_set`, or on the onboarding page's preferences step):
- **`after-approval`** (default): Claude shows the documents in the browser and attaches only what the user
  approves there.
- **`immediately`**: attached as soon as it's built, without a review step.

The default is the reviewing one because what's attached goes to an employer; a user who trusts the loop can
switch.

**The review page** (`ReviewService`, `documents/review.ts`; the page itself is the UI package's,
[ui](ui.md#the-review-page-reviewid)). `review_documents { files }` takes 1–6 PDFs from one posting folder
(anything else is `bad_request`), reads their bytes, and opens `http://127.0.0.1:<port>/review/<id>?t=<token>` through the `Opener`. Opening reads what
the page shows beside each document: its page count, page size, text layer and encryption (`pdfInfoOf` on the
bytes; a file that isn't a readable PDF has none), its text per page (`pdfText` on the bytes), and the version the
user last answered a review of, by its name in the posting folder (`reviewed.json`). The page shows each PDF in
pdf.js, takes comments on selected passages and a request for the whole document, and marks what changed since
the last review. Each document is approved on its own (its Approve Document button) or sent back with changes;
nothing is approved by default, and the answer goes only once every document is one or the other (the button on
the last one left sends it). The files are served from the bytes read when the review opened, so the user approves exactly
what they saw even if Claude rebuilds meanwhile. Answering records each document with no request and no comment as
approved, and returns the others with the user's request and comments (`{ page, quote, note }`: the agent gets the
quoted words, not where they sit on the page).

**A document with missing or unknown sources isn't reviewed** (`checkSources`, before the review opens, from
`review_documents` and the review that opens itself): a `missing-src` or `unknown-src` finding in its `.tex` is
`bad_request` naming each file and line. A source the user can't check is no source.

**An underfilled document isn't reviewed** (`checkFilled`). A resume or cover letter (by name, as for the page
limit) at its page limit whose last page has 3 or more free lines is `bad_request`, naming each file and its free
lines, unless `short: [{ file, reason }]` names it. The reason is for a document meant to be shorter: a length
the posting or `format.md` sets, the user's preferences or words, or evidence that ran out. It's logged, not shown
on the page or stored. A PDF without readable text, or one not at its limit, isn't checked (pdf.js can wait
forever on bytes that aren't a PDF, so only what `pdfInfoOf` read with a text layer is measured). *Why a refusal:*
with the lint and `freeLines` in the compile result, agents still sent letters with a third of the page empty
to review, and the user had to ask for more; review is the step they can't skip. *Why a reason and not a hard
stop:* a shorter letter is sometimes right, and padding one to fill the page breaks "no fabrication"; the reason
makes the agent check it has one. *Why not on the page:* the user judges the letter itself.

**An approved document isn't reviewed again without a reason** (`checkApproved`). A document whose current bytes
match its approval is `bad_request`, naming each one and saying `upload_file` attaches it as it is, unless
`again: [{ file, reason }]` names it with what the user asked: to see it again, or to change it before it's
rebuilt. Like `short`'s, the reason is logged, not shown on the page or stored; a rebuilt document has new bytes
and needs none. *Why:* a fill started while the tailoring's review was still open read the approvals before the
user answered, then opened a second review of the same bytes instead of uploading; the user had to approve twice.
*Why a reason and not a hard stop:* the user may ask to look again, or to revise an approved document.

**What changed since the last review.** When a review is answered, each of its documents is recorded in
`postings/<id>/reviewed.json` ([format](../data-formats.md#postingsidreviewedjson-companionsrcdocumentsreviewts)) with its hash, whether it was
approved, and its text per page. The next review of a document by the same name gets that as `previous`: the
same bytes ("unchanged since you approved it"), or the text to compare, which the page diffs word by word and
marks on the PDF ([how](ui.md#what-changed-since-the-last-review-changests-protocolsrctextdiffts)). The agent gets the
same changes from `pdf_text { path, sinceReviewed: true }`, to quote in its report after a revision instead of
describing it from memory. Approvals stay per version (the hash): the diff is a reading aid. *Why not latexdiff:*
it needs Perl and a LaTeX source, and the user approves the PDF; `tex_diff` stays for the agent.

**One call opens, and the answer always reaches the agent.** In a panel conversation `review_documents` returns
at once with `pending`, the agent ends its turn, and the answer (or the review expiring) comes as the
conversation's next message ([results as messages](agent.md#results-as-messages)). In a terminal chat it blocks
until the answer (or its timeout, default 10 minutes); Claude Code moves an MCP call still running after 120 s to
the background and delivers its result as a task notification, so a long wait doesn't hold the chat. On a
timeout, `review_documents { reviewId }` waits again; an answer given while nothing waits is kept, and the next
wait returns it at once. When no browser opened, the call returns right away with the URL for Claude to give the
user, since nobody would see the page otherwise. *Why one tool:* with a separate call to wait, an agent opened
three reviews without waiting, and the user's change requests sat in the companion until they asked why they'd
been dropped. The skills also say the page is a
snapshot: after any rebuild, review the changed files again.

**The review opens itself at the end of a tailoring turn** (`reviewAtTurnEnd`, `documents/agent-review.ts`, called
by the panel's turn-end handler before its notification). When a posting's Documents conversation ends a turn
without error, in `after-approval`, with no card of that conversation open and no review of that posting open, the
posting's top-level PDFs that are drafts (neither approved nor last reviewed in their current bytes, and not
`*-diff.pdf`) go to review together, as `review_documents { files }` from that conversation would open them, and the
answer comes as its next message. A PDF older than its `.tex` is left out: its last build failed, so it isn't what
the agent last wrote. A refusal (an underfilled document) goes to the conversation as a delivered result with the
refusal's hint, once for the same files and reason, so the agent adds evidence or calls `review_documents` with
`short`. *Why:* the skills told the agent to review each finished document, and turns still ended without it; the
end of the turn is the step it can't skip. *Why not a failed build or over-limit document held back further:* the
page shows the page count, and holding documents back is the failure this replaces. `review_documents` stays for
`short`, `again`, a terminal chat, and the filling conversation, where `upload_file` refuses an unapproved document
and points to it.

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
seen working in Chromium with the tab opened from the command line, as the `Opener` does; not yet tried on this
page.

**Approvals** go to `postings/<id>/approvals.json`: per document (path relative to the posting folder) the
SHA-256 of the approved bytes, when, and the review. `upload_file` in the `after-approval` mode refuses a file
from `postings/` unless its current bytes hash to an approval, so an edited or rebuilt document needs approving
again, and a bundle made from approved parts is reviewed as a document of its own. The user's own documents
in `library/` never need approval. `posting_get` reports the mode, each approval with `current` (still the
same bytes), and an open review.

**Only the page approves.** No tool approves a document, and a chat message saying "approved" doesn't: the
skills ask the user to press it on the page. So a prompt injection in a posting or a form can't approve
anything either.

## Editing (`tex_edit`)
`DocumentsService.edit` applies exact replacements in order, each `old` matched once in the text the edits before it
leave, then compiles. Edits are written in the file's line endings, so one written with `\n` matches a file saved
with `\r\n`. Anything wrong (an `old` missing or found twice, one equal to its `new`) refuses the whole call before
anything is written, naming the edit. The result carries each edited passage with a line on each side, so the
agent checks it against its neighbours without reading the file again. *Why a tool:* with Python at hand, agents
edited `.tex` through scripts that dropped or mangled LaTeX's backslashes (`"\t"` in `"\textbf"` becomes a tab),
and each agent's own edit tool is named and shaped differently; JSON arguments carry backslashes as they are, and
the compile in the same call saves a turn per round.

## Starting a document and the bundle (`tailor.ts`)
**`document_start`** (`startDocument`) does a document's fixed setup and returns its brief. It copies the template's
main file and its `contentFiles` into the posting folder (the folder comes first on TeX's search path, so the
copies are built) only when the document isn't there yet, so a revision keeps its edits, and moves the status
from `captured` to `drafting`. The brief is the posting's `posting.md`, its `notes.md` (saying when it has no
`## Application requirements` yet, which the agent writes first), `profile.yaml` without its EEO answers, every
claim as `claims_list` gives them, and the cover letter's `format.md`. `preferences.md` isn't in it: `EZAPPLY.md`
imports it into every session. *Why:* the skills began with five to seven reads and copies, the same every time,
each a turn that re-sent the conversation; the evidence map and everything after stay the agent's.

**`bundle_build`** (`buildBundle`) does the bundle's fixed steps: default order
(cover letter, resume, extras), a rebuild of a `.tex` newer than its PDF, a bookmark label per section ("Cover
Letter", "Resume", an extra's from its file name), the title and author from the profile and the posting, the file
name `<Last>_<First>_<Company>_Application.pdf` (each word reduced to letters, digits and hyphens), the checks
(one page size, a one-page resume) and compression to the limit. It sets `bundleRequired`. Deciding that a
bundle is needed, the posting's own order and which `library/` files go in stay the agent's; scans go through
`pdf_from_images` first, and the bundle is reviewed as a new document.

## Log parsing (`tex/log.ts`)
`parseTexLog` turns a TeX log (file-line-error style, unwrapped lines) into up to 60 de-duplicated
diagnostics `{ severity, kind, message, file?, line? }`, errors first. Kinds: `error`, `missing-file`, `missing-font`,
`missing-glyph`, `overfull`, `underfull`, `undefined-reference`, `rerun`, `warning`. Skills treat overfull
boxes and missing glyphs as defects to fix.

## Diff (`tex_diff`)
`latexdiff --flatten old new` → `<new>-diff.tex` next to the new file, compiled like any `.tex` (with a page
limit of 99, so it's never over) to a change-highlighted `<new>-diff.pdf`. Optional: without latexdiff it fails
with `not_found` and a hint.

## PDF toolkit (`pdf/toolkit.ts`)

| Function | Backend | Behaviour |
|---|---|---|
| `pdfLines(source)` | pdf.js | Per page: its size and its lines top to bottom, each with baseline `y`, `x0`/`x1`, font `size`, `text` and `spans` (runs a gap over 1.5 em separates, as an `\hfill` does). Items on one baseline (within a third of the font size) make a line; rotated text is left out. For the layout lint |
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
orientation is left alone. The page isn't redrawn as a form XObject: that drops annotations, and a Letter resume
bundled after an A4 transcript lost its clickable LinkedIn and GitHub links that way.

`open_file` goes through the `Opener` (`util/open.ts`): a PDF, image or text file opens in the browser the
extension runs in, anything else (and everything when that browser isn't known or found) through
`explorer.exe` / `open` / `xdg-open`; started detached without a shell and not waited for, so a viewer it
launches is never killed by a timeout ([companion](companion.md#opening-pages-and-files-utilopents)).

An encrypted or unreadable PDF given to merge or compress fails with `bad_request` and a clear message rather
than being skipped (`pdf_info` reports `encrypted` instead); a bad page range is `bad_request` too
(`pdf/pages.ts`).
Outputs are written atomically; a PDF a viewer holds open (Acrobat locks the PDFs it shows) fails, after a short
retry, with a hint to close it ([atomic writes](../architecture.md#cross-cutting-concerns)). When compressing misses the target and Ghostscript isn't installed, the hint carries
this OS's install command.
