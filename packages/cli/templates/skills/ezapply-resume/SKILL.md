---
name: ezapply-resume
description: Tailor the user's resume to a job posting, or revise the tailored one.
---

# Tailor the resume

1. **Start.** `document_start { kind: "resume" }` sets up `resume.tex` (and its content files, where the bullets
   live) and returns the posting, `notes.md`, the profile and every claim. If the capture's company or role is
   wrong, fix it (`posting_update_meta`; a requisition id goes in `reqId`). With `requirementsMissing`, write
   `## Application requirements` first (EZAPPLY.md): a required format, page limit or single PDF changes what you
   make.
2. **Evidence map** (in `notes.md`): the must-have and nice-to-have requirements and the posting's key terms; for
   each requirement, the claim ids or profile entries that back it. One with no evidence is a **gap**: never
   presented as a skill the user has. Rank the projects by relevance.
3. **Edit the content**, never the template's structure, macros or styling:
   - Reword bullets toward the posting's terms where the evidence supports it; strongest and most relevant
     first; swap in better-matching projects.
   - The skills line: what the posting asks for **and** the evidence supports.
   - A `% src: <claim id or profile path>` comment on each changed or added bullet. Numbers only from the
     evidence. Escape LaTeX specials (`& % $ # _ { } ~ ^ \`) in text from the posting.
   - Edit with `tex_edit { path, edits }`: every change of a round in one call, each `old` copied from the
     `.tex` as it is (never from `pdf_text` or `lint`). It compiles and returns each changed passage with its
     neighbours: fix what doesn't fit them (a repeated word or claim, a broken sentence) in the next round.
   - Keep the template's `% !TEX program` line.
4. **Fit the page** (exactly one, unless the requirements say otherwise), from the build's findings:
   - Over: `overflow` says how many lines spilled. Cut about that much in one round: tighten wording first, then
     drop the weakest bullet. Never shrink fonts, margins or spacing.
   - Under: `freeLines` 3 or more is room for the next strongest evidence-backed bullet; 1–2, a line more on a
     bullet that wraps short.
   - Then the rest of `lint`: a word or two alone on a line, a date out of line, and the content findings
     (a number or skill without evidence, a missing or unknown `% src`, a never-mention term).
5. **Self-check:** each changed bullet next to its cited evidence; fix anything overstated. `pdf_text` once:
   headings intact and the key terms there as plain text.
6. **Report** in 3–6 lines: what changed and why, the gaps you didn't claim. Then end your turn: the review opens
   by itself in the after-approval mode. Call `review_documents` yourself only for a document meant to be shorter
   than the page (`short`, with the reason: the evidence ran out, or the user asked), one already approved
   (`again`), or outside the panel.

**Changes the user asks for** (on the review page or in chat): make them, rebuild, and report in a line or two from
`pdf_text { path, sinceReviewed: true }`. `tex_diff { oldPath, newPath }` (template vs tailored) only when they ask to see the changes.
