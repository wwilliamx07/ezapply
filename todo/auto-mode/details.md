# Auto mode: details

**What.** The agent searches regularly, drafts the documents for strong matches, fills each application, and leaves
it at the review step, so that applying is the user checking it and pressing Submit.

**How.**
- **The agent:** the alerts job, on new matches above a score, starts Claude Code headless (`claude -p`) in the
  workspace with an `ezapply-auto` skill. Claude Code stays the only agent; ezapply gains a trigger, not a loop.
- **Per match:** capture, tailor the resume and cover letter with the existing skills, compile and check. Anything
  the agent would ask about (a sensitive or unanswered question, a gap in the evidence, a document it isn't sure
  of) goes into a queue rather than being guessed.
- **Filling:** a browser the companion starts for this (its own profile, with the extension loaded and the user's
  sessions on the sites), filling through the same tools and adapters up to the review step, never past it. A tab in
  a truly headless browser can't be handed to the user, so it runs as a window kept in the background.
- **The queue** (the tracker's page or the `ezapply-status` skill): each application ready to submit, with its
  documents to approve on the review page, its questions to answer, and the tab to open. Submit stays the user's
  press; the guard is unchanged.
- **Limits:** a daily cap, a minimum match score, and nothing for an employer already applied to.

**Challenges and open questions.**
- It goes against the philosophy as written: "the user decides" becomes "the user checks", and "applying in bulk"
  is a non-goal. Adopt it only by changing `philosophy.md` first, and keep the honesty rules (no fabrication, ask
  rather than guess) as hard as they are now.
- Sessions: Workday wants an account per employer and Oracle an email code each time, and signing in and signing up
  stay the user's, so most applications stop at sign-in until the user signs in.
- Documents drafted without the user's chat lose the corrections they'd give along the way. The review page and
  its view of what changed since the last review carry the weight.
- Tokens: each application is a full tailoring and filling run. The cap bounds the cost.
