# Carried over from a previous application

Some sites pre-fill fields from the user's last application, so a value may belong to another job. A fill only adds
to multi-selects and an upload only adds files, so clear first:
- **`stale` files** (ones this application didn't upload, even with a current document's name):
  `remove_items { fieldId, values?, reason? }` them, then upload the current document. Remove them even when this
  posting wants no document in that field.
- **Multi-selects such as Skills:** decide the list this application should have, `remove_items` what doesn't
  belong, then fill what's missing.
- **`prefilled` text, dropdowns and radios** are overwritten by a fill: check each against the profile.
- Give a `reason` ("left from a previous application"): the hand-off card lists what was removed.
