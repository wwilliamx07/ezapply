# Refactor the skills for agent performance

**What.** Code does every step that needs no judgement: tools, the companion and the panel. The skills hold only
what does, written for any agent to follow. Every value on a form is still the model's.

**Why.** A mechanical step done in code is done the same way every time, costs no turns or tokens, and doesn't
depend on the model. Fields that the site prefills from the resume
are often left as they came. The skills still name one agent's tools.

**Plan.**
- Rewrite each remaining skill to its judgement, in words any agent follows. The example letter moves into the
  setup task that uses it.
- Code checks what a program can under the agent's own checks: numbers and skills without evidence, missing
  sources, words the user said never to use, claims the user edited.
- Measure a tailoring and an application against the token cuts' runs, on both agents, then update the
  references.

[details](details.md)
