# A harness that runs the user flows

**What.** After a large set of changes, the agent tests them itself: it builds and runs the extension live, clicks
through every flow, and takes screenshots at each point. Or, instead of live work, a mockup of every UI where the
agent's replies, repo indexing and the like are stand-in responses.

**Why.** Today a change to the panel, the review or onboarding is checked by the user clicking through it. A harness
lets the agent see its own change working before handing it over.

**Plan.**
- Choose between live (real extension, real agent) and mocked (every UI with canned responses), or both.
- A script per flow (onboarding, tailoring, review, filling) that drives it and screenshots each step.
- A command the agent runs after a change, and a rule in the development reference for when to run it.

[details](details.md)
