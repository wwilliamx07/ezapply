# Application tracker: progress and outcomes

**Value** Medium · **Size** M · **Needs first** — · Part of the application manager

**What.** "What's in flight?": each posting's progress, deadline, date submitted, what the employer did after, and
the next action.

**Why.** ezapply already keeps each application's record but nothing shows where they all stand, or records what
happened after submitting.

**Plan.**
1. An optional `outcome` in `meta.json`, beside `status`, set by the user through the agent.
2. `postings_list` gains deadline, submitted date, outcome, filters and sorting.
3. Views: an `ezapply-status` skill, `ezapply status --postings`, perhaps a read-only page.
