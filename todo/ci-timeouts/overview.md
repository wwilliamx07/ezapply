# CI timeouts on Windows

**What.** CI fails now and then on Windows runners with timeouts in tests that pass locally: the end-to-end tests'
waits ("timed out", waiting for a review page to open). A failure on one OS also cancels the other's run.

**Why.** Windows runners are several times slower at starting processes and at file I/O. The waits give up after
a few seconds. The limits fit a developer's machine, not a shared runner.

**Plan.**
- The tests' waits and the process-spawning tests' timeouts scale up on CI, or those suites get a longer timeout;
  the limits stay short locally, so a real hang still shows fast.
- A failure on one OS leaves the other's run going.

[details](details.md)
