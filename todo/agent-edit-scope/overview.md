# Keep the agent's edits to the files its task may touch

**What.** A panel conversation can edit any file in the workspace: templates, the profile, captures, another
posting's documents, the agent's own instructions and settings, and the skills. Only the repo cache is denied.

**Why.** The rules that it mustn't ("never edit templates while tailoring", "never edit a capture", the filling
conversation doesn't write documents) are prose in the agent file and the conversations' prompts. In Auto mode, the
default, Claude Code's classifier allows edits inside the working directory, so nothing stops an edit the prose
forbids, including one a posting's text talks the agent into. Bash can write files too, past any Edit rule.

**Plan.**
- Per conversation, deny rules passed with the process: a posting's tailoring conversation may edit only its
  posting's folder (not the capture or the metadata); the filling one writes no files; the general conversation
  keeps today's rules (setup writes the profile and templates through tools anyway).
- Always denied: the agent's own settings and instructions, and ezapply's config.
- File writes through Bash: a hook, or denying the shell's write forms, decided once the first two are in; measure
  what the agent uses Bash for first.
- Tests for each part.

[details](details.md)
