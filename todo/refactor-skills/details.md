# Refactor the skills: details

The skills this item covers are the ones left after "Remove the onboarding and repos skills": `ezapply-resume`,
`-cover-letter`, `-bundle`, `-apply`, `-answers`, `-index-repo`, and `EZAPPLY.md`. The honesty rules don't
change: nothing is fabricated, sensitive and unanswered questions are asked, and the application is never
submitted. Nothing on a form is filled without the model (§3).

## Which steps are mechanical
| Skill | Mechanical, into code | Judgement, stays in the skill |
|---|---|---|
| resume, cover letter | `posting_active`; read the posting and requirements; copy the template's main and `contentFiles`; status `drafting`; compile after an edit; the `pdf_text` reading-order check; opening the review; quoting what changed since the last review | Correcting the capture's company and role; the evidence map and gaps; which bullets and projects, the wording, the angle; what to cut to fit; the self-check against evidence |
| bundle | The default order, labels, title, author and file name; merge; page and size checks; compress; `bundleRequired` | Whether a bundle is needed; the posting's own order; which `library/` extras and pages |
| answers | Validation (already `answers_check`); adding a `toSave` entry; adding a form's wording to `variants` once the user picks the entry | Merging duplicates; which entry a new wording belongs to, when that isn't exact |
| apply | Assembling each step's context (§4); pressing Apply on a posting page; marking prefilled fields and stale files; writing the answers the user confirmed into the bank; the hand-off card; moving from step to step | Every value, row, upload and question on the form; matching questions to the bank by meaning; polarity; free text; tailored experience descriptions; skills for the role; a field that won't take its value; what the user says mid-application |
| index-repo | Choosing between full index, re-index and rebuild from `repo_sync`; filtering out lock, generated and vendored paths; `claims_check` before marking indexed (already enforced) | Splitting into components; the docs; the claims and their confidence; how much of a diff to read |

## 1. Review and skill invocation
**The review opens itself.** The skills tell the agent to `review_documents` once a document is done, and it still
sometimes doesn't. Instead, when a turn of a posting's tailoring conversation ends (`turnEnd`), the attach mode is
`after-approval`, and a posting PDF's bytes differ from the last approved or reviewed version, the companion opens
the review page for those PDFs (`ReviewService`, as `review_documents { files }` does). The user's answer reaches the
tailoring conversation as a message, the way setup tasks do. That message carries the request, the comments, and the
`sinceReviewed` changes. The agent's report no longer quotes `pdf_text`, because the review page already marks the
changes. `review_documents` stays for the filling conversation, where `upload_file` refuses an unapproved document
and points to it. Approving still happens only on the page.

Decide: whether a compile that failed or ran over the page limit holds the review back. Leaning towards no: the page
shows `lint`, and holding it back is the failure this replaces.

**Buttons invoke their skill.** The panel's `REQUESTS` (Tailor documents, Fill form) send `/ezapply-resume …`,
`/ezapply-apply …` rather than words for the agent to match to a skill. Check first that Claude Code under
`-p --input-format stream-json` runs a skill named that way. If it doesn't, the request names the skill
explicitly.

## 2. Tailoring
**`document_start { kind }`** (`resume` | `cover`) for the active posting. It copies the template's main and
`contentFiles` into the posting folder (only if absent), sets status `drafting`, and returns the brief: the posting's
text, the `## Application requirements` block (or `missing`, so the agent writes it), `preferences.md`, the
profile's relevant parts, and `claims_list`. One call replaces five to seven reads and the skill's setup section.
The evidence map stays the agent's work. The subagent that "Cut the tokens" proposes for it reads from this
brief.

**Edits and compiles** follow "Cut the tokens a panel conversation spends" (an edit and its compile in one
message, then `tex_edit`). Whatever it lands is the starting point here.

