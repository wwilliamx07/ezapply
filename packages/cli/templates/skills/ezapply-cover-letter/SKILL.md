---
name: ezapply-cover-letter
description: Write or revise a cover letter for the job posting using the user's cover letter template, profile, preferences and project knowledge. Use when the user asks for a cover letter or changes to one.
---

# Cover letter

## Inputs
- `posting_get` → `posting.md`. Note the company, the role, and what the team or product actually does.
- `## Application requirements` in `postings/<id>/notes.md` (write it first if missing, see EZAPPLY.md):
  word or page limits, who to address, reference numbers, questions the letter must answer, whether a
  letter is wanted at all.
- `profile/profile.yaml`. The user's preferences (tone, emphasis, never mention) are already in your context.
- `postings/<id>/notes.md` if the **ezapply-resume** skill already produced the evidence map. Otherwise do a
  quick version: the top requirements and the matching claims, from the claims (`claims_list`, if not already
  called in this session).
- Template: `templates/cover/` main file (`template.json` names it). If there is none, ask the user to run
  `ezapply init`, which installs the default.
- `templates/cover/format.md` if it exists: the structure taken from the user's example letter.

## Write `postings/<id>/cover.tex`
Copy the template main file (and any `contentFiles` from `template.json`, at the same relative paths), fill
its placeholders (company, role, date, addressee if the posting names one), and write the body (between the
`% BODY START` / `% BODY END` markers when the template has them). The placeholder body only marks where the
letter goes; its paragraph count isn't the letter's. The structure is:
1. **Opening (2–3 sentences):** the specific role and a concrete, true reason this company or team
   interests the user, drawn from the posting. No clichés ("I am writing to express…", "passionate").
2. **One evidence paragraph per project or role**, strongest first: each ties one or two requirements to it,
   citing what the user built and how, from claims or profile. Mirror the posting's language only where true.
   Everything about one project or role goes in its paragraph: never split it across two. Add the next
   strongest until the page is full (usually two or three, sometimes four).
3. **Close (1–2 sentences):** what they'd bring, and availability to talk.

If `format.md` exists, follow its structure (paragraph count, salutation, sign-off, subject line, length)
instead of the defaults above. The evidence rules below still apply.

Constraints:
- One full page (`freeLines` 0–2), unless the posting or `format.md` sets another length. Fill it with more
  of the evidence (a further project or result, more on how the user built something), never with filler.
  When the evidence runs out first, the letter stays short.
- No skills or results without evidence. Never mention gaps apologetically.
- Put a `% src:` comment beside each paragraph listing the claim ids used.
- Escape LaTeX specials in anything taken from the posting.

## Editing `cover.tex`
- **Use the Edit tool**, never a script (`python`, `sed`, PowerShell `-replace`): scripted edits miss LaTeX's
  backslashes or corrupt them. Copy each `old_string` from the source as you last read it, never from `pdf_text`
  or `lint`, and make each change in one edit.
- **One message per round:** the round's Edits, then `tex_compile` in the same message. Then reread the changed
  paragraphs whole and fix what doesn't fit (a repeated claim, one project split across paragraphs) in the next
  round.
- Keep the template's `% !TEX program` line: don't switch engines to fit the page.

## Build and check
`tex_compile { path }` (must be one page; fix the first error first, then what `lint` lists, never from page
images; `underfilled` or `freeLines` above 2 means add evidence, before fixing a short line) → read the body
once as the hiring manager would, between the markers. Cut filler and repeated claims.

`review_documents` refuses a letter with 3 or more free lines. Pass `short: [{ file, reason }]` only when it's
meant to be shorter, with the reason: a length in `notes.md` or `format.md`, a line in `profile/preferences.md`,
the user's words, or the evidence that ran out (and what you left out).

## Build from an example
When the user gives a sample letter whose format they like:
1. `template_import_example { sourcePath }` with its absolute path. Word files: ask for a PDF export first.
2. Read it: `pdf_info { path }` (page size) and `pdf_text { path, pages? }` for a PDF, or the image or text
   file directly. What the text can't tell you (font, margins), ask the user or keep the template's.
3. Rework `templates/cover/cover.tex` to reproduce its **format**: page size and margins, font family
   and size (the closest available), header layout and contact line, date and addressee block, subject
   line, salutation, paragraph spacing or indents, and the sign-off. Keep the `\newcommand` fields and
   the `% BODY START` / `% BODY END` markers. Fill the identity fields from the profile.
4. Write `templates/cover/format.md`: a short list of the structure to follow in every letter
   (paragraph count and roles, salutation form, sign-off, typical length). Describe it; don't quote it.
5. `template_set_main { kind: "cover", main }` and `tex_compile`. `open_file { path }` the PDF and ask the
   user to compare it with the example; adjust what they point out until they approve.

Never reuse the example's sentences, claims or voice in the user's letters. Only its format carries over.
Tone comes from the user's preferences.

## Report and iterate
Reply with a 2–3 line summary of the angle taken, plus the path, then follow the attach mode
(`posting_get` → `documents.attachMode`): in `after-approval` (the default), `review_documents { files }` it
(with the resume if that's ready and not yet approved); in `immediately` it's ready to attach (`open_file` only
when asked). Handle tweaks ("more concise", "mention X"), from chat or the review page, by editing, recompiling,
reporting in one line (from `pdf_text { path, sinceReviewed: true }` after a review), and reviewing again in
`after-approval`. Every build is saved in `.history/`, so earlier versions can be restored on request.
