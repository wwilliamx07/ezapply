# An adapter harness: local clones of real application forms: details

What's built is in `references/harness.md`. Every milestone is checked with `npm run clone` and `npm run fill` and
recorded in the clone's report.

## Milestones

1. **Lever and Ashby clones are usable** (Greenhouse's is). For each: `npm run clone -- <url>` with nothing else
   from the user; `<site>/clone.ts` written from `proposed-clone.ts`, listed in `CLONE_DESCRIPTIONS`;
   `npm run clone -- --check <site>` reports it usable (opens offline, 100% of recorded and held-out requests
   answered as the site did). The coverage report shows every field touched, every list's option count equal to
   the live page's, every search stable, every conditional section reached. Greenhouse's falls short of that in two
   ways that need a decision rather than a fix: its location geocoder never settles (a world of places, still
   growing at `--max-queries`), and its files go untouched because attaching sends them.
2. **Fill runs catch breakage (the same three).** The scripted fill reaches the hand-off with every value read
   back; each of a set of deliberate adapter breaks (a wrong selector, a removed wait, a wrong option match) fails
   it; a run at `--latency 0` takes under two minutes. Add the breaks as a test that skips without the clones.
3. **Sites behind an account (Workday, then Oracle).** The same checks, across multi-step saves, nested prompts and
   searches, with the URL and one sign-in as the user's only touches.
4. **The remaining sites (Phenom, Dayforce, SuccessFactors),** each needing only its `clone.ts` and, at most, an
   explorer option.
5. **Part of the process.** `building-adapters.md` gains "Clone it" between "Tests" and "Check it live";
   `development.md` gains the rule (fill the affected site's clone after any adapter or filling change, before a
   live run); one `--agent` run on the Workday clone reaches the hand-off.

## What real sites will need

- **Nested choices** (`OptionInfo.hasChildren`, Workday's prompts): the explorer picks a parent and walks its
  children, every branch; `explore.ts`'s `optionsOf` stops at the first level today.
- **Saves returned on reload:** the stand-in keeps what a `save` sent (`StandIn.saved`) but answers later loads only
  as recorded. A `load` kind (or a hook) that merges the session's saves into the recorded answer, for a site that
  rebuilds a step from the server after Back.
- **Per-site hooks as code:** the description's `explorer` and per-endpoint options are data; a site whose request
  fits no kind needs a `respond(req, ctx)` hook on its endpoint, and the explorer a hook for widgets `get_form`
  doesn't expose.
- **Timing check:** the report gives each endpoint's recorded median and spread; add a fill run at `--latency 1`
  that measures the stand-in's answers and fails an endpoint whose median is more than 10% off.
- **Lists loaded in chunks** rely on the adapter's `listOptions` reading to the end; check on the first site that
  pages its lists.

## Agent fill runs (`npm run fill -- --agent`)

Load the built extension (`--load-extension`, Playwright's Chromium: Chrome stable no longer loads unpacked
extensions from the command line), start a companion in a scratch workspace with the placeholder profile, pair
them, and have the panel's agent fill the clone as an application to the hand-off. Report its debug records with
`ezapply debug report`.

**Open.** Server checks only Submit runs can't be explored; when a clone is redone after its site changes (when a
real run fails against what the clone passed, or on a schedule); sites that challenge a Playwright-launched
browser can't be cloned and stay on saved pages.

**References when built:** `harness.md`, `development.md`, `building-adapters.md`, `status.md`.
