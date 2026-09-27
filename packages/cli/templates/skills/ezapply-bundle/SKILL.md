---
name: ezapply-bundle
description: Combine application documents (cover letter, resume, transcript, portfolio…) into a single PDF when a posting or form requires one file. Use when the user asks to combine or merge documents, or when the posting requires a single upload.
---

# Single-PDF bundle

1. **Decide that a bundle is needed.** Signals:
   - the posting says so ("combine into one PDF", "single document"); check `## Application requirements`
     in `notes.md`
   - the form has only one file field but needs several documents
   - the user asks

   Record it with `posting_update_meta bundleRequired: true`.
2. **Order:** follow the order the posting specifies. Otherwise use cover letter, then resume, then extras
   (transcript, portfolio, references from `library/`). Make sure `resume.pdf` and `cover.pdf` are current:
   recompile if their `.tex` is newer.
3. **Extras:** list `library/`. Scans or photos go through `pdf_from_images` first. If a library PDF is
   encrypted, tell the user; don't skip it silently. If the posting asks for only part of a document (e.g.
   "unofficial transcript, first page"), use `pages`.
4. **Merge:** use `pdf_merge` with a label per section ("Cover Letter", "Resume", "Transcript"),
   `normalize: "auto"`, title "<Name>: Application for <Role>" and author = the user's name. Output
   `postings/<id>/<Last>_<First>_<Company>_Application.pdf`, unless the posting specifies a file name.
5. **Check:**
   - `pdf_info`: page count, and a single page size.
   - The resume section is still exactly one page (from the merge `sections`).
   - Size is under the form's limit, or 5 MB if unknown. Otherwise run `pdf_compress` and report the
     result. If it can't reach the target, say so and suggest what to drop.
6. `open_file` the bundle and report the sections with their page ranges in one line.
