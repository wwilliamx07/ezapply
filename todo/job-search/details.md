# Job search across the boards ezapply knows: details

**What.** Find new postings that fit the user, from the employers they care about, without visiting each careers
page: a list to pick from, each captured as a posting with one word.

**How.**
- **Sources are the boards' public job lists**, per registry site: Greenhouse's Job Board API, Lever's postings
  API, Ashby's public job board API, Workday's careers-site JSON, Oracle's requisitions REST. A companion module
  (`search/`) gains a `listJobs(tenant)` per registry site (`packages/sites`), so a new site covers itself. No scraping of
  LinkedIn, Indeed or other aggregators: their terms forbid it and they block headless clients; the live-check
  rule against bot-protection workarounds holds here too.
- **Which employers:** a watch list in the profile (`profile/watchlist.yaml`: company, site, tenant), seeded from
  the tenants of past postings and grown by the user ("watch Acme's Greenhouse board").
- **Matching** in two passes: a deterministic filter from `jobPreferences` (locations, work mode) and keywords the
  user sets (titles, seniority, exclusions), then the agent ranks what's left against the profile and says why.
- **Dedupe** by canonical URL against `search/seen.jsonl` and existing postings, so a job is shown once.
- **Tools:** `jobs_search { companies?, query? }` returns new matches; `posting_capture_url { url }` captures a
  chosen one without the browser, from the board's JSON (its description is the posting text), so
  the posting folder is the same as a capture's.

**Challenges and open questions.**
- Discovery: the boards have no search across employers, so the watch list is as good as the user makes it.
- Workday's and Oracle's JSON endpoints are the careers sites' own, not published APIs; they can change without
  notice. Rate-limit and cache politely.
- A posting captured from JSON has no visible-HTML step; its description is still untrusted, so the
  prompt-injection rules apply unchanged.
