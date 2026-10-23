# Agents that try to break a new adapter: details

**Why.** One agent writing an adapter and judging it too sees what it meant to build, not what it built. The
process in `references/building-adapters.md` goes from tests the builder wrote straight to a live run with the
user's account; nothing in between tries to break the adapter.

**How.** A skill in this repo (`.claude/skills/break-adapter/`, for Claude working on ezapply, not the
workspace), run once a site's definition, tests and clone exist (after "Clone it" in the process, before "Check it
live"). It links to `building-adapters.md` rather than copying it, and splits the work across subagents with
separate contexts, in a loop:
- **Runner:** gets only the built bundle, the site's clone and the adapter harness's fill run, never the builder's
  reasoning. It runs the whole flow on the clone (every field read, filled with fake values and read back, rows
  added and removed, Next and Back, Submit pressed synthetically to prove the guard), then on the variants below.
  It reports each failure with the variant, the call, its arguments, what came back and what should have, and the
  debug trace.
- **Improver:** fixes what the report names, adding a failing test for each failure first, and hands back to the
  runner.
- **Stops** when the conformance and extraction tests pass and a runner round finds nothing new, or after a set
  number of rounds, leaving what's still failing for the user.

**Variants,** each a named transform the stand-in applies to a clone (`scripts/harness/variants/`), so a failure
reproduces and every site reuses them: fields rendered late (inserted after a delay), sections reordered, prompts
relabelled (a synonym, a trailing `*`, extra whitespace), a list that loads only as you type, rows added or removed
by the page, errors appearing on blur, a second form on the page, duplicate ids, a much slower network.

**Tests:** the variants on the adapter harness's hand-written test site, so the tool isn't what's flaky.

**References when built:** `building-adapters.md` (a step between "Clone it" and "Check it live"),
`development.md` (the skill).

**Challenges and open questions.**
- The variants are guesses about how the site behaves; an adapter hardened against them can still miss what the
  real site does. They test robustness, not fidelity: the unaltered clone and a live run stay the evidence.
- A loop of agents costs many tokens per site; worth it for sites with many applications behind them.