**`bundle_build { inputs?, extras?, output? }`** replaces `ezapply-bundle`. By default it uses cover, resume, then
the given `library/` extras. It recompiles a `.tex` newer than its PDF, labels and titles from the profile and
posting meta, names the file `<Last>_<First>_<Company>_Application.pdf`, merges, checks one page size and the
resume's single page, compresses to the limit, sets `bundleRequired`, and returns the sections. The review opens as in
§1. The decision to bundle stays in `EZAPPLY.md`'s application requirements, which name the tool. Without a skill,
the description of `pdf_merge` and the requirements cover what's left.

**"Build from an example"** (cover letter) becomes a supporting file beside the skill's `SKILL.md`, read only when the
user gives an example. If the setup page's cover step hands it over as a task, it goes in that task's `how`
instead.

## 3. Applying: code prepares, the model fills
**Nothing is filled without the model.** Deterministic autofill was removed for that reason (see `status.md`). It
saved values but not turns, and its label-pattern mistakes read back as clean fills. Every value, row, upload and
question stays the agent's. Code supplies the context, points out what to look at, writes down what the user
confirmed, and moves from step to step (§4). The saving comes from fewer turns and a shorter context, not from fewer
values.

- **Step context.** The companion assembles each step's brief (§4): the skill, the profile, the answer bank, the
  requirements and the step. The agent doesn't spend its first calls reading them.
- **Posting pages.** `get_form` on a `posting` page presses Apply and returns the page that follows, as the skill
  does every time. This is navigation, not a value. `start-choice` stays the agent's, since it's the user's
  preference.
- **Prefilled fields are marked.** `get_form` marks `prefilled` on every field holding a value the form log
  doesn't credit to this application, whether it came from the site's resume parsing (`autofill_with_resume`) or
  from a previous application. The checklist names them. The skill says that a prefilled field is checked like an
  empty one, and a prefilled work description is tailored like a new one. Today the agent sometimes leaves them
  as they came.
- **Stale files are marked.** `get_form` marks attached files this application didn't upload as `stale` (from
  the form log) rather than leaving the skill to have the agent read `form-log.jsonl`. The agent still removes
  them.
- **Confirmed answers are written by code.** `toSave` (answers the user marked to save that the bank has no entry
  for) is written to `answers.yaml` by the companion, with the form's wording as `canonical` or as a `variant` of
  the entry the card named. The writes wait until the hand-off, so the bank in the brief's prefix doesn't change
  mid-application (§4). Until then, the brief's tail carries the answers given in this application.
- **The hand-off is a panel card** built from `handoff`, not a message the agent composes. The agent adds one line
  for anything it couldn't fill.

The form tools' own turn savings (deleting `list_options`, and a `fill_fields` miss that returns the closest
options) are in "Cut the tokens a panel conversation spends".

## 4. One session per step
**Why.** A filling conversation re-reads every earlier step's form and fills on every call. Compaction doesn't help
soon enough.

**The prefix must match.** A fresh session saves only if its start is read from the prompt cache, and the cache
matches an exact token prefix. Reads the agent makes itself can't match: they come in a different order, with
different tool-call ids and different arguments, in every session. So the companion writes each step session's
first message itself, in a fixed order, from the most stable part to the least:

1. The `ezapply-apply` skill's text: the same for every application.
2. `profile.yaml`, then `answers.yaml`: the same until the user edits them, since mid-application saves wait for
   the hand-off (§3).
3. The posting: its id, the tab, and `## Application requirements` from `notes.md`. The same for every step of
   this application.
4. The tail, which differs per step: earlier steps as the form log summarises them (`handoff.steps`), answers the
   user gave in this application, what they said that applies to later steps (the agent writes those to `notes.md`
   under `## For this application`), and the step's `get_form`.

