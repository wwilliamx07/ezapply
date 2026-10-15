# CI timeouts on Windows

**What.** CI fails now and then on `windows-latest` with timeouts in tests that pass locally: `e2e.test.ts`'s
`waitUntil` ("timed out", waiting for a review page to open) and `cli.test.ts`'s "has no daemon commands" (past
vitest's 20 s `testTimeout`). A failure on one OS also cancels the other's run.

**Why.** Windows runners are several times slower at starting processes and at file I/O. `waitUntil` gives up after
5 s, and the CLI test spawns `ezapply` seven times in a row, each a fresh Node start. Both limits fit a developer's
machine, not a shared runner. The matrix's default `fail-fast` cancels the other OS's job.

**Plan.**
1. `waitUntil`'s default and the process-spawning tests' timeouts scale on CI (say 4× when `process.env.CI` is set),
   or those suites get their own longer timeout; the limits stay short locally, so a real hang still shows fast.
2. `strategy.fail-fast: false` in `.github/workflows/ci.yml`.
3. Make the CLI test spawn fewer processes (one call that tries every removed command, or a direct call to the
   argument parser).

[details](details.md)
