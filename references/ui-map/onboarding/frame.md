# Every step

"Set up ezapply", how many required steps are done and a progress bar; the steps, done ones ticked and optional
ones marked; the step shown, with Back and Next under it; the agent's pane (listening or not, its tasks). A missing
`EZAPPLY.md` shows as a banner. The address's hash names the step shown.

**Marker:** `role=heading[name="Set up ezapply"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Finish setup | | `role=button[name=/^Finish (setup\|later)$/]` | `finish`: ends the agent's wait (Finish later while required steps remain) | [Finished](finished.md) |
| LaTeX | | `css=.ob-nav li:nth-child(1) button` | Shows the step | [LaTeX](tex.md) |
| Browser extension | | `css=.ob-nav li:nth-child(2) button` | Shows the step | [Browser extension](extension.md) |
| GitHub | | `css=.ob-nav li:nth-child(3) button` | Shows the step | [GitHub](github.md) |
| Repositories | | `css=.ob-nav li:nth-child(4) button` | Shows the step | [Repositories](repos.md) |
| Your projects, read | | `css=.ob-nav li:nth-child(5) button` | Shows the step | [Your projects, read](knowledge.md) |
| Your resume | | `css=.ob-nav li:nth-child(6) button` | Shows the step | [Your resume](resume.md) |
| Your profile | | `css=.ob-nav li:nth-child(7) button` | Shows the step | [Your profile](profile.md) |
| Cover letter | | `css=.ob-nav li:nth-child(8) button` | Shows the step | [Cover letter](cover.md) |
| Screening questions | | `css=.ob-nav li:nth-child(9) button` | Shows the step | [Screening questions](answers.md) |
| Preferences | | `css=.ob-nav li:nth-child(10) button` | Shows the step | [Preferences](preferences.md) |
| Library | | `css=.ob-nav li:nth-child(11) button` | Shows the step | [Library](library.md) |
| Back | not the first step | `role=button[name="Back"s]` | The step before | stays |
| Next | not the last step | `role=button[name=/^Next: /]` | The step after | stays |
