---
name: resume
description: Tailor the user's one-page LaTeX resume to the active job posting, or revise the tailored version. Use when the user asks to tailor, adjust or update their resume for a job.
---

# Tailor the resume

## Setup
1. `posting_active`, then read `posting.md`. If the capture-time company or role is wrong, fix it with
   `posting_update_meta`.
2. Read `profile/profile.yaml`, `profile/preferences.md`, and the template (template main from
   `workspace_check` or `templates/resume/template.json`).
3. If `postings/<id>/resume.tex` does not exist, copy the template main file there (the class and style
   files are found automatically; don't copy them). Set status `drafting` via `posting_update_meta`.

## Analyze (write to `postings/<id>/notes.md`)
- Must-have and nice-to-have requirements, and the posting's key terms.
- **Evidence map:** for each requirement, the supporting `knowledge/*/claims.yaml` ids or profile entries.
  Mark requirements with no evidence as **gaps**. Gaps are never presented as skills the user has.
- Rank the knowledge-base projects by relevance to this posting.

## Edit `resume.tex`
- Keep the template's structure, macros and styling. Only change content.
- Reword existing bullets toward the posting's terms where the evidence supports it. Put the strongest,
  most relevant bullets first. Swap in better-matching projects from the knowledge base.
- Adjust the skills line to what the posting asks for **and** the evidence supports.
- Put a `% src: <claim-id or profile path>` comment on each changed or added bullet.
- Escape LaTeX specials in text taken from the posting.
- Numbers: use only numbers that appear in the evidence or profile.

## Build and check (loop until clean)
1. `tex_compile`. Fix errors first. Treat overfull boxes and missing glyphs as defects.
2. It must be **exactly one page**. On overflow, tighten wording, then drop the weakest bullet. Never
   shrink fonts, margins or spacing below the template's. If it's clearly under a page, consider adding
   the next strongest evidence-backed bullet.
3. `pdf_render` page 1 and look at it: alignment, orphaned lines, uneven sections.
4. `pdf_text`: headings intact, sensible reading order, key terms present as plain text.
5. **Self-check:** re-read every changed bullet next to its cited evidence. Fix anything overstated.

## Report
Give 3–6 lines: what changed and why, plus any gaps you did not claim. Include the PDF path and
`open_file` it the first time. For later tweaks, repeat the build-and-check loop and report in one or two
lines. When the user asks to see the changes, use `tex_diff` (template vs tailored).
