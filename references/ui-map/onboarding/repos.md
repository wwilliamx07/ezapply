# Repositories

Once logged in to GitHub: every repository the app can read (language, last push, description, private), a search,
the ones left out behind a toggle, a link to give the app access to another, a field for a public repository by its
address, and Save. Before that, a line saying to log in first.

**Marker:** `css=.ob-step >> role=heading[name=/^Repositories$/]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Search repositories | logged in | `role=searchbox[name="Search repositories"]` | Filters the list | stays |
| Show N left out | logged in, and some are left out | `role=checkbox[name=/^Show \d+ left out/]` | Shows or hides forks, archived, empty and config repositories | stays |
| A repository | logged in | `css=.ob-repo input[type=checkbox]` | Ticks or unticks it | stays |
| Give the app access to it | the app's settings address is known | `role=link[name="Give the app access to it"]` | GitHub's page for the app's access | a new tab |
| A public repository you contributed to | logged in | `role=textbox[name=/A public repository/]` | Its address, or `owner/name` | stays |
| Add | logged in | `role=button[name=/^(Add\|Adding…)$/]` | `addRepo { url }`: saved at once and listed ticked, or why not (disabled while empty) | stays |
| Save N repositories | logged in | `role=button[name=/^Save \d+ repositor/]` | `repos { repos }` | stays |
