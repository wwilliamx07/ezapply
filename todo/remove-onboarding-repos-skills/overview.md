# Remove the onboarding skill

**What.** Drop what is left of the onboarding skill, its triage of what's out of date. What's out of date in
the workspace is shown on a card in the panel (and on the setup page), and the user's choice there runs the
update. The agent keeps only the updates that need judgement, as tasks.

**Why.** Keeping the workspace current costs the agent a call at the start of every session, and its rule of
asking first lives in a prompt. On a card the user's yes is given before anything changes, and nothing is spent
when nothing changed.

**Plan.**
- The companion shows the changes; code does the mechanical updates, the agent the rest as tasks.
- Remove the skill, clean it out of existing workspaces, and update the references.

[details](details.md)
