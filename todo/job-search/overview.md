# Job search across the boards ezapply knows

**Value** Medium · **Size** L · **Needs first** — (after the tracker) · Part of the application manager

**What.** Find new postings that fit the user, from the employers they care about, without visiting each careers
page, each captured as a posting with one word.

**Why.** Today a posting reaches ezapply only when the user opens it in the browser.

**Plan.**
1. Each registry site lists jobs from its board's public job list; no scraping of aggregators.
2. A watch list of employers in the profile.
3. A deterministic filter, then the agent ranks; dedupe against what's been seen.
4. Tools `jobs_search` and `posting_capture_url`.
