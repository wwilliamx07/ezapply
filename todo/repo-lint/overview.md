# Lint for broken Markdown links and stale comments

**What.** The lint fails on a link to a Markdown file or heading that doesn't exist, wherever it is, and on a
code comment that names something no longer in the code.

**Why.** The reference test checks links only in the references, the todo, the README and the `CLAUDE.md`
files. Links and paths in the skills, the agent file and code comments aren't checked, and a comment naming a
renamed function, file, tool or todo item stays until it misleads someone. Biome's rules can't check either: they
don't look at other files.

**Plan.**
- A small checker run by the lint after Biome: Markdown links in every tracked `.md` (the shipped templates
  included, against the workspace layout they describe), and in code comments every `.md` path, `#anchor` and
  todo title in quotes.
- Stale comments: a backticked name in a comment that's no identifier, file or tool anywhere in the repo fails,
  with an allowlist for ids from employers' pages, kept in each site's folder.
- Move the reference test's link checks into it, so one place checks links.
- Fix what it finds.

[details](details.md)
