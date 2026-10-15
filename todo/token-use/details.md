# Cut the tokens a panel conversation spends: details

## How runs are measured
From Claude Code's own transcripts of the workspace (`~/.claude/projects/<workspace>/<session>.jsonl`): each
assistant message's `usage`, each tool result's size weighted by the number of API calls after it (that's how
often it's re-read), and the `prompt_snapshot`, `skill_listing`, `instructions` and `deferred_tools_delta`
attachments for what the starting context holds. Sizes are characters / 4. A one-message `claude -p` run in the
workspace with `--output-format json` gives the starting context's size from its `usage`.

## The answer bank
- Before the cuts, `answers.yaml` (3.3k) read at a filling conversation's start was re-read on every later call.
- **The risk.** "Read the answer bank before asking" is in `EZAPPLY.md` because an agent once asked two questions
  the bank already held (`references/components/workspace.md`). Reading it late has to keep that from recurring:
  look an entry up before every `ask_user` card, not only when a hint is missing.
- **What to compare:** a run's tokens, and the questions it asked that the bank held, against a run that read the
  bank first.
