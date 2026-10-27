# The review page

The page a review opens in its own tab ([ui.md](../../components/ui.md#the-review-page-reviewid)): the
[documents and their panel](page.md), the selected one in [the viewer](document.md), comments made on its text,
and the answer sent after the last document is decided. A review already answered, replaced or expired shows a
page of its own.

| Page | The screen |
|---|---|
| [page.md](page.md) | The documents, the selected one's panel (checks, links, what changed, comments, the request) and its button |
| [document.md](document.md) | A readable document in the viewer: its toolbar, its links, its text |
| [comment-button.md](comment-button.md), [comment-note.md](comment-note.md) | Text selected, and the note being written |
| [comment-edit.md](comment-edit.md) | A comment's note being edited in the panel |
| [sent.md](sent.md), [answered.md](answered.md), [replaced.md](replaced.md), [expired.md](expired.md) | The answer sent; a review answered before, replaced by a newer one, or expired |

**Scenarios** (`scripts/fuzz/lib/scenarios.ts`): `review-open` (a two-page resume changed since the last review,
with links, a cover letter, and a file that isn't a PDF), `review-answered`, `review-replaced`, `review-expired`.
