# Application tracker: progress and outcomes: details

**What.** "What's in flight?": each posting's progress (drafted, filled, submitted), deadline, date submitted, what
happened after (applied, interviewing, rejected, offer, withdrawn), and the next action. Postings drafted but not
applied to show up as such.

**How.**
- **Outcomes**, beside `status` rather than in it: `status` is ezapply's own progress, moved forward by the form
  tools; an outcome is what the employer did, told by the user. `meta.json` gains an optional `outcome { state,
  at, note? }` with a short `outcomes[]` history (`interviewing`, `rejected`, `offer`, `withdrawn`, `no-response`),
  set through `posting_update_meta` when the user says "Acme turned me down" (the agent finds the posting with
  `postings_list { company }`). Optional, so no `schemaVersion` bump.
- **The list:** `postings_list` gains `deadline`, `submittedAt` (from the log's confirmation step), `outcome`, and
  filters beside its `status` and `company` ones (not yet submitted, awaiting a reply, by outcome), sorted by deadline, then by date submitted.
- **Views:** an `ezapply-status` skill formats it in chat and suggests the next action per posting (tailor, review,
  fill, submit, follow up after N weeks with no reply). `ezapply status --postings` prints the same table without
  starting Claude, at no token cost. A read-only page on the companion's loopback server, beside the review page,
  could show it as a board by stage; it lives only while a chat is open.

**Challenges and open questions.**
- `deadline` is set only when the agent finds one in the posting, so many will be empty.
- Outcomes are set by hand; replies arrive by email, which ezapply doesn't read. The user can paste a reply into
  chat for the agent to record.
- Is a page worth it over the CLI table and the skill? A page on the UI package
  (`references/components/ui.md`) would cost little.
