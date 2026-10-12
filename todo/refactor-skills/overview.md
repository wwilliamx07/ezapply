# Refactor the skills for agent performance

**What.** Rework the workspace skills (`packages/cli/templates/skills/`) so the agent applying for the user does
better with them.

**Why.** The skills are the agent's instructions for every flow; their length and structure bear on how well it
follows them.

**Plan.**
1. After "Remove the onboarding and repos skills", take stock of the skills left.
2. Restructure each for the agent's performance, keeping the honesty rules as they are.
3. Update the references describing each skill.
