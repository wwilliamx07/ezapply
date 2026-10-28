# A writing spec for claims: details

## The rules

Each claim's `claim` text:

1. **One fact.** One thing built, with how it works. Two things joined by "and" are two claims, unless the second
   is the mechanism of the first.
2. **Shape: verb, object, mechanism.** Starts with a past-tense action verb, no subject: "Built", "Designed",
   "Replaced", "Cut", not "I built", "Responsible for", "Worked on", "Helped with". Then what was built, then how
   ("backed by Redis Lua scripts", "with a per-tenant token bucket"). The result goes in `impact`, never in the text.
3. **Name things.** The technology, algorithm, protocol or standard by its public name ("sliding-window", "Postgres
   logical replication", "OAuth device flow"), not its category ("a caching layer", "a database", "various tools").
   The technologies tailoring should match go in the text: `claims_list` doesn't show `skills`, so a skill only in
   `skills` is invisible when claims are chosen. `skills` lists the text's technologies and the concepts it shows.
4. **No repo jargon.** No internal class, function, file or module names, and no project-specific abbreviations:
   they mean nothing on a resume and `files` already points at the code. "Built a plugin system that loads site
   adapters at runtime", not "Built `AdapterRegistry.load()`".
5. **No project name.** `claims_list` heads each repo's claims with its name; "In ezapply, …" repeats it.
6. **No filler or hedges.** Out: intensifiers and puffery (robust, scalable, efficient, seamless, powerful,
   comprehensive, cutting-edge, successfully, effectively), weak verbs (utilized, leveraged, facilitated, helped,
   assisted), vague quantities (various, several, multiple, many, numerous), and hedges (some, basic, simple). A
   quantity is the number the repo shows, or nothing.
7. **Numbers** in digits with units ("3 regions", "40 ms"), and only ones the code or docs contain (as now).
8. **Active voice**, one sentence, no closing period, 8–25 words.
9. **Distinct.** No two claims of a repo say the same thing at different sizes; keep the specific one.

`impact` follows rules 3–8 too, and states a result only ("p99 latency from 900 ms to 120 ms").

## What `claims_check` flags

A `warnings` array beside `errors` (`{ path, rule, message }`), with `valid` unchanged by it. Checked on the
`claim` text, and `impact` where it applies, of every claim not marked `user_edited`:

- `length`: fewer than 8 or more than 25 words (`claims.<i>.claim`).
- `filler`: a word from rule 6's lists, matched as a whole word, case-insensitive; the message names it.
- `opening`: starts with "I ", "We ", "Responsible for", "Worked on", "Helped", "Was ", or a word ending "-ing".
- `passive`: "was|were|been|being" followed by a word ending "-ed" (rough, so a warning only).
- `period`: ends with ".".
- `project-name`: the repo's name (the part after `/`, case-insensitive, and with `-`/`_` read as spaces) in the
  text.

Not checked by program: one fact, naming, jargon, distinctness. Those are the skill's own check.

## Changes

- `packages/companion/src/repos/service.ts`: `checkClaims` adds `warnings` (a `claimProse(claim, repo)` function
  beside it, or in its own `repos/claim-prose.ts` if it grows past a screen). `ClaimsCheck` gains the field.
  `markIndexed` keeps refusing on `errors` only.
- `packages/companion/src/mcp/tools/github.ts`: `claims_check`'s description mentions the warnings.
- `packages/cli/templates/skills/ezapply-index-repo/SKILL.md`: step 5 of the full index replaces "each one
  resume-bullet-sized fact" with the rules, compressed to a few lines (the list above is the long form; the skill
  carries what the agent needs to write and fix a claim). "Check and finish": fix every warning, in any claim, by
  rewording without changing the fact; where the fix needs a fact the run hasn't read (a count for "several"),
  drop the word instead of reading code for it. The example claim in both the skill and the reference already
  fits the rules; keep it.
- `references/components/knowledge-base.md`: the rules and their reasons go under Claims (the "why" is this item's
  Why: claims_list cost per posting, the text is all tailoring sees); Checks lists the warnings.
- `references/mcp-tools.md`: `claims_check`'s output.
- `references/status.md`: a Decisions line (own rules, not an outside spec; warnings, not errors).

Existing indexes: their claims get warnings on the next `claims_check`, which a re-index runs, so they're fixed
the next time each repo changes. No migration.

## Tests

`packages/companion/test/repos.test.ts`: a claim breaking each warned rule gets that warning and `valid` stays
true; a `user_edited` claim breaking them gets none; a clean claim (the example) gets none; `filler` matches whole
words only ("scalable" flagged, "scalability" not, unless listed); `project-name` matches `jane/proj-x` as "proj x".
