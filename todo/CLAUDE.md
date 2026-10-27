# todo/: rules for keeping it

`todo.md` is the map: every item, the order of execution, and each
one's value and size. Each item has its own directory with `overview.md` and `details.md`. Keep it all as lean as
possible.

- **`overview.md` is high level and concise:** what, why and the approach in a few lines, readable without knowing
  the code. No file names, functions, error codes, constants or numbered implementation steps.
- **`details.md` is the low-level implementation:** the files and functions to change, the mechanism, edge cases,
  numbers, steps and the tests to add.
- **When an item is built, delete its directory and its row in the map** (and in its group) in the same change
  that documents it in `references/`. What still needs a live run goes into `references/status.md`, and open
  questions about the built behaviour go on the reference page for that part, or into `status.md`.
- **When part of an item is built, cut the item down to what's left,** in both its files and its size in the map.
  No "built on…" notes, struck-through steps, progress history or "Left:" lists of verification.
- **Refer to items by title, not number,** from `references/` and code.
