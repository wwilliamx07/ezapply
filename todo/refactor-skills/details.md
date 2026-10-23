# Refactor the skills: details

The skills this item covers: `ezapply-resume`,
`-cover-letter`, `-apply`, `-answers`, `-index-repo`, and `EZAPPLY.md`. The honesty rules don't
change: nothing is fabricated, sensitive and unanswered questions are asked, and the application is never
submitted. Nothing on a form is filled without the model (§3).

## Which steps are mechanical
| Skill | Mechanical, into code | Judgement, stays in the skill |
|---|---|---|
| resume, cover letter | the `pdf_text` reading-order check; opening the review; quoting what changed since the last review | Correcting the capture's company and role; the evidence map and gaps; which bullets and projects, the wording, the angle; what to cut to fit; the self-check against evidence |
| answers | Validation (already `answers_check`); adding a `toSave` entry; adding a form's wording to `variants` once the user picks the entry | Merging duplicates; which entry a new wording belongs to, when that isn't exact |
| apply | Pressing Apply on a posting page; marking prefilled fields and stale files; writing the answers the user confirmed into the bank; the hand-off card | Every value, row, upload and question on the form; matching questions to the bank by meaning; polarity; free text; tailored experience descriptions; skills for the role; a field that won't take its value; what the user says mid-application |
| index-repo | Choosing between full index, re-index and rebuild from `repo_sync`; filtering out lock, generated and vendored paths; `claims_check` before marking indexed (already enforced) | Splitting into components; the docs; the claims and their confidence; how much of a diff to read |

## Tailoring
**"Build from an example"** (cover letter) becomes a supporting file beside the skill's `SKILL.md`, read only when the
user gives an example. If the setup page's cover step hands it over as a task, it goes in that task's `how`
instead.

## 3. Applying: code prepares, the model fills
**Nothing is filled without the model** (the decision in `status.md`): filling from the profile without it saves
values but not turns, and its label-pattern mistakes read back as clean fills. Every value, row, upload and
question stays the agent's. Code points out what to look at and writes down what the user confirmed. The saving
comes from fewer turns, not from fewer values.

- **Posting pages.** `get_form` on a `posting` page presses Apply and returns the page that follows, as the skill
  does every time. This is navigation, not a value. `start-choice` stays the agent's, since it's the user's
  preference.
