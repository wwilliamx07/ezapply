# Cut the tokens a panel conversation spends

**What.** Read `profile/answers.yaml` only when the profile's hints don't cover a question, instead of whole at the
start of every application.

**Why.** It's about 3.3k tokens, read at the start and re-read on every later call: most of a filling
conversation's file reads. Deferred: it isn't clear yet whether reading it late hurts the agent (questions asked
that the bank holds, answers matched by meaning rather than by the one the agent looked up).

**Plan.**
1. After the token cuts' live run in `references/status.md`, decide from it whether the bank's read is still worth
   cutting.
2. If so, change `ezapply-apply`'s first step and `EZAPPLY.md`'s "read the answer bank before asking", and compare a
   run's tokens and questions asked with one before.

[details](details.md)
