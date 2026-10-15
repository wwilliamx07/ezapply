# Carried over from a previous application

Some sites (`use_last_application`, a returning candidate's profile) pre-fill fields from the user's last
application, so a field that already has a value may belong to another job. `fill_fields` only adds to
multi-selects and `upload_file` only adds files, so clear first:
- **File fields:** any attached file this application didn't upload (check `form-log.jsonl` for this posting's
  `upload` events) is stale, even when its name matches, e.g. another job's `cover.pdf`.
  `remove_items { fieldId, values?, reason? }` it (no `values` clears the field), then `upload_file { fieldId, path }`
  the current document. Remove a stale file even when this posting wants no document in that field.
- **Multi-selects such as Skills:** decide the list this application should have (from `profile.yaml` and the
  posting), `remove_items` the entries that don't belong, then `fill_fields { fills: [{ fieldId, value, source }] }`
  the missing ones.
- Text, dropdowns and radios are simply overwritten by a fill; check that pre-filled ones match the profile.
- Give a `reason` (e.g. "left from a previous application") and list what you removed in the step's report.
