# Lint for broken Markdown links and stale comments: details

- A first pass with the stale-name rule over `packages/*/src` hits only ids from employers' pages (a Dayforce
  control id, SuccessFactors widget names, Phenom job ids): that's what the allowlist is for.
- A name only in comments, with no code using it, is the strongest sign; a name used in another package counts as
  existing.
- The skills' tool names and call shapes stay with `cli/test/skill-calls.test.ts`; the checker doesn't repeat it.
- Workspace paths in the shipped templates (`profile/answers.yaml`, `postings/<id>/notes.md`) aren't repo files:
  check them against `WORKSPACE_DIRS` and the files `init` writes, or leave them out.
- `/garden`'s `.claude/skills/garden/candidates.mjs` already finds comment names that no code uses and `.md`
  paths in comments that don't exist, as a list to check by hand. The lint can start from its matching, keeping
  only the rules precise enough to fail a build.
- A lint step rather than a test, so it runs before the build and fails fast.

**References when built:** `development.md` (lint and tests), `references/CLAUDE.md`'s line on what
`test/references.test.ts` checks.
