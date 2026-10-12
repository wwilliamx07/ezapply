# Agents that try to break a new adapter: details

**Why.** One agent writing an adapter and judging it too sees what it meant to build, not what it built. The
process in `references/building-adapters.md` goes from tests the builder wrote straight to a live run with the
user's account; nothing in between tries to break the adapter.

**How.** A skill in this repo (`.claude/skills/break-adapter/`, for Claude working on ezapply, not the
workspace), run once a site's definition and tests exist (after "Tests" in the process, before "Check it live").
It links to `building-adapters.md` rather than copying it, and splits the work across subagents with separate
contexts, in a loop:
- **Runner:** gets only the built bundle, the saved pages and the live-check script, never the builder's reasoning.
  It runs the whole flow against the saved pages served locally (every field read, filled with fake values and read
  back, rows added and removed, Next and Back, Submit pressed synthetically to prove the guard), then against the
  variants below. It reports each failure with the page, the variant, the call, its arguments, what came back and
  what should have, and the debug trace.
- **Improver:** fixes what the report names, adding a failing test for each failure first, and hands back to the
  runner.
- **Stops** when the conformance and extraction tests pass and a runner round finds nothing new, or after a set
  number of rounds, leaving what's still failing for the user. On a public page the runner may then do the same
  live, under the live-check rules; a page behind an account waits for the user's first run with debug mode on.

**The live-check script, in the repo** (`scripts/live-check/`): the script used for Greenhouse, Lever and Ashby
(`references/components/adapters.md`, "Checking a site live"), with this machine's paths made options: the
browser (Chrome or Edge, found as the companion's `Opener` finds them), headless or not, the page (a URL, or a
saved page served by a loopback static server), and the site. It injects `<site>-main.js` into the page's main
world over the DevTools protocol as the extension does, runs a list of adapter calls from a JSON file, and writes
each result, with debug mode's trace when asked. Its rules don't change: never submits, obviously fake values, no
upload to a third party, no bot-protection workarounds.

**Variants,** each a named transform of a saved page (`scripts/live-check/variants/`), so a failure reproduces and
every site reuses them: fields rendered late (inserted by a script after a delay), sections reordered, prompts
relabelled (a synonym, a trailing `*`, extra whitespace), a list replaced by one that loads as you type, rows added
or removed by the page, errors appearing on blur, a second form on the page, duplicate ids.

**Tests:** the call runner and the variants on one existing site's saved page, so the tool isn't what's flaky.

**References when built:** `building-adapters.md` (a step between "Tests" and "Check it live"),
`components/adapters.md` ("Checking a site live": the script is in the repo), `development.md` (scripts, the
skill).

**Challenges and open questions.**
- Real markup of application steps needs an account and an application in progress. The user has to drive that;
  debug mode's markup and `ezapply debug export` make one run enough.
- The variants are guesses about how the site behaves; an adapter hardened against them can still miss what the
  real site does. They test robustness, not fidelity: the saved pages and a live run stay the evidence.
- A loop of agents costs many tokens per site; worth it for sites with many applications behind them.
