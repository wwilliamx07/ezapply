---
name: ezapply-repos
description: Choose which GitHub repositories feed the project knowledge base, or change the selection later. Use when the user wants to add or remove repos, or during onboarding.
---

# Repository selection

1. `github_status`. If not logged in, run `github_login` / `github_login_wait` first.
2. `github_list_repos`. Show a compact numbered table: name, private/public, language, last push (month and
   year), description (truncated), already selected ✓.
3. Propose a default selection and say why in one line. Leave out:
   - forks with no commits by the user
   - archived repos
   - empty or tiny repos (size under 10 KB)
   - dotfiles, config and course-template repos
   - profile README repos (`<user>/<user>`)
4. The user replies in plain language ("all except 3 and 7", "add 12", "just the top five"). Confirm the
   final list in one line, then call `repos_selection_set`.
5. If a repo they expect is missing, the app lacks access. Give them `github_status.manageUrl` to grant it,
   then list again. For public repos they contributed to but don't own, add them with
   `source: "public-url"`.
6. Offer to index newly selected repos now (the **ezapply-index-repo** skill). For repos that were removed, ask
   whether to delete `knowledge/<owner>__<name>/`.
