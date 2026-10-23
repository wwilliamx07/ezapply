# A UI fuzzer with a map of the UI

**What.** After a change to the UI, the agent tests it itself: a fuzzer walks onboarding and every screen with
stand-in responses, guided by a map of where each button leads, and screenshots every state.

**Why.** Today a change to the panel, the review or onboarding is checked by the user clicking through it.

**Plan.**
- **The UI map:** a directory of short linked pages, in sections that follow the UI (onboarding, the side panel, the
  review page), one page per screen: what's on it, and where each button leads. Agents read it to find their way;
  the fuzzer checks the real UI against it, so it can't drift.
- **The fuzzer:** the UI served with canned replies for the agent, repo indexing and PDF builds, every reachable
  control pressed, a screenshot of every state. It fails on an error, a dead button, a control the map doesn't
  have, or a button that leads somewhere other than the map says. Fast and free, so it runs after every UI change.
- One command the agent runs and reads back, and a rule in the development reference for when to run it.

[details](details.md)
