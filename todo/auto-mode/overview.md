# Auto mode

**Value** High if trusted, else Low · **Size** XL · **Needs first** Tracker, job search, alerts; a change to
`philosophy.md` · Part of the application manager, built last

**What.** The agent searches regularly, drafts documents for strong matches, fills each application up to the
review step, so applying is the user checking it and pressing Submit.

**Why.** It would cut the user's time per application the most, if the quality holds without the user watching.

**Plan.**
1. Change `philosophy.md` first; keep the honesty rules as hard as now.
2. The alerts job starts Claude Code headless with an `ezapply-auto` skill on strong matches.
3. Per match: capture, tailor, fill in a companion-started browser up to review; questions go to a queue.
4. A queue view of applications ready to submit; limits on volume and score.
