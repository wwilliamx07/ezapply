# CI timeouts on Windows: details

- The other recent CI failure, `forms.test.ts` on Ubuntu, isn't a timeout: it's the race in "Form calls on a tab
  run out of order".
- The job has no `timeout-minutes`; GitHub's 6-hour default is fine, nothing hangs that long.
- The GitHub Actions annotations also warn that `actions/checkout@v4` and `actions/setup-node@v4` target Node 20,
  which runners now force onto Node 24: move to the versions that target Node 24 in the same change.
- Check after: a few runs in a row green on both OSes.

**References when built:** `development.md` (tests and CI).
