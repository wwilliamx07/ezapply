---
name: garden
description: Full audit and cleanup of the ezapply repo. Deletes stale comments and dead code, removes unused tracked files, trims references/ and todo/ back to what their CLAUDE.md files say they hold, and brings the docs in line with the code. Use when the user asks to garden, audit, tidy or clean up the repo.
argument-hint: "[path or area to limit the audit to]"
disable-model-invocation: true
---

# /garden: audit and tidy the repo

Leave the repo smaller and truer without changing what the code does. Each finding gets **fixed** (when it is
clearly dead, wrong or bloat), or **reported** (when deleting it needs a judgment you can't make from the repo).
`$ARGUMENTS`, if given, limits the audit to that path or area. Otherwise audit everything that's tracked.

The rules being enforced are already written down, so read them first and don't make up new ones: the root
`CLAUDE.md`, `references/CLAUDE.md`, `todo/CLAUDE.md`, each package's `CLAUDE.md`, and "Conventions" in
`references/development.md`.

## Ground rules

- **No behaviour changes.** Gardening deletes, trims and corrects. If a fix would change what the code does, even
  a fix for a real bug, report it instead of making it.
- **Adapters:** `packages/sites/src/<site>/definition/` and `packages/engine/` follow "One adapter change per live
  run". Here you may edit comments and delete code nothing calls. A change that alters what runs in the page is
  reported. Golden schemas must come out unchanged.
- **`packages/cli/templates/` ships to users** on their next `ezapply init`. Trimming there is allowed, but name
  every change in the report.
- **Upgrade shims stay.** "Remove the upgrade shims" in `todo/` owns them, so their comments are current until it is
  done.
- **Leave untracked and ignored files alone** (`tmp/`, `dist/`, `node_modules/`, local captures). They're the
  user's and may hold personal data. Don't open them, and don't list their contents in the report.
- **Not sure? Report it.** A deletion you can't back with a search that shows nothing uses the thing goes in the
  report, together with that search.
- **Don't commit.** Leave the diff for the user to review, unless they asked for commits.

## 1. Baseline

1. `git status`. If the tree has uncommitted changes, say so and ask whether to go on. Gardening on top of
   unrelated work makes the diff hard to review.
2. Run `npm run lint`, `npm run typecheck` and `npm test` (the last one in the background; it builds first). Note
   anything that already fails, so it isn't blamed on the cleanup later.
3. Run the candidate finder. It is a heuristic and its output is a list to check, not a list to delete:
   ```bash
   node .claude/skills/garden/candidates.mjs
   ```
   It prints unused exports, tracked files nothing names, `` `names` `` in comments that appear nowhere in code,
   and comments that read like history.

The audit is large. Split the read-only sweeps (sections 2–5) across subagents, one per package plus one for
`references/` and `todo/`. Give each one the ground rules above and have it return findings with file:line and the
search that backs each one. Make the edits yourself, so one agent holds the whole diff.

## 2. Code

- **Stale comments:** a comment that names a function, file, tool, error code, todo item or reference heading
  that no longer exists. A comment that narrates history ("used to", "previously", "now uses", "after the
  refactor", "new", "fix for…", dates, commit or PR numbers): rewrite it to state the current rule and its reason, or
  delete it. A `TODO`/`FIXME` that is done, or is tracked in `todo/`: delete it. A comment that only repeats what
  the next line says plainly. Commented-out code.
- **Dead code:** exports nothing imports (drop the `export`, or the whole declaration if its own file doesn't use
  it either). Files nothing imports. Branches for options nothing sets. Parameters every caller passes the same
  value for. Re-exports nobody uses. Before deleting anything, confirm with `git grep -w <name>` across the whole
  repo: tests, build scripts, `manifest.json`, the HTML entry points, and the skills' and templates' text.
- **Dependencies:** a `package.json` dependency that no file in that package imports. Remove it from
  `package.json` and run `npm install` so `package-lock.json` follows.
- **Tests:** tests of code that is gone, skipped tests with no reason that still holds, fixtures and golden files
  that no test reads.
- Keep the surrounding style: comment density, naming and idiom. Don't add comments while removing others.

## 3. Unused artifacts

Tracked files that history left behind: saved pages, fixtures, images, scripts, configs or `.md` files that nothing
names (the finder's "unreferenced files"), scratch or backup files (`*.orig`, `*.bak`, `*.log`, `old-*`, `copy of`),
and anything tracked that `.gitignore` now matches (`git ls-files -ci --exclude-standard`). Look at each one before
deleting it. Its `git log --oneline -- <path>` usually shows whether it's a leftover.

Also check the config files against what exists: `biome.json` ignores, `vitest.config.ts` globs, `tsconfig*`
`include`s and references, the workspaces in `package.json`, the build entry points and the CI steps. An entry for
a path that is gone gets deleted.

## 4. references/

Hold every page to `references/CLAUDE.md`, and check it against the code, not against memory:

- **Current:** every statement matches the code as it is now. Open the files a page names and check them. Fix
  anything wrong, delete what describes code that is gone, and add anything the code does that no page covers
  (on the page that owns that part).
- **Not a copy of the code:** cut parameter types, per-test case lists, file-by-file listings and constants that
  the code says plainly. Replace them with the file's name.
- **One place per fact:** when two pages state the same fact, keep it on the owning page and link to it from the
  other.
- **Rules, not history:** cut narration of what changed and when, commit references and "was/previously". Keep a
  past incident only as a one-sentence reason for a rule.
- **Built, not planned:** planned work moves to `todo/`, or goes away if `todo/` already has it.
- **Why stays:** don't trim the reasons behind non-obvious choices. That is the part the code can't hold. Every
  decision in `status.md`'s Decisions links to the page that explains it, and every such page has its line there.
- **`status.md`:** "Not yet verified for real" names only changes that are built and still unverified. Known issues
  that are fixed come out.
- **Index:** `README.md`'s "By task" and "Contents" tables match the pages and what they cover.

Prefer cutting to adding. A page that comes out shorter and still complete is the goal.

## 5. todo/ and the CLAUDE.md files

- **todo/**, held to `todo/CLAUDE.md`: an item that is built in whole gets its directory and its row in `todo.md`
  deleted. Check that `references/` covers it first, and move anything still needing a live run into `status.md`.
  An item built in part is cut down to what's left, its size included. `overview.md` has no file names, functions
  or numbered steps. Every directory has its row in `todo.md` and every row has its directory. Items are referred
  to by title, from code and from `references/`. Files that aren't items (a scratchpad) are flagged for the user.
- **CLAUDE.md files:** short, and holding only rules that are current for their directory. Every path and name in
  them exists. No rule is repeated between the root file and a directory's file. A rule's reasons live in
  `references/`, not here.
- **README.md:** the quick start's commands exist in `package.json` and still work.

## 6. Sensitive information

The root `CLAUDE.md`'s "Never expose sensitive information" applies to every tracked file. Search for real emails
(anything not `@example.com`), employer tenant or company subdomains (`myworkdayjobs.com`, `oraclecloud.com`,
`greenhouse.io`, `lever.co`, `ashbyhq.com`, `dayforcehcm.com`, `successfactors` hosts that aren't placeholders),
phone numbers, local paths containing a username (`C:\Users\`, `/Users/`, `/home/`), real requisition IDs and job
titles, and any mention of the user's own live runs. Redact with the placeholders the root `CLAUDE.md` names.
Anything found already exposed goes at the top of the report, since it is still in git history.

## 7. Verify and report

1. Run `npm run lint`, `npm run typecheck` and `npm test` again. Everything that passed in the baseline must still
   pass. Golden schemas must be unchanged (`git diff --stat -- '**/golden/**'` is empty).
2. Check the diff once more with the finder's sensitive-data eye: no live values went into anything you rewrote.
3. Report in this order:
   - **Exposed:** sensitive data found, and where it was (already in history).
   - **Changed:** grouped by section above, a line each, with counts (for example "14 stale comments, 3 unused
     exports, 2 orphaned fixtures"). Name every change to `templates/`.
   - **Reported, not changed:** each with file:line, why it looks dead or wrong, and the search behind that. Bugs
     found along the way go here.
   - **Baseline failures** that were already there.
   - Lines added and removed (`git diff --shortstat`).
