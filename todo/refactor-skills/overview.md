# Refactor the skills for agent performance

**What.** Code does every step that needs no judgement: tools, the companion and the panel. The skills hold only
what does, written for the agent to follow. Every value on a form is still the model's. The application is filled
one step per fresh session, driven by the companion, each session starting from a prefix the prompt cache matches.

**Why.** A mechanical step done in code is done the same way every time, costs no turns or tokens, and doesn't
depend on the model. The agent still sometimes skips the review, and a long application re-reads every earlier
step's form on every call. Fields that the site prefills from the resume are often left as they came.

**Plan.**
- The companion opens the review when a tailoring turn leaves a changed PDF, and sends the answer back as a
  message. The panel's buttons invoke their skill by name.
- Tailoring: one call sets a document up and returns its brief. The bundle skill becomes one tool.
- Applying: Reading a form marks prefilled fields and stale files. Code writes the answers the user confirmed, and
  the panel shows the hand-off. Nothing is filled without the model.
- Each step runs in a fresh session. The companion writes its first message in a fixed order (skill, profile,
  answers, posting, then the step), so everything before the step matches the cache. Check that it does before
  building it.
- Rewrite each remaining skill to its judgement.
- Code checks what a program can under the agent's own checks: numbers and skills without evidence, missing
  sources, words the user said never to use, sensitive answers not asked, separate files where one is required,
  claims the user edited.
- Measure a tailoring and an application against the token cuts' runs, then
  update the references.

[details](details.md)
