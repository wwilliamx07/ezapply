# A writing spec for claims

**What.** A short set of prose rules every claim is written to, so each one carries as many checkable facts per
word as it can: one fact, an action verb first, the named technology and mechanism, no filler, hedges or repo
jargon. The indexing skill states the rules, the claims check flags the ones a program can see, and index runs fix
what it flags.

**Why.** Every claim of every repo is loaded at the start of work on each posting, and tailoring chooses and
rewords from the claim text alone. A filler word costs tokens on every posting and tells the agent nothing; a
vague claim ("worked on the backend") can't be matched to a requirement or turned into a strong bullet. Claims
written today vary with whichever run wrote them.

**Approach.**
- No outside style guide: the general ones (Google's, Microsoft's) are for documentation read in full, not for
  atomic facts that become resume bullets. The rules follow resume-bullet practice: action, object, mechanism, with
  the result kept in its own field.
- The rules a program can check (length, banned filler, hedging words, first person, voice markers) are warnings
  from the claims check, not errors: indexing still finishes, and the user's own claims are never flagged.
- Documents don't paste claims: the resume and cover-letter skills already reword them toward the posting, and the
  cover letter writes them into sentences. No separate humanizing step.
- The knowledge base's component docs and README are out of scope: they're read only when a claim can't answer.
