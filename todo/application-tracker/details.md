# Application tracker: progress and outcomes: details

**What.** "What's in flight?": each posting's progress (drafted, filled, submitted), deadline, date submitted, what
happened after (interviewing, rejected, offer, withdrawn, no response), and the next action. Postings drafted but
not applied to show up as such.

**How.**
- **Outcomes**, beside `status` rather than in it: `status` is ezapply's own progress, moved forward by the form
  tools and the panel's **Mark submitted** / **Mark open**; an outcome is what the employer did, told by the user.
  `meta.json` gains an optional `outcome { state, at, note? }` with a short `outcomes[]` history (`interviewing`,
  `rejected`, `offer`, `withdrawn`, `no-response`). Optional, so no `schemaVersion` bump. Set from the posting
  popover in the panel (a `panel.setOutcome` beside `panel.markSubmitted`), or through `posting_update_meta` when
  the user says "Acme turned me down" (the agent finds the posting with `postings_list { company }`).
- **The panel's list** (`applications()` in `ui/src/panel/App.tsx`): rows show the deadline, the date submitted
  (from the log's `confirmation-seen` or `marked-submitted` event) and the outcome; Open sorts by deadline; Done
  shows the outcome, and a submitted row with no reply after a few weeks suggests a follow-up. The companion lists
  only the 20 newest postings (plus any a card waits on or the agent is in), so an older one awaiting a reply
  drops off: keep submitted postings without an outcome listed, or add a way to show all.
- **`postings_list`** gains `deadline`, `submittedAt`, `outcome`, and filters beside its `status` and `company`
  ones (not yet submitted, awaiting a reply, by outcome), for the agent.
- Not a `status` command or a page of its own: `cli.md` explains why there's no `status` command, and the panel
  already shows the list at no token cost.

**Challenges and open questions.**
- `deadline` is set only when the agent finds one in the posting, so many will be empty.
- Outcomes are set by hand; replies arrive by email, which ezapply doesn't read. The user can paste a reply into
  the chat for the agent to record.

**References when built:** `data-formats.md` (`meta.json`), `mcp-tools.md`, `components/ui.md` (the list),
`components/postings.md` (statuses).
