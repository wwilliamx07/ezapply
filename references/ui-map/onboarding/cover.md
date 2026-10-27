# Cover letter

Keep the template (ezapply's, with name and contact put in, its look matched to the resume, or a preview), use one's
own LaTeX letter ([the import](import.md)), or copy the layout of an example letter. A preview under it, and where
to ask for any other change.

**Marker:** `css=.ob-step >> role=heading[name=/^Cover letter template$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Keep the letter | | `role=radio[name=/^Keep /]` | The choice (the default) | same |
| Use my own LaTeX cover letter | | `role=radio[name=/Use my own LaTeX/]` | Shows the import | same |
| Copy the layout of a letter I like | | `role=radio[name=/Copy the layout/]` | Shows where to drop the example | same |
| Put my name and contact in it | keeping ezapply's letter | `role=button[name=/Put my name and contact in it/]` | `coverIdentity`, then the build (disabled until the profile is valid) | stays |
| Match my resume's look | keeping the letter | `role=button[name="Match my resume's look"]` | Task `restyle-cover` (disabled until a resume is imported) | stays |
| Show a preview | keeping the letter | `role=button[name=/Show a preview/]` | `compile { kind: cover }` | stays |
| Choose… | copying an example's layout | `css=.ob-drop >> role=button[name=/Choose…/]` | The browser's picker: the file into `library/`, then task `cover-from-example` | the file chooser |
