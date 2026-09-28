# Project knowledge base

The only source of project facts for resumes and cover letters. Built by Claude with the `ezapply-index-repo` skill
from the read-only [repo cache](github-and-repos.md), checked by the companion (`companion/src/repos/`).
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
      - { path: src/limiter/window.lua, lines: "1-48", sha: a1b2c3d, hash: 3f9c0a17b2de }
        # lines and sha optional; hash is written by knowledge_mark_indexed, never by hand
    confidence: high                # high = visible in code; medium = inferred from structure or docs
    user_edited: false              # true = the user edited it; re-indexing keeps it verbatim
```
5–20 claims per repo, each one resume-bullet sized. Numbers only when the evidence contains them.

## Reading them
`claims_list` returns every repo's claims as compact text (`RepoService.allClaims`): the repo once as a
heading, then `- id: claim`, with `(impact: …)` only when there is one. It's how Claude reads the knowledge
base at the start of work on a posting; the knowledge docs and the repo cache are opened only when a claim
can't answer something ([workspace](workspace.md#the-agent-file-ezapplymd)).

## Checks
- **`claims_check`** validates the schema, unique ids, that every evidence path exists in the cached repo
  (and stays inside it), that line ranges are within the file, and that cited lines carrying a `hash` still
  hash the same. Returns `{ valid, claims, errors[], unstamped }` (`unstamped`: line ranges without a hash
  yet).
- **`knowledge_mark_indexed`** refuses unless `claims_check` passes, then stamps a `hash` on every evidence
  entry that has a line range and none yet, and writes `meta.json` with the cached HEAD commit, file count
  and depth policy. Later `repo_sync` calls report only files changed since. The stamp goes into
  `claims.yaml` through the YAML document model, so comments and layout are kept.
- **Why hashes.** Line ranges alone go stale quietly: after the code changes, a claim can point at unrelated
  lines that are still in bounds and still pass. The hash is 12 hex characters of SHA-256 over the cited
  lines (line endings and trailing whitespace ignored). When they change, `claims_check` names the claim,
  and re-indexing re-verifies it: Claude re-reads the lines, fixes the claim or its range, and deletes the
  hash so the next `knowledge_mark_indexed` stamps a fresh one. Evidence without a line range (a whole file)
  isn't hashed: any edit to the file would flag it.
- The skill's **self-check**: Claude re-reads each claim beside its cited lines and drops or downgrades
  anything the code doesn't directly support.

## Indexing procedure (the `ezapply-index-repo` skill)
1. `repo_sync` → `changedSince`: `[]` = current, stop; a list = re-index only the affected components (and
   the README if the big picture changed); `null` = everything.
2. `repo_contributions`: in shared repos, claims cover only the user's own areas and commits, and the
   README says so.
3. Survey the tree (skipping vendored, generated, lock and build output), manifests, README, entry points,
   CI and tests.
4. Split into components; write component docs bottom-up, then the README, then `claims.yaml`.
5. `claims_check` until clean; self-check; keep `user_edited` claims unchanged (a changed-lines error on one
   goes to the user). Evidence whose lines changed is re-verified and its hash deleted.
6. `knowledge_mark_indexed`; summarize the project and its strongest claims for the user in 3–5 lines.

Reading uses Claude Code's own Read, Grep and Glob. Nothing in the cache is edited, built, installed or
run, and no git command that changes it is used.

## How tailoring uses it
The `ezapply-resume` and `ezapply-cover-letter` skills build an **evidence map** from each posting requirement to claim ids
(or profile entries), mark each changed bullet with `% src: <claim-id>`, and never present a requirement
without evidence as a skill.
