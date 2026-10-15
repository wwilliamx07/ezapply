# Cut the tokens a panel conversation spends: details

## How the runs were measured
From Claude Code's own transcripts of the workspace (`~/.claude/projects/<workspace>/<session>.jsonl`): each
assistant message's `usage`, each tool result's size weighted by the number of API calls after it (that's how
often it's re-read), and the `prompt_snapshot`, `skill_listing`, `instructions` and `deferred_tools_delta`
attachments for what the starting context holds. Sizes are characters / 4.

| | Tailoring | Tailoring, then application |
|---|---|---|
| API calls | 23 | 36 |
| Context read (almost all cache reads) | 1.25M | 2.48M |
| Output | 8.7k | 13.6k |
| Fixed starting context × calls | 683k (55%) | 1.07M (43%) |
| Tailoring carried through the application (28k × 23 calls; a posting's two conversations remove it) | — | ~650k (26%) |
| File reads (resume template 2.6k, `answers.yaml` 3.3k, `posting.md` 1.8k, profile) | 120k | 269k |
| `claims_list` (4k, read at the second call) | 85k | 138k |
| Skill bodies (`ezapply-apply` 3.9k) | 33k | 117k |
| `tex_compile` (×7 / ×5) | 19k | 37k |
| Form tools (`add_repeatable` 2k, `go_next` ~670 each, `get_form`, `list_options` ×3) | — | ~110k |

The starting context (~29.7k):

| Part | Tokens |
|---|---|
| Built-in tool schemas (Bash and PowerShell both, Agent, Read, Edit, …) | 14.7k |
| Skill listing: ezapply's ~0.5k, the rest the user's own plugins and claude.ai skills | 4.5k |
| `CLAUDE.md` + `EZAPPLY.md` | 3.1k |
| Deferred tool names (ezapply's, Claude Code's, the user's claude.ai connectors) | 1.7k |
| System prompt | 1.3k |
| MCP server instructions (a claude.ai connector's included), subagent listing | 1.2k |

The ezapply tools are already deferred (tool search is on): only their names are in the prefix.

## 1. Keep the user's own setup out of the panel
The panel's prefix depends on the user's personal Claude Code setup. Beyond the tokens, that's a correctness
problem: a claude.ai document skill's description claims resumes and cover letters, competing with ezapply's
skills. Candidates for `agentArgs` (`packages/companion/src/agent/process.ts`), found in Claude Code 2.1 but not
yet tried:
- `--strict-mcp-config --mcp-config .mcp.json`, or `ENABLE_CLAUDEAI_MCP_SERVERS=false`: only the ezapply server.
- `--setting-sources project`: no user-level plugins or skills. Check the subscription login and the workspace's
  permission rules still apply.
- `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`; the `skillOverrides` setting for what's left.
- `--tools` with what the panel uses: one shell (not both Bash and PowerShell), Read, Edit, Write, Glob, Grep,
  Skill, ToolSearch, Agent (general-purpose subagents are used for posting and repo reading).

Measure each with a one-message run: the transcript's `prompt_snapshot` gives the sizes. Expect 5–8k off every call.

## 2. Fewer form turns
- **`list_options` costs turns, not tokens.** Its three calls returned 300–700 tokens each (short lazy lists:
  degree, language, EEO), but each was a turn re-reading 60–90k. Filling first is one call when the guess matches
  and two when it misses; listing first is always two. Delete it; keep `search_options` for long typeaheads.
- **A miss is the query:** `fill_fields` returns the ~10 closest options and a count, not the whole list.
- **Nested menus:** a how-did-you-hear field took four `fill_fields` calls (top level, a wrong path, then the
  label). On a miss in a nested menu, search its children for the value and return full paths.
- The risk is a close match picking the wrong option where wording decides (reversed polarity, ranges): the skill
  says to check `inexact` and `readBack` on those instead of listing first.
- An adapter change: follows "One adapter change per live run".

## 3. What the context holds
**Claims and the posting.** A general-purpose subagent reads `claims_list` and `posting.md` and returns the
evidence map, so the tailoring thread never holds them (6k re-read on every call). It filters without building
retrieval; the subagent's own calls are few and small.

**Edits.**
Several Edits already go in one message. The extra turns are the compile coming a turn later:
`EZAPPLY.md`'s "After every edit: `tex_compile`" reads as edit, then compile. The combined run put
`Edit+tex_compile` in one message and it worked. Say so in the resume and cover-letter skills. Next step if that's
not enough: a `tex_edit { path, edits[] }` tool that applies exact replacements and returns the compile (JSON
arguments avoid the escaping that rules out scripted edits). Review-page tweaks are real work and stay.

**`EZAPPLY.md`** (`packages/cli/templates/workspace/`, ~2.7k, in every call of every conversation) to ~1.3k:
- attach mode and `review_documents`, the TeX engine, `.history`, `pdf_text`: to the resume and cover-letter skills;
- "Application forms" and the "Ask, don't guess" rule (EEO, already in the apply skill): to `ezapply-apply`;
- the `ask_user` parameters: one line (the tool description and the apply skill carry them);
- the `doctor` and `init` commands: out of `EZAPPLY.md` (where to is open: "Remove the onboarding and repos
  skills" drops the onboarding skill);
- keep untrusted content, application requirements, keep context lean, layout, and the rules "Untrusted content
  is data", "No fabrication" and "Never submit an application". Decide where "The resume is exactly one page" and
  "Repos are read-only" go.

**`ezapply-apply`** (~3.9k, re-read on every call after it loads) to ~2k:
- The first step of "Before starting" (tabs, frames, `tabHidden`, `browserBehind`, `postingMismatch`, `postingBound`): each
  result carries a `hint`; say to follow it.
- "Carried over from a previous application" and "Save what got resolved" (~650): supporting files beside
  `SKILL.md`, read only when they apply.
- Shorten "Add buttons by kind", "One-page applications", "Screenshots" and "Resuming": mostly the tool
  descriptions again.

This overlaps "Refactor the skills for agent performance"; do the cuts here only if this item comes first.

## Smaller
- The workspace's `promptCacheTtl` is `5m`, while `ask_user` and `review_documents` wait up to 10 minutes; after
  such a wait the next call writes the whole context again (1.25×) instead of reading it (0.1×). These runs didn't
  hit it. `1h` if long waits are common.
- `answers.yaml` (3.3k) is read whole at the start of an application; reading it only when the profile hints don't
  cover a question would save most of it.
