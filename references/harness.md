# The adapter harness

Local clones of real application forms, so an adapter change is tested on a copy of the site rather than on the
user's next real application. A clone keeps the site's own front end and the answers its server gave; a stand-in
plays the server from them; and a fill run drives the site's built adapter through the clone as the agent would.
Greenhouse has a usable clone; what's still to build (the other sites' clones, agent fill runs) is the todo's "An
adapter harness: local clones of real application forms".

**Why.** Saved pages don't run the site's own scripts, so they can't show how a fill behaves (jsdom fixtures are
built from what the adapter expects: [tests](development.md#tests)), and a live check spends the user's time and
account. A clone runs the site's real code against answers the real server gave, offline and repeatably.

## Commands

| Command | Does |
|---|---|
| `npm run clone -- <posting-url> [--headless] [--max-queries <n>]` | Clones the posting's application into `.clones/<site>/<id>/` and prints whether it's usable. The site comes from the URL through the registry (any other URL is an employer's own form, read by the generic adapter). Headed by default, so the user can sign in where the site asks |
| `npm run clone -- --check <site\|clone-id>` | Runs a clone's checks again, after its site's description changed. No browser goes to the site |
| `npm run fill -- <site\|clone-id> [--latency <x>] [--headed]` | A scripted fill run on the site's newest usable clone (or the one named); `--latency` scales the recorded response times (0 fast, 1 as recorded, the default) |

Both need `npm run build` first (the fill uses the extension's built bundles) and a browser: Playwright's Chromium
(`npx playwright install chromium`), else the installed Edge or Chrome. Either works, since the harness injects the
adapter itself; the fallback is for machines whose policy won't run a downloaded browser.

## Where things live

```
scripts/harness/                 Node 24 runs it as TypeScript (type stripping); CLAUDE.md: its rules
  clone.ts, fill.ts              the two commands
  clone/                         run.ts (cloning and the checks), explore.ts, normalise.ts, propose.ts, check.ts
  standin/engine.ts              the stand-in: one engine for every site
  fill/run.ts                    scripted fill runs
  lib/                           browser.ts (launching, also for the UI fuzzer; the adapter, the recorder, serving),
                                 open.ts, store.ts, profile.ts
  test/                          the engine's tests, and the hand-written site (site/) the whole harness runs on
packages/sites/src/clones.ts     a site description's shape, and CLONE_DESCRIPTIONS
packages/sites/src/<site>/clone.ts  a cloned site's description (Greenhouse's so far)
.clones/                         git-ignored: .profile/ (the harness's browser profile), <site>/<id>/ (a clone)
```
A clone's directory: `clone.json` (site, URL, capture time, usable, the report), `exchanges.json` and `bodies/`
(every request and its answer), `live.png` and `live-form.json` (the first screen and `get_form` on the live
page), `offline.png`, `coverage.json`, `proposed-clone.ts`, and `runs/<time>/` for each fill run.

## Cloning

1. **The browser** gets a profile of its own (`.clones/.profile/`), so a sign-in made there lasts across clones of a
   site, with service workers blocked and the cache off so every request passes the recorder and reaches the site
   (with the cache on, the held-out path's files came from the explore pass's copies, with no body or a 304). It opens the URL; a bot challenge on
   screen stops the clone and says so (it is never worked around).
2. **The explorer** (`explore.ts`) drives the page through the site's adapter, as [the extension calls
   it](components/extension.md): the site's built bundle (`packages/extension/dist/<site>-main.js`) injected into
   the page's main world, then its methods called. It knows the page only through `get_form`'s facts, so it is the
   same for every site. On a posting or start page it presses Apply (or Apply Manually); on a sign-in page it waits,
   up to 15 minutes, for the user to sign in. On each step it:
   - fills every text field with an obviously fake value (`lib/profile.ts`, by the field's hint, else its prompt);
   - opens every list; where a list has nothing until typed in, searches it: the empty text, then every letter,
     then a letter more after each prefix whose results filled a page, until nothing new comes back or
     `--max-queries` runs out, and
     works out the matching rule (prefix, word, contains) from what came back;
   - picks each answer of a choice in turn (up to 12, `explorer.maxAnswers`), and fills the fields an answer opens
     before the next answer closes them. A search box's answers start with each one-letter search's top two
     results, as an agent picks after typing, so a page that confirms a choice with a request of its own
     (Greenhouse's location) has that request recorded for the choices a path makes;
   - attaches a placeholder PDF only where the site's description says the page keeps files until Submit
     (`explorer.uploads`), since other sites send the file on attaching;
   - presses Next with the step empty, and with an email that isn't one, for the site's own refusals; adds and
     removes a row; goes Back and forward.

   It stops at the hand-off (a review page, or a last page whose only way on is Submit) and never presses Submit:
   the adapter refuses to, and a request the description calls a submit is stopped before it leaves (by its
   method too, where it has one: Greenhouse's posting page is a GET of its submit's URL).
3. **The held-out path:** the URL opened again and filled once through with a second set of values and answers.
   It is recorded apart, to check the stand-in on requests it wasn't built from.
4. **What's kept** (`normalise.ts`): every http(s) request with its answer, the body byte for byte under its hash,
   what the explorer was doing when it was sent, and how long the site took to answer. Headers are cut to the few
   that decide an answer (content type, CORS, a redirect's target): never cookies or auth headers. A token the
   description names (a CSRF token) is replaced, wherever it appears, by a placeholder the stand-in swaps for one
   it issues. The exchanges stay whole rather than being split into per-endpoint files, so a corrected description
   needs only `--check`, not a new clone.
5. **The proposal** (`propose.ts`): the site's own requests (not its front-end files) grouped by URL pattern, each
   group's kind guessed from what the explorer was doing (a parameter that carried the typed text, with results
   in the answer, is a search; a request on Next a step; a write while filling a save; answers that varied with a
   parameter a list keyed by it), written as `proposed-clone.ts` for whoever writes the site's `clone.ts` to check.
6. **The checks** below, and the report.

A site that saves each step (Workday, Oracle) may be left with a draft holding the placeholder values; the report
says so.

## A site's description (`<site>/clone.ts`)

What each of the site's requests does, by URL pattern, in `CLONE_DESCRIPTIONS` (`packages/sites/src/clones.ts`,
which has the full shape). A request no endpoint matches is answered only from the saved front end, by its exact
method, URL (cache busters aside) and body.

Each endpoint's kind (`EndpointKind`, in the same file) decides how the stand-in answers a request it hasn't seen
exactly; a `submit` is never answered, and seeing one fails the run.

A request seen exactly gets its recorded answers in the order the site gave them, so a list read before and after a
save comes back as it did. Parts of an answer that differ every time (timestamps, ids) are named in `volatile`, and
ignored by the checks; JSON is compared with its keys in any order. An answer that differs whole on every load (a
third party's script carrying a nonce or feature flags) is marked `varies`: answered as recorded, never compared.

## The stand-in (`standin/engine.ts`)

Every request the page sends goes to it, through Playwright's routing; nothing reaches a network. Each answer is held
for one of its endpoint's recorded times (static files by host), scaled by the latency, and the page's clock is
pinned to the capture time. A request with a token the stand-in didn't issue gets a 403. A request it can't answer
fails, and fails the run, naming the request: the clone is incomplete, and the explorer or the description gets
fixed.

## When a clone is usable

All of these, recorded in `clone.json`'s report:
- **It opens offline:** opened with no network, no request goes unanswered; the first screen differs from the live
  one in at most 1% of its pixels; and `get_form` reads the same as it did live.
- **The stand-in matches:** it answers every recorded request, and every request of the held-out path, as the site
  did.
- Exploring finished without stopping, and no submit was stopped.

A site without a description can still be cloned, to propose one; until its description is written, the held-out
path mostly fails, so the clone isn't usable.

## Fill runs (`fill/run.ts`)

The site's adapter, with debug mode's trace on, fills every field of every step with the placeholder values (the
first option of a choice, a file only where the site keeps it), the form read again after each so fields an answer
opens are filled too; adds and removes a row; and goes on with Next until the hand-off. It passes when every fill
reads back what was written, the hand-off is reached, the stand-in answered every request, and the guard blocked no
synthetic Submit. A value reads back in the page's own formatting: the same letters and digits (a phone shown as
"555-0100"), or for a choice one label the start of the other (Greenhouse's country shows "United States" for its
option "United States +1"), as the engine matches options. A screenshot per step, every call's trace and the report go into the clone's `runs/`.

It runs the adapter, not the extension's background or the companion: those don't change with a site, and driving
them needs a paired companion. A fill run by the panel's agent is still to build (the todo's "An adapter harness: local clones of real application forms").

## Tests

`scripts/harness/test/` runs on a small hand-written site (`test/site/`: lists from its server, a list that depends
on another, a search as you type, a section an answer opens, saves with a token), whose server is a function.
`standin.test.ts` covers the engine, what a clone keeps and the proposal, with no browser. `harness.test.ts` clones
the site through the generic adapter, checks the clone, fills it, and fails a fill run on a clone missing an answer;
it skips without a browser or a built extension, as in CI.
