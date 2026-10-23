# Agents that try to break a new adapter

**What.** A repo skill that sets separate agents on a new site's adapter to break it and fix it, between the
builder's tests and the first live run.

**Why.** One agent writing an adapter and judging it too sees what it meant to build, not what it built; nothing
between the builder's tests and a live run with the user's account tries to break it.

**Plan.**
- Run against the site's clone from the adapter harness, not saved pages or a live site.
- Named variants of a clone's behaviour that reproduce how sites misbehave.
- A skill looping a runner and an improver subagent until a round finds nothing new.
