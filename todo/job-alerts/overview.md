# Job alerts

**What.** Tell the user when a new posting matching their search appears, without a chat open, with deadline
reminders from the tracker.

**Why.** The companion runs only while ezapply does, and Claude Code's scheduled tasks only while a session is open.

**Plan.**
- A command registers (or removes) an OS scheduler job running the job search's deterministic pass.
- New matches go to a file and an OS notification; the next start lists them first.
