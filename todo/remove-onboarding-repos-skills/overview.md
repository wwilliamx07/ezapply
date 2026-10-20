# Remove the onboarding and repos skills

**What.** Drop the onboarding and repos skills. The setup page already does onboarding and
choosing repos; what's out of date in the workspace is shown on a card in the panel (and on the setup page), and
the user's choice there runs the update. The agent keeps only the updates that need judgement, as tasks.

**Why.** Choosing repos repeats a step the page has. Keeping the workspace current costs the agent a call at the
start of every session, and its rule of asking first lives in a prompt. On a card the user's yes is given before
anything changes, and nothing is spent when nothing changed.

**Plan.**
- Remove the repos skill and the onboarding half: the page adds a repo by its address and opens at a step.
- The companion shows the changes; code does the mechanical updates, the agent the rest as tasks.
- Remove the skill, clean it out of existing workspaces, and update the references.

[details](details.md)
