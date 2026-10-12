# Job alerts: details

**What.** Tell the user when a new posting matching their search appears, without a chat open. Deadline reminders
from the tracker ride along.

**How.** The companion runs only inside `ezapply`, and Claude Code's scheduled tasks only while a session is
open, so alerts need the OS scheduler. `ezapply alerts on` registers a job (Task Scheduler, launchd, a systemd timer
or cron) that runs `ezapply search --new`: the deterministic pass of the job search only, no Claude, no tokens. New
matches go to `search/new.jsonl` and an OS notification ("3 new postings at Acme, Globex"); deadlines within two
days get one too. The next `ezapply` lists them first, as it does workspace changes, for the agent to rank.
`ezapply alerts off` removes the job.

**Challenges and open questions.**
- Registering a scheduled job differs per OS and may need the user's approval; `ezapply doctor` should report it.
- How often: daily is enough for most boards; more risks rate limits.
- Email or phone alerts need a sender or a service, which ezapply avoids: start with OS notifications.
