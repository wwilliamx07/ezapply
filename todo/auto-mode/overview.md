# Auto mode

**What.** The agent searches regularly, drafts documents for strong matches, fills each application up to the
review step, so applying is the user checking it and pressing Submit.

**Why.** It would cut the user's time per application the most, if the quality holds without the user watching.

**Plan.**
- Change the philosophy first; keep the honesty rules as hard as now.
- The alerts job starts Claude Code headless with an auto skill on strong matches.
- Per match: capture, tailor, fill in a companion-started browser up to review; questions go to a queue.
- A queue view of applications ready to submit; limits on volume and score.
