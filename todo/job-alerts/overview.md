# Job alerts

**Value** Medium · **Size** M · **Needs first** Job search · Part of the application manager

**What.** Tell the user when a new posting matching their search appears, without a chat open, with deadline
reminders from the tracker.

**Why.** The companion runs only inside `ezapply`, and Claude Code's scheduled tasks only while a session is open.

**Plan.**
1. `ezapply alerts on|off` registers an OS scheduler job running the job search's deterministic pass.
2. New matches go to a file and an OS notification; the next `ezapply` lists them first.
