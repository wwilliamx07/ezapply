# Your profile

Without one: the agent drafts it from the resume. Then a form of every field the profile has, the often-asked ones
marked when empty, errors under their fields, lists (work, education, links, languages) with Add and Remove, and
Save profile. A draft that arrives replaces the form unless the user has started editing.

**Marker:** `css=.ob-step >> role=heading[name=/^Your profile$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Have the agent draft it from my resume | no profile yet | `role=button[name=/draft it from my resume$/]` | Task `draft-profile` (disabled until a resume is imported) | stays |
| A field | a profile exists | `css=.ob-step .ez-field input, .ob-step .ez-field select, .ob-step .ez-field textarea, .ob-step .ob-check input` | The field's value | stays |
| Add | a profile exists | `role=button[name=/^\+ Add /]` | A new item in a list | stays |
| Remove | a list has an item | `role=button[name=/^Remove /]` | Removes that item | stays |
| Save profile | a profile exists | `role=button[name="Save profile"]` | `profile { value }`: saved, or its fields' errors | stays |
