---
name: ezapply-cover-letter
description: Write or revise a cover letter for a job posting.
---

# Cover letter

1. **Start.** `document_start { kind: "cover" }` sets up `cover.tex` and returns the posting, `notes.md`, the
   profile, every claim and `coverFormat` (the structure of the user's example letter, when there is one). With
   `requirementsMissing`, write `## Application requirements` first (EZAPPLY.md): word or page limits, who to
   address, questions the letter must answer, whether a letter is wanted at all. Use the resume's evidence map in
   `notes.md` if it's there; else note the top requirements and the claims that back them.
2. **Write the body** (between `% BODY START` and `% BODY END` when the template has them), and fill the
   placeholders: company, role, date, the addressee if the posting names one. The placeholder body only marks
   where the letter goes. Unless `coverFormat` sets another structure:
   - **Opening** (2–3 sentences): the role and a concrete, true reason this company or team interests the user,
     from the posting. No clichés ("I am writing to express…", "passionate").
   - **One paragraph per project or role**, strongest first, each tying one or two requirements to what the user
     built and how. Everything about one project in its paragraph. Mirror the posting's words only where true.
   - **Close** (1–2 sentences): what they'd bring, and availability to talk.
3. **Rules:** never mention gaps apologetically. A `% src:` comment beside each paragraph with the claim ids it
   uses. Escape LaTeX specials in text from the posting.
4. **Edit and fit** with `tex_edit { path, edits }`: a round's changes in one call, each `old` copied from the
   `.tex` as it is. One full page (`freeLines` 0–2) unless the requirements or `coverFormat` set another length:
   fill it with more evidence (a further project, more on how something was built), never filler; when the
   evidence runs out first, the letter stays short. Then fix the rest of `lint`. Keep the `% !TEX program` line.
5. **Read the body once** as the hiring manager would: cut filler and repeated claims.
6. **Report** the angle in 2–3 lines and end your turn: the review opens by itself in the after-approval mode.
   Call `review_documents` yourself only for a letter meant to be shorter (`short`, with the reason: a length in
   the requirements, `coverFormat` or the preferences, the user's words, or the evidence that ran out), one
   already approved (`again`), or outside the panel.

**Changes the user asks for:** edit, rebuild, and report in one line from `pdf_text { path, sinceReviewed: true }`.
Every build is kept in `.history/`, so an earlier version can be restored.
