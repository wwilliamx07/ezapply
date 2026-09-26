# Profile, answer bank and templates (`companion/src/profile/`)

`ProfileService` reads, validates and writes the user's own data in `profile/` and `templates/`. YAML files
are parsed with line-aware errors, so `profile_check` / `answers_check` report problems with field paths.
Exact schemas: [data-formats.md](../data-formats.md).

## Profile (`profile/profile.yaml`)
Everything forms ask that isn't a screening question: identity, contact (email, phone, address), links,
work authorization, job preferences, work history (`YYYY-MM`, `end: null` for current), education,
skills, languages, certifications, and optional EEO self-identification.

- Written by Claude during onboarding from the user's resume, then completed in chat.
- `profile_check` validates it and lists commonly needed fields still missing: phone, region, postal code,
  work-authorization countries, sponsorship now and in future, some work or education, LinkedIn.
- EEO values are only ever filled verbatim from here; `"decline"` means choose the form's decline option;
  missing means ask each time.
- Workday field hints (`hint.profileKey`) point into this file by path, e.g. `identity.firstName`.

## Answer bank (`profile/answers.yaml`)
Stored answers to screening questions.

- **Seeded** on first daemon start with 33 common Workday questions (work authorization, sponsorship,
  export control, previous employment, relatives, referrals, government relationships, conflicts of
  interest, consents, relocation, travel, start date, salary, degree, criminal history…), all unanswered,
  some with a `suggested` default or a `source` in the profile.
- Entry: `id`, `canonical` question, `answer` (a string; `null` = always ask; or
  `{ default, byCompany }`), `suggested` (never used on a form until confirmed), `source`, `sensitive`
  (always ask even when answered), `variants` (other wordings seen), `notes`.
- `answers_check` validates it (unique ids) and lists unanswered entries. The checklist counts the bank as
  done when only sensitive questions are unanswered.
- Answers learned while filling forms are offered for saving; new wordings go into `variants`.

## Preferences (`profile/preferences.md`)
Free text: tone for cover letters, what to emphasize, what never to mention, target roles and locations,
whether to write cover letters by default. Done at 10+ words.

## Repo selection (`profile/repos.yaml`)
`repos[] { fullName, source: "app" | "public-url", note? }`, written by `repos_selection_set`. See
[github-and-repos.md](github-and-repos.md).

## Templates (`templates/resume/`, `templates/cover/`)
Each folder holds a LaTeX project and `template.json` naming its main file
(`{ schemaVersion, main, origin?, example?, importedFrom?, importedAt? }`). Tailored documents are copies in
the posting folder; the templates themselves are never edited while tailoring. Their folders are on the
TeX search path, so the copies find class and style files.

### Importing a LaTeX template (`template_import`)
- Source: an absolute folder outside the workspace. Build artifacts (`.aux`, `.log`, `.synctex.gz`…) and
  `.git`, `node_modules`, `__MACOSX` and ezapply's own `.build`/`.history`/`.previews` are skipped. Limits:
  400 files, 60 MB.
- **Main file detection:** the `.tex` files that contain both `\documentclass` and `\begin{document}`; if
  several, a top-level file named like resume/cv/cover/letter/main wins; if still ambiguous, the error lists
  candidates and Claude asks.
- An existing template is moved to `templates/.old/<kind>-<timestamp>/`, never overwritten. Replacing one
  the user has needs `replace: true` (Claude confirms first); replacing ezapply's untouched default doesn't.
- Records `origin: "imported"` and where it came from.
- **Engine:** if the imported main file has no `% !TEX program` comment but uses pdfTeX-only commands
  (`\pdfgentounicode`, `\pdfglyphtounicode`, `\input{glyphtounicode}`) and no `fontspec`/`\setmainfont`,
  `% !TEX program = pdflatex` is added as its first line in the workspace copy (the user's original is
  untouched), so it and every tailored copy build with pdflatex whatever `tex.engine` says. The result's
  `texProgram` is `{ engine, added: true, note }`, or `{ engine, added: false }` when the file already
  names one; absent otherwise. See [documents](documents.md#tex-engines-texenginests).
- Returns `{ folder, main, files, previous?, texProgram? }`.

### The default cover letter
`packages/cli/templates/cover/` ships `cover.tex` (XeLaTeX, US Letter, 11 pt, 1 in margins, Latin Modern
via fontspec) and `template.json` with `origin: "default"`. `ezapply init` copies it into
`templates/cover/` only when that folder is empty. It has:
- identity fields `\myname`, `\mycontact`, filled once from the profile;
- per-letter fields `\letterdate`, `\addressee`, `\company`, `\role`;
- a name header, contact line, date, addressee block, `Re:` line, salutation, the body between
  `% BODY START` and `% BODY END`, and a sign-off.

### Cover letter from an example (`template_import_example`)
The user gives a sample letter whose **format** they like:
1. The tool copies it into `templates/cover/example/` (a previous example moves to `templates/.old/`) and
   records `example` in `template.json`. Accepted: PDF, PNG/JPG/WebP, TXT, MD, up to 20 MB. Word and other
   formats are refused with a hint to export a PDF.
2. Claude reads it (`pdf_render` + `pdf_text`, or directly for images and text), reworks `cover.tex` to
   reproduce its layout (margins, font, header, date and addressee block, subject line, salutation,
   spacing, sign-off) while keeping the fields and body markers, and writes `templates/cover/format.md`
   describing the structure every letter should follow (paragraphs, salutation, sign-off, length).
3. `template_set_main` then marks the template `origin: "custom"` (a reworked default stops being
   replaceable without confirmation). Compile, render next to the example, and ask the user to approve.

Only the example's format carries over, never its sentences, claims or voice.

### `template_set_main`
Records the entry point after Claude creates or reworks a template. It keeps `imported` as is and marks
anything else `custom`.

## Library (`library/`)
User-supplied documents (transcripts, certificates, writing samples) for bundles and uploads. Listed by
`workspace_check`; readable by the PDF tools and `upload_file`.
