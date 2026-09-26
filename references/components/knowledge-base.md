# Project knowledge base

The only source of project facts for resumes and cover letters. Built by Claude with the `index-repo` skill
from the read-only [repo cache](github-and-repos.md), checked by the daemon (`companion/src/repos/`).
Accuracy matters more than coverage: every claim must cite the lines that prove it.

## Layout (`knowledge/<owner>__<name>/`)

| File | Contents |
|---|---|
| `README.md` | What the project is and who it's for, the stack, an architecture sketch, the user's role, notable results (only ones the repo shows) |
| `components/<component>.md` | Purpose, key files, how it works, design decisions, hard problems solved, tests |
| `components/<component>/…` | Large components, recursively, with the same format |
| `claims.yaml` | Atomic, evidence-linked facts: what tailoring uses |
| `meta.json` | Which commit the docs reflect (written by `knowledge_mark_indexed`) |

**Depth policy:** a component with more than 15 source files or more than 2k lines of code gets its own
folder; the same test applies one level down, to a maximum depth of 3.

## Claims (`claims.yaml`)
```yaml
schemaVersion: 1
repo: owner/name
claims:
  - id: rate-limiter-redis          # kebab-case, stable across re-indexes
    claim: "Implemented a sliding-window rate limiter backed by Redis Lua scripts"
    skills: [Redis, Lua, rate limiting]
    impact: null                    # only a result the repo itself shows
    evidence:
      - { path: src/limiter/window.lua, lines: "1-48", sha: a1b2c3d }   # lines and sha optional
    confidence: high                # high = visible in code; medium = inferred from structure or docs
    user_edited: false              # true = the user edited it; re-indexing keeps it verbatim
```
5–20 claims per repo, each one resume-bullet sized. Numbers only when the evidence contains them.

## Checks
- **`claims_check`** validates the schema, unique ids, that every evidence path exists in the cached repo
  (and stays inside it), and that line ranges are within the file. Returns `{ valid, claims, errors[] }`.
- **`knowledge_mark_indexed`** refuses unless `claims_check` passes, then writes `meta.json` with the cached
  HEAD commit, file count and depth policy. Later `repo_sync` calls report only files changed since.
- The skill's **self-check**: Claude re-reads each claim beside its cited lines and drops or downgrades
  anything the code doesn't directly support.

## Indexing procedure (the `index-repo` skill)
1. `repo_sync` → `changedSince`: `[]` = current, stop; a list = re-index only the affected components (and
   the README if the big picture changed); `null` = everything.
2. `repo_contributions`: in shared repos, claims cover only the user's own areas and commits, and the
   README says so.
3. Survey the tree (skipping vendored, generated, lock and build output), manifests, README, entry points,
   CI and tests.
4. Split into components; write component docs bottom-up, then the README, then `claims.yaml`.
5. `claims_check` until clean; self-check; keep `user_edited` claims unchanged.
6. `knowledge_mark_indexed`; summarize the project and its strongest claims for the user in 3–5 lines.

Reading uses Claude Code's own Read, Grep and Glob. Nothing in the cache is edited, built, installed or
run, and no git command that changes it is used.

## How tailoring uses it
The `resume` and `cover-letter` skills build an **evidence map** from each posting requirement to claim ids
(or profile entries), mark each changed bullet with `% src: <claim-id>`, and never present a requirement
without evidence as a skill.
