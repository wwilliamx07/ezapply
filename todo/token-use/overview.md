# Cut the tokens a panel conversation spends

**What.** Lower what a tailoring and an application cost in tokens, mostly by shrinking the context every API call
re-reads and by taking fewer turns.

**Why.** Nearly all of a run's tokens are cache reads: the whole context, re-read on every call. In two recent runs
(a tailoring, and a tailoring then an application in one session) the fixed starting context alone (~29.7k
tokens) was 43–55% of them. Output was small. So each turn saved and each token cut from the prefix is multiplied by every later call.

**Plan.**
1. Measure, then trim the prefix: keep the user's own Claude Code setup (personal plugins and skills, claude.ai
   connectors, unused built-in tools) out of the panel's process through `agentArgs`.
2. Fewer form turns: delete `list_options`, make a `fill_fields` miss the query (closest options, full paths in
   nested menus).
3. Cut `EZAPPLY.md` and `ezapply-apply` to what every call needs; edits and their compile in one message; a
   subagent that reads the claims and the posting and returns only the evidence map.
4. Run a tailoring and an application and compare tokens and turns with the runs in [details](details.md).
