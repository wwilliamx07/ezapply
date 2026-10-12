# Minimal reliance on agent performance

**What.** Every agent flow relies as little as possible on how well the agent performs.

**Why.** What code can do mechanically is done the same way every time, costs no tokens, and doesn't vary with the
agent or its model.

**Plan.**
1. Go through each flow and mark the steps that need judgement and the ones that don't.
2. Move the mechanical steps into code (tools, pages, the CLI), leaving the agent the judgement.
3. "Remove the onboarding and repos skills" is the first case.
