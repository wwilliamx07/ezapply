# Refactor the skills: details

The skills this item covers: `ezapply-resume`,
`-cover-letter`, `-apply`, `-answers`, `-index-repo`, and `EZAPPLY.md`. The honesty rules don't
change: nothing is fabricated, sensitive and unanswered questions are asked, and the application is never
submitted. Nothing on a form is filled without the model.

## Which steps are mechanical
| Skill | Mechanical, into code | Judgement, stays in the skill |
|---|---|---|
| resume, cover letter | the `pdf_text` reading-order check; opening the review; quoting what changed since the last review | Correcting the capture's company and role; the evidence map and gaps; which bullets and projects, the wording, the angle; what to cut to fit; the self-check against evidence |
| answers | Validation (already `answers_check`) | Merging duplicates; which entry a new wording belongs to, when that isn't exact |
| apply | Dropping the steps code now does: pressing Apply, finding prefilled fields and stale files in the log, adding new bank entries, composing the hand-off | Every value, row, upload and question on the form; matching questions to the bank by meaning; polarity; free text; tailored experience descriptions; skills for the role; a field that won't take its value; what the user says mid-application |
| index-repo | Dropping the steps code now does: choosing the mode, filtering lock, generated and vendored paths, counting folders for the split | Naming and grouping the components; the docs; the claims and their confidence; how much of a diff to read |

## Tailoring
**"Build from an example"** (cover letter) becomes a supporting file beside the skill's `SKILL.md`, read only when the
user gives an example. If the setup page's cover step hands it over as a task, it goes in that task's `how`
instead.

## 4. The skills themselves
- **Judgement only.** Each skill lists the decisions the agent makes, in order, and what each draws on. Code does
  the rest, and the tool's description covers how to call it. Rare branches go in supporting files beside
  `SKILL.md`, as `ezapply-apply`'s already do: building from an example, rebuilding an index after a force-push.
- **Descriptions** say when to use the skill and nothing more, so that they compete less with the user's own
  skills.
- **`ezapply-answers`** shrinks to merging duplicates and placing wordings, now that new entries and `variants`
  are written by code. If the setup page's answers step shows and edits the bank, the skill goes.
- **`ezapply-index-repo`** follows `repo_sync`'s `mode` and `components` instead of working them out. "A writing
  spec for claims and repo documentation" changes the claim rules after this item.
- **Sizes.** Aim for `ezapply-apply` under ~1.5k tokens (now ~2.6k, characters / 4) and each document skill under
  ~1k (the resume and cover-letter skills are ~1.4k each).

## 6. Measuring and the references
Run a tailoring and a Workday application, measured from the transcripts as in "Cut the tokens a panel
conversation spends". Compare
turns, tokens and the following: whether the review opened, questions asked that the bank already held, fields
left to the user, and fields filled wrong. The live run's checks go into `references/status.md`.

References: `workspace.md` (skills, `EZAPPLY.md`), `knowledge-base.md` (the indexing procedure), `flows.md`, and
the decisions in `status.md`.
