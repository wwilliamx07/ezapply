# Tailoring edits that fit the page and the text: details

- **How full.** The compile already returns pages and an overflow; add how much of the last page is used (e.g. its
  lowest text line), so "one more line fits" is known instead of guessed.
- **Rereading.** `EZAPPLY.md` says not to re-read files just written, which saves tokens. Weigh that against edits
  made blind to their context: e.g. reread only the changed sections, once, before the compile. Keep "Cut the
  tokens a panel conversation spends" in mind.
- **Failed edits.** No cause known yet: record which edit failed and how (no match, a stale file, a tool error)
  before choosing a fix.

**References when built:** `components/documents.md`, `components/workspace.md`, `mcp-tools.md`.