Parts 1 to 3 are byte-identical across the application's sessions, and parts 1 and 2 across applications. Before
them comes the prefix Claude Code builds (system prompt with `PANEL_PROMPT` and the `fill` line, tools, `CLAUDE.md`).
That prefix also has to stay the same: the same model, the same flags, and no setting changed mid-application,
which already ends a process for effort. The files are read from disk as they are, so the same content gives the same
bytes. When a file changes (the user edits their profile), the cache misses once and the next step matches again.

**The loop.** In a posting's `fill` conversation, the companion ends a step's session at the end of the turn in
which `go_next` advanced, and starts the next with that step's message. The loop is the companion's: no agent
decides to continue. It stops at the hand-off, on an error the agent reports, on Stop, or when the user writes. The
user's message goes to the current step's session, and anything that applies later goes into `notes.md` as above.
The panel shows the sessions as one conversation, with a divider per step. `conversations.json` keeps the sessions
in order, and Reset starts the application's conversation over.

**Rejected: a subagent per step**, driven by the filling conversation. The main agent would have to choose to
delegate on every step, which is the same reliance this item removes. A subagent's start can't be made to match the
prefix either, since the delegating agent writes it.

**Check first**, in a scratch workspace, with the transcripts' `usage`:
- Do two sessions started with the same message read parts 1 to 3 from the cache (`cache_read_input_tokens`)? Do
  they write only the tail? Claude Code puts its own context into the first message: the date, `system-reminder`
  blocks, deferred tool names. Find out whether any of it lands before parts 1 to 3 and varies between sessions. If
  it does, the brief goes where it can be matched, or the design changes before anything is built.
- Does a step's session cost less than the same step late in one long conversation, on a long Workday application?
  The comparison includes the cache write when a step waits on the user past the TTL, which token-use's
  `promptCacheTtl` note covers.

## 5. The skills themselves
- **Judgement only.** Each skill lists the decisions the agent makes, in order, and what each draws on. Code does
  the rest, and the tool's description covers how to call it. Rare branches go in supporting files beside
  `SKILL.md`: carried-over applications, building from an example, rebuilding an index after a force-push.
- **One place per rule.** `EZAPPLY.md` keeps only what applies in every conversation: untrusted content, no
  fabrication, application requirements, never submit, keep context lean. Everything about documents goes to the
  document skills, and everything about forms to `ezapply-apply`. Situational advice (`tabHidden`,
  `browserBehind`, `postingMismatch`) stays in the result's `hint` and is removed from the skills.
- **Descriptions** say when to use the skill and nothing more, so that they compete less with the user's own
  skills.
- **`ezapply-answers`** shrinks to merging duplicates and placing wordings, once `toSave` and `variants` are
  written by code. If the setup page's answers step shows and edits the bank, the skill goes.
- **`ezapply-index-repo`.** `repo_sync` returns `mode` (`current`, `reindex`, `full`, `rebuild`) and leaves the
  paths that can't change a fact out of `changedSince`. "A writing spec for claims and repo documentation" changes
  the claim rules after this item.
- **Sizes.** Aim for `ezapply-apply` under ~1.5k tokens and each document skill under ~1k. Compare with the sizes
  in "Cut the tokens a panel conversation spends".
- `cli/test/skill-calls.test.ts` checks every call shape, including those in supporting files.

## 6. Measuring and the references
Run a tailoring and a Workday application, measured as in "Cut the tokens a panel conversation spends". Compare
turns, tokens and the following: whether the review opened, questions asked that the bank already held, fields
left to the user, and fields filled wrong. The live run's checks go into `references/status.md`.

References: `workspace.md` (skills, `EZAPPLY.md`), `mcp-tools.md` (`document_start`, `bundle_build`, `get_form`'s `prefilled` and `stale`,
`repo_sync`'s `mode`; `ezapply-bundle` removed), `agent.md` (review messages, skill invocation, sessions per step),
`documents.md` (the review opening itself), `ui.md` (the hand-off card, step dividers), `flows.md`,
`profile-and-templates.md` (the bank written by code), and the decisions in `status.md`.