- **Prefilled fields are marked.** `get_form` marks `prefilled` on every field holding a value the form log
  doesn't credit to this application, whether it came from the site's resume parsing (`autofill_with_resume`) or
  from a previous application. The checklist names them. The skill says that a prefilled field is checked like an
  empty one (it already writes every work row's description for the posting). Today the agent sometimes leaves them
  as they came.
- **Stale files on the field.** `get_form`'s step warnings already name files this application didn't upload
  (`stepWarnings`); mark each such field `stale` as well, and drop the skill's reading of `form-log.jsonl` for it.
  The agent still removes them.
- **Confirmed answers are written by code.** `toSave` (answers the user marked to save that the bank has no entry
  for) is written to `answers.yaml` by the companion, with the form's wording as `canonical` or as a `variant` of
  the entry the card named. The writes happen at the hand-off, once the user has seen every answer.
- **The hand-off is a panel card** built from `handoff`, not a message the agent composes. The agent adds one line
  for anything it couldn't fill.

## 4. The skills themselves
- **Judgement only.** Each skill lists the decisions the agent makes, in order, and what each draws on. Code does
  the rest, and the tool's description covers how to call it. Rare branches go in supporting files beside
  `SKILL.md`, as `ezapply-apply`'s already do: building from an example, rebuilding an index after a force-push.
- **Descriptions** say when to use the skill and nothing more, so that they compete less with the user's own
  skills.
- **`ezapply-answers`** shrinks to merging duplicates and placing wordings, once `toSave` and `variants` are
  written by code. If the setup page's answers step shows and edits the bank, the skill goes.
- **`ezapply-index-repo`.** `repo_sync` returns `mode` (`current`, `reindex`, `full`, `rebuild`) and leaves the
  paths that can't change a fact out of `changedSince`. "A writing spec for claims and repo documentation" changes
  the claim rules after this item.
- **Sizes.** Aim for `ezapply-apply` under ~1.5k tokens (now ~2.6k, characters / 4) and each document skill under
  ~1k (the resume and cover-letter skills are ~1.4k each).

## 5. Checks under the judgement
The skills ask the agent to check its own work against rules a program can check. The check stays in the skill;
code adds a net under it that catches what the self-check misses, the way `review_documents` refuses an
underfilled resume. Each finding goes where the agent already looks (`tex_compile`'s `lint`, a tool's
refusal), with a `hint`.

- **Numbers without evidence.** A number in a changed line of a tailored `.tex` (against the template, as
  `tex_diff` compares) that appears in no claim, profile entry or the posting is a `lint` finding
  `unsourced-number`. The skills' "use only numbers in the evidence" stays; this catches the slips.
- **`% src:` comments.** Every changed or added bullet needs one, and each id must be a claim id from
  `claims_list` or a path in `profile.yaml`. Missing or unknown ids are `lint` findings, and `review_documents`
  refuses a document with any, as it refuses an underfilled one.
- **Never mention.** The terms under "Never mention" in `preferences.md`, matched as words in the tailored
  `.tex` text and in `fill_fields` values with `source: judgment`: a `lint` finding, and a warning on the fill
  result. The preference reaches the agent through `EZAPPLY.md` today and nothing checks it.
- **The skills line.** A skill in the resume's skills line that no claim's `skills`, profile `skills` entry or
  work highlight names is a `lint` finding `unbacked-skill`.
- **Sensitive answers are asked.** `fill_fields` refuses a fill whose `answerId` names an entry with
  `sensitive: true` unless its `source` is `user` and an `ask_user` card in this application returned it. The
  rule is the skill's ("ask for `sensitive: true`"); the agent sometimes fills the stored suggestion instead.
- **Exact bank matches.** `get_form` marks a question field whose label equals an `answers.yaml` `canonical` or
  variant (after normalising case and punctuation) with `bankMatch: answerId`. The model still decides the
  value, the polarity and the option; it stops spending turns finding exact matches, and a near-match by meaning
  stays its work.
- **Separate files on a bundled application.** `upload_file` refuses `resume.pdf` or `cover.pdf` on a posting
  with `bundleRequired`, pointing at the bundle.
- **Claims the user edited.** `claims_check` refuses a change to a claim with `user_edited: true` against the
  last indexed `claims.yaml`, so a re-index can't reword it; the skill's "ask the user" stays for a contradiction.
- **The component split.** `repo_sync` on a full index returns the folders over the depth policy's thresholds
  (15 source files or 2k lines, to depth 3), counted without the paths it filters out; the skill keeps naming
  and grouping them.
- **Explore and Plan.** `EZAPPLY.md` says to delegate reading only to general-purpose subagents, since the
  built-in Explore and Plan don't load it. Check whether the workspace's `.claude/settings.json` can deny those
  subagent types (a permission rule on `Agent`); if it can, the line goes.

Not checked by code, since a pattern would be wrong too often: polarity, attestations, matching a question to
the bank by meaning, the evidence map, and the profile's update from a resume diff.

## 6. Measuring and the references
Run a tailoring and a Workday application, measured from the transcripts as in "Cut the tokens a panel
conversation spends". Compare
turns, tokens and the following: whether the review opened, questions asked that the bank already held, fields
left to the user, and fields filled wrong. The live run's checks go into `references/status.md`.

References: `workspace.md` (skills, `EZAPPLY.md`), `mcp-tools.md` (`document_start`, `bundle_build`, `get_form`'s `prefilled` and `stale`,
`repo_sync`'s `mode` and component split; `fill_fields`' and `upload_file`'s refusals, `bankMatch`,
`claims_check`'s `user_edited` rule; `ezapply-bundle` removed), the `lint` findings in `documents.md`, `agent.md` (review messages, skill invocation),
`documents.md` (the review opening itself), `ui.md` (the hand-off card), `flows.md`,
`profile-and-templates.md` (the bank written by code), and the decisions in `status.md`.
