# CI timeouts on Windows: details

- `waitUntil` (`e2e.test.ts`) gives up after 5 s: scale it and the process-spawning tests' timeouts on CI (say 4×
  when `process.env.CI` is set). `strategy.fail-fast: false` in `.github/workflows/ci.yml`.
- The job has no `timeout-minutes`; GitHub's 6-hour default is fine, nothing hangs that long.
- The GitHub Actions annotations also warn that `actions/checkout@v4` and `actions/setup-node@v4` target Node 20,
  which runners now force onto Node 24: move to the versions that target Node 24 in the same change.
- Check after: a few runs in a row green on both OSes.

**References when built:** `development.md` (tests and CI).
