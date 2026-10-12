# Agents that try to break a new adapter

**Value** Medium · **Size** M–L · **Needs first** —

**What.** A repo skill that sets separate agents on a new site's adapter to break it and fix it, between the
builder's tests and the first live run.

**Why.** One agent writing an adapter and judging it too sees what it meant to build, not what it built; nothing
between the builder's tests and a live run with the user's account tries to break it.

**Plan.**
1. Bring the live-check script into the repo (`scripts/live-check/`), its machine paths made options.
2. Named variants of saved pages that reproduce how sites misbehave.
3. A `break-adapter` skill looping a runner and an improver subagent until a round finds nothing new.
