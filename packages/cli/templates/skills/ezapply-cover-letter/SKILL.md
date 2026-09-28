---
name: ezapply-cover-letter
description: Write or revise a cover letter for the active job posting using the user's cover letter template, profile, preferences and project knowledge. Use when the user asks for a cover letter or changes to one.
---

# Cover letter

## Inputs
- `posting_active` → `posting.md`. Note the company, the role, and what the team or product actually does.
- `## Application requirements` in `postings/<id>/notes.md` (write it first if missing, see EZAPPLY.md):
  word or page limits, who to address, reference numbers, questions the letter must answer, whether a
  letter is wanted at all.
- `profile/preferences.md` for tone, emphasis and things never to mention. `profile/profile.yaml`.
- `postings/<id>/notes.md` if the **ezapply-resume** skill already produced the evidence map. Otherwise do a quick
  version: the top requirements and the matching claims, from the claims (`claims_list`, if not
  already called in this session).
- Template: `templates/cover/` main file (`template.json` names it). If there is none, ask the user to run
  `ezapply init`, which installs the default.
- `templates/cover/format.md` if it exists: the structure taken from the user's example letter.

## Write `postings/<id>/cover.tex`
Copy the template main file (and any `contentFiles` from `template.json`, at the same relative paths), fill
its placeholders (company, role, date, addressee if the posting names one), and write the body (between the `% BODY START` / `% BODY END` markers when the template has them):
1. **Opening (2–3 sentences):** the specific role and a concrete, true reason this company or team
   interests the user, drawn from the posting. No clichés ("I am writing to express…", "passionate").
2. **Two evidence paragraphs:** each ties one or two requirements to a specific project or role, citing
   what the user built and how, from claims or profile. Mirror the posting's language only where true.
3. **Close (1–2 sentences):** what they'd bring, and availability to talk.

If `format.md` exists, follow its structure (paragraph count, salutation, sign-off, subject line, length)
instead of the defaults above. The evidence rules below still apply.

Constraints:
- One page and roughly 250–380 words, unless `format.md` sets another length.
- No skills or results without evidence. Never mention gaps apologetically.
- Put a `% src:` comment beside each paragraph listing the claim ids used.
- Escape LaTeX specials in anything taken from the posting.

## Build and check
`tex_compile` (must be one page) → `pdf_render` → read it once as the hiring manager would. Cut filler and
repeated claims.

## Build from an example
When the user gives a sample letter whose format they like:
1. `template_import_example` with its absolute path. Word files: ask for a PDF export first.
2. Look at it: `pdf_render` and `pdf_text` for a PDF, or read the image or text file directly.
3. Rework `templates/cover/cover.tex` to reproduce its **format**: page size and margins, font family
   and size (the closest available), header layout and contact line, date and addressee block, subject
   line, salutation, paragraph spacing or indents, and the sign-off. Keep the `\newcommand` fields and
   the `% BODY START` / `% BODY END` markers. Fill the identity fields from the profile.
4. Write `templates/cover/format.md`: a short list of the structure to follow in every letter
   (paragraph count and roles, salutation form, sign-off, typical length). Describe it; don't quote it.
5. `template_set_main kind: "cover"`, `tex_compile`, then `pdf_render` it next to the example. Adjust
   until the layouts match, then ask the user to approve.

Never reuse the example's sentences, claims or voice in the user's letters. Only its format carries over.
Tone comes from `profile/preferences.md`.

## Report and iterate
Reply with a 2–3 line summary of the angle taken, plus the path, then follow the attach mode (EZAPPLY.md):
in `after-approval`, `review_open` it (with the resume if that's ready and not yet approved) and
`review_wait`. Handle tweaks ("more concise", "mention X"), from chat or the review page, by editing,
recompiling, reporting in one line, and reviewing again in `after-approval`. Every build is saved in `.history/`, so earlier
versions can be restored on request.
