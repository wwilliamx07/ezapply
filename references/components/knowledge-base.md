# Project knowledge base

The only source of project facts for resumes and cover letters. Built by Claude with the `ezapply-index-repo` skill
from the read-only [repo cache](github-and-repos.md), checked by the companion (`companion/src/repos/`).
Accuracy matters more than coverage: every claim must be true of code Claude read. It also has to stay
current, as cheaply as possible: a re-index works from the diff since the last index, not from the whole repo.

## Layout (`knowledge/<owner>__<name>/`)

| File | Contents |
|---|---|
| `README.md` | What the project is and who it's for, the stack, an architecture sketch, the user's role, notable results (only ones the repo shows) |
| `components/<component>.md` | Purpose, key files, how it works, design decisions, hard problems solved, tests |
| `components/<component>/…` | Large components, recursively, with the same format |
| `claims.yaml` | Atomic facts, each naming the files that show it: what tailoring uses |
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
    files: [src/limiter/]           # files or folders that show it
    confidence: high                # high = visible in code; medium = inferred from structure or docs
    user_edited: false              # true = the user edited it; re-indexing keeps it verbatim
```
5–20 claims per repo, each one resume-bullet sized. Numbers only when the code or docs contain them.

**Why files, not line ranges.** Nothing downstream reads cited lines (`claims_list` leaves them out, and
tailoring works from the claim text), so line ranges would cost tokens to write and re-verify for no use, and a
hash of the cited lines would flag any edit under a claim, reformatting included, without saying whether the
claim still holds. What a re-index needs is which claims a change might affect, and file paths answer that:
`repo_sync` lists the claims whose `files` include a changed path (`affectedClaims`). Claims in the older
`evidence: [{ path, lines, hash }]` form are still read (each entry as its `path`) and are rewritten as `files`
by the next `knowledge_mark_indexed`, keeping the file's comments; `schemaVersion` is 1 for both.

## Reading them
`claims_list` returns every repo's claims as compact text (`RepoService.allClaims`): the repo once as a
heading, then `- id: claim`, with `(impact: …)` only when there is one; a repo whose `claims.yaml` doesn't
parse gets one line saying to run `claims_check`. It's how Claude reads the knowledge
base at the start of work on a posting; the knowledge docs and the repo cache are opened only when a claim
can't answer something ([workspace](workspace.md#the-agent-file-ezapplymd)).

## Checks
- **`claims_check`** validates the schema, unique ids, and that every path in a claim's `files` (a file or a
  folder) exists in the cached repo and stays inside it. Returns `{ valid, claims, errors[] }`.
- **`knowledge_mark_indexed`** refuses unless `claims_check` passes, rewrites old-form claims as `files`, then
  writes `meta.json` with the cached HEAD commit, file count and depth policy. Later `repo_sync` calls report
  only what changed since.
- The skill's **check**: Claude re-reads each claim it wrote or changed against the code it read, and drops
  or downgrades anything the code doesn't directly support.

## Indexing procedure (the `ezapply-index-repo` skill)
1. `repo_sync` → `changedSince`: `[]` = current, stop; a list = **re-index**; `null` with no knowledge folder =
   **full index**; `null` with one = the indexed commit is gone (a force-push): keep the existing docs and
   claims, survey the tree, and read only the areas the docs don't match.
2. **Re-index.** Claude decides how much to re-read, but the skill pushes hard toward small: extend the
   existing structure and work from the diff.
   - Read the knowledge README and `claims.yaml`; find the component docs covering the changed paths with Grep
     over the knowledge folder rather than reading them all.
   - Drop paths that can't change a fact (lock, generated, vendored, build output, assets, formatting); the
     `added`/`removed` counts show where the work is.
   - `repo_diff` for the remaining source paths, a few at a time; a whole file only when the diff lacks context.
   - Update only the component docs the changes touch; new files go into the component they belong to; a new
     component doc only for substantial work that fits none; existing components aren't reorganised unless they
     no longer describe the code. Each of `affectedClaims` is kept, reworded or deleted; notable new work gets
     new claims. The README changes only when the big picture did. `repo_contributions` only for a repo the
     README says is shared.
3. **Full index.** `repo_contributions` (in shared repos, claims cover only the user's own areas and commits,
   and the README says so); survey the tree (skipping vendored, generated, lock and build output), manifests,
   README, entry points, CI and tests; split into components; write component docs bottom-up, then the README,
   then `claims.yaml`.
4. `claims_check` until clean; check each written or changed claim; keep `user_edited` claims unchanged (a
   change that contradicts one goes to the user).
5. `knowledge_mark_indexed`; tell the user in 3–5 lines what the project is and its strongest claims (full
   index) or what changed in the knowledge base (re-index).

*Why diffs:* re-surveying and re-reading whole components after a few commits reads most of the repo to
account for a handful of changed lines. The diff is usually a small fraction of that, and the existing docs
already hold the rest. `repo_diff` caps its output (60k characters) so asking for too much
can't flood the context.

Reading uses Claude Code's own Read, Grep and Glob, and `repo_diff`. Nothing in the cache is edited, built,
installed or run, and no git command that changes it is used.

## Staying current
Each chat checks every indexed, selected repo's remote head against `meta.json`'s `indexedSha`, and lists
knowledge folders whose repo is no longer selected (their claims would still be in `claims_list`). The agent
re-indexes or removes them with the user's agreement ([keeping the workspace current](companion.md#keeping-the-workspace-current-workspace_changes)).

## How tailoring uses it
The `ezapply-resume` and `ezapply-cover-letter` skills build an **evidence map** from each posting requirement to claim ids
(or profile entries), mark each changed bullet with `% src: <claim-id>`, and never present a requirement
without evidence as a skill.
