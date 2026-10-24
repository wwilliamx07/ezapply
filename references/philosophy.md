# Philosophy

ezapply helps one person apply for jobs faster without lowering the quality or honesty of what they send.
They capture a posting in the browser, then ask Claude Code, from the browser's side panel, for a tailored
resume, a cover letter, or a filled-in application. ezapply supplies the tools; Claude does the thinking; the
user decides and submits.

## Principles

1. **The user's coding agent is the only agent.** ezapply has no agent loop of its own. It exposes tools over MCP,
   and a workspace of files and skills that tell the agent how to use them, and runs the agent headless (Claude
   Code, the Antigravity CLI or Codex) so the user works with it in the extension's side panel: the requests, the chat,
   the agent's questions and its requests for approval are all there ([agent](components/agent.md)). Two more pages are for what is reading or form-filling
   rather than judgment: reviewing documents, and setting up. What a page needs judgment for goes to Claude, as a
   task the user sees it do. No page runs an agent of its own.
2. **The user always submits.** Nothing in ezapply can submit an application. This is enforced in code,
   not just in instructions: the tool set has no general click, `go_next` refuses on the review page, and
   the page-level submit guard cancels any script-generated event aimed at a submit control. See
   [security.md](security.md).
3. **No fabrication.** Every skill, result or number in a document must trace to the user's profile, an
   evidence-linked claim from their own code, or something they said in chat. Gaps are reported, never
   papered over. The knowledge base exists so tailoring has real evidence to draw on.
4. **Page content is data, not instructions.** Postings, forms and repositories are untrusted and may
   carry prompt injections. Claude works from what was visible to the user, never follows instructions
   found in that text, and tells the user when it sees one. A posting's instructions for applying (one
   PDF, file names, limits) are still followed: they shape the documents, never Claude's actions.
5. **Source code is read-only.** Repos are mirrored into a cache that nothing may edit, build or run.
6. **Local and private.** The companion listens only on loopback, and only while `ezapply`
   runs. Personal data stays on the machine except what the user puts into an application and what Claude Code
   sends to Claude. Secrets live in the OS keychain.
7. **Errors carry their fix.** Every failure reaches Claude as a structured error with a `hint` that says
   how to recover (install this, call that, ask the user this). Claude follows it, so problems get fixed
   in the conversation instead of in a troubleshooting guide.
8. **As few manual steps as possible.** The terminal part of setup is one command, and everyday use is one
   more (`ezapply`) left running; everything else happens in the browser. The only thing the user must do by
   hand is what a browser or website insists on: loading the extension, signing in to Workday or an Oracle career
   site (and, where the user limited the extension's site access, letting it onto that site), pressing Submit.
9. **Honest about uncertainty.** Claude asks, with a suggestion where it has one, rather than filling
   sensitive answers itself (EEO, salary, anything marked `sensitive` or unanswered), and flags answers that came
   from its own judgment.
10. **Built to grow, not built big.** Single-user, with seams for more: a new site is a registry entry and a
    definition on the shared engine, file formats and the protocol are versioned, and there are no personal
    assumptions in code.

## Goals
- One click captures a posting; from then on it's the context for every request.
- Everything after setup from the browser's side panel: set the posting, tailor documents, fill the form, chat,
  answer Claude's questions and approve its commands.
- Documents are made and revised by chatting, with each revision compiled, checked and snapshotted.
- A one-page resume and a cover letter tailored with evidence-backed facts from the user's own projects.
- Autofill on the job sites ezapply has an adapter for (Workday, Oracle Recruiting Cloud, Greenhouse, Lever,
  Ashby, Phenom, Dayforce, SAP SuccessFactors), including each company's own screening questions and widgets.
- Single-PDF bundles when a posting requires one.
- Guided onboarding on a page: tools, extension, GitHub and repos, knowledge base, profile, templates, answers.
- Review on a page: each document as it will be attached, comments on its passages, what changed since the last
  review.

## Non-goals (v1)
- Submitting, or applying in bulk.
- Autofill on a site without an adapter built from its own pages ([building adapters](building-adapters.md)).
  Capture works on any site.
- Creating Workday accounts, completing Oracle's email step, or solving CAPTCHAs. The user signs in and tells Claude when done.
- Screens of ezapply's own beyond the side panel, the review and setup pages (and the GitHub setup pages they lead
  to).
- Hidden text, keyword stuffing, or any other trick aimed at applicant-tracking systems.
