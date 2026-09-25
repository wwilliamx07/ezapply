---
name: cover-letter
description: Write or revise a cover letter for the active job posting using the user's cover letter template, profile, preferences and project knowledge. Use when the user asks for a cover letter or changes to one.
---

# Cover letter

## Inputs
- `posting_active` → `posting.md`. Note the company, the role, and what the team or product actually does.
- `profile/preferences.md` for tone, emphasis and things never to mention. `profile/profile.yaml`.
- `postings/<id>/notes.md` if the resume skill already produced the evidence map. Otherwise do a quick
  version: the top requirements and the matching claims from `knowledge/*/claims.yaml`.
- Template: `templates/cover/` main file. If no template exists, run the cover template step of the
  **onboard** skill first.

## Write `postings/<id>/cover.tex`
Copy the template main file, fill its placeholders (company, role, date, addressee if the posting names
one), and write the body:
1. **Opening (2–3 sentences):** the specific role and a concrete, true reason this company or team
   interests the user, drawn from the posting. No clichés ("I am writing to express…", "passionate").
2. **Two evidence paragraphs:** each ties one or two requirements to a specific project or role, citing
   what the user built and how, from claims or profile. Mirror the posting's language only where true.
3. **Close (1–2 sentences):** what they'd bring, and availability to talk.

Constraints:
- One page and roughly 250–380 words.
- No skills or results without evidence. Never mention gaps apologetically.
- Put a `% src:` comment beside each paragraph listing the claim ids used.
- Escape LaTeX specials in anything taken from the posting.

## Build and check
`tex_compile` (must be one page) → `pdf_render` → read it once as the hiring manager would. Cut filler and
repeated claims. `open_file` the first time.

## Report and iterate
Reply with a 2–3 line summary of the angle taken, plus the path. Handle tweaks ("more concise", "mention
X") by editing, recompiling and reporting in one line. Every build is saved in `.history/`, so earlier
versions can be restored on request.
