# "Locked by another program" when nothing holds the file

**What.** `posting_update_meta` and other writes fail with "`…\meta.json` is locked by another program. Ask the user
to close the file in the program showing it (PDF viewers lock open files)". Nearly all of these errors name a
posting's `meta.json`, which no viewer holds open.

**Why.** `writeFileAtomic` (`companion/src/util/fs.ts`) writes a temp file and renames it over the target. On
Windows that rename fails with `EPERM`/`EBUSY` whenever any handle is open on the target for a moment, and
`writeFileAtomic` reports every such failure, on the first try, as a lock by another program. The postings
service serializes its own writes, but nothing serializes the reads: the panel's state reads every posting's
`meta.json` on each change, which the write itself sets off, and Defender or the indexer may scan a new file.

**Plan.**
1. Retry the rename on `EPERM`, `EBUSY` and `EACCES` with a short backoff (about 2 s in all, as graceful-fs does),
   and only then report a lock.
2. The hint names a viewer only for a PDF; for anything else it says to retry.
3. A test where the rename fails twice, then succeeds.

[details](details.md)
