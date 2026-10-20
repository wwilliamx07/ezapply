---
name: ezapply-resume
description: Tailor the user's one-page LaTeX resume to a job posting, or revise the tailored version. Use when the user asks to tailor, adjust or update their resume for a job.
---

# Tailor the resume

## Setup
1. `posting_get`, then read `posting.md`. If the capture-time company or role is wrong, fix it with
   `posting_update_meta`; a requisition or job id the posting shows goes in `reqId` (never in the company or
   role). If `notes.md` has no `## Application requirements`, write it now (see EZAPPLY.md)
   and follow it: a required format, page limit or single PDF changes what you produce.
2. Read `profile/profile.yaml`, every claim (`claims_list`, if not already called in this session), and the
   template (template main from `workspace_check` or `templates/resume/template.json`).
3. If `postings/<id>/resume.tex` does not exist, copy the template main file there. If `template.json`
   lists `contentFiles` (files the main file `\input`s, e.g. `sections/experience.tex`), copy each to the same
   path relative to `resume.tex`: the posting folder comes first on TeX's search path, so the copies are
   the ones used, and they're where the bullets live. The class and style files are found automatically;
   don't copy them. Set status `drafting` via `posting_update_meta`.

## Analyze (write to `postings/<id>/notes.md`)
- Must-have and nice-to-have requirements, and the posting's key terms.
- **Evidence map:** for each requirement, the supporting `knowledge/*/claims.yaml` ids or profile entries.
  Mark requirements with no evidence as **gaps**. Gaps are never presented as skills the user has.
- Rank the knowledge-base projects by relevance to this posting.

## Edit `resume.tex` (and its copied content files)
- Keep the template's structure, macros and styling. Only change content.
- Reword existing bullets toward the posting's terms where the evidence supports it. Put the strongest,
  most relevant bullets first. Swap in better-matching projects from the knowledge base.
- Adjust the skills line to what the posting asks for **and** the evidence supports.
- Put a `% src: <claim-id or profile path>` comment on each changed or added bullet.
- Escape LaTeX specials (`& % $ # _ { } ~ ^ \`) in text taken from the posting.
- Numbers: use only numbers that appear in the evidence or profile.

## Editing `.tex` files
- **Use the Edit tool**, never a script (`python`, `sed`, PowerShell `-replace`): files can have Windows line
  endings, and scripted edits miss LaTeX's backslashes or corrupt them (`"\t"` in `"\textbf"` becomes a tab). To
  drop a block, Edit it out whole.
- Copy each `old_string` from the source as you last read it, never from `pdf_text`, `lint` or `overflow` (the
  PDF drops escapes and spacing). Make each change in one edit: never write an edit whose `old_string` is what
  another edit will produce. An edit whose new text equals the old is a change you meant to make and didn't.
- **One message per round:** all of the round's Edits, then `tex_compile` in the same message (it runs after
  them). Then reread the changed passages with the bullet on each side (`Read` with `offset`/`limit`, or `Grep -C 2`
  for the new words), not the whole file, and fix what doesn't fit its neighbours (repeated words or claims, a
  broken sentence) in the next round with the compile's findings.
- Keep the template's `% !TEX program` line: don't switch engines to fit the page (fonts and metrics differ).

## Build and check (loop until clean)
1. `tex_compile { path }`. Fix the first error first. Treat overfull boxes and missing glyphs as defects. Check
   layout with `lint`, never with page images (they cost more context than the findings).
2. It must be **exactly one page**. On overflow, `overflow` says how many lines spilled over and which:
   cut about that much in one pass, tightening wording first, then dropping the weakest bullet. Never
   shrink fonts, margins or spacing below the template's.
3. Within the page, fix what `lint` lists: a word or two alone on a bullet's last line (cut a few words, or
   say a little more), a right-aligned date out of line. `freeLines` says how much room is left: at 3 or more
   (`underfilled`), add the next strongest evidence-backed bullet or lengthen a strong one by about that many
   lines; at 1–2, a line or two more on a bullet that wraps short. `review_documents` refuses a resume left
   underfilled; pass `short: [{ file, reason }]` only when the evidence has run out (say what's left out) or the
   user asked for it.
4. `pdf_text { path, pages? }`: headings intact, sensible reading order, key terms present as plain text.
5. **Self-check:** re-read every changed bullet next to its cited evidence. Fix anything overstated.

## Report
Give 3–6 lines: what changed and why, plus any gaps you did not claim, and the PDF path. Then follow the
attach mode (`posting_get` → `documents.attachMode`):
- `after-approval` (the default): `review_documents { files }` it (with the cover letter if that's ready too)
  after your report. Each change the user asks for there is a tweak: make it, rebuild, report what changed from
  `pdf_text { path, sinceReviewed: true }`, and review again.
- `immediately`: it's ready to attach; `open_file { path }` only when asked.

Attaching needs the application open at the step with the file field: otherwise say it's ready, and it's attached
when the form is filled. For tweaks from chat, repeat the build-and-check loop, report in one or two lines, and
review again in `after-approval`. When the user asks to see the changes, use `tex_diff { oldPath, newPath }`
(template vs tailored).
