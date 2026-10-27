# Importing a LaTeX template

On the resume step (while there's none, or after Import another) and the cover letter step (Use my own LaTeX cover
letter): a folder or one `.tex` file, its path typed or chosen in the system's dialog, and Import and build. The
outcome shows under it, or [why it didn't build](build-failed.md).

**Marker:** `css=.ob-box:has(.ob-mono)`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| a folder | | `role=radio[name="a folder"]` | The source is a folder (the default) | same |
| one .tex file | | `role=radio[name="one .tex file"]` | The source is one file | same |
| Its folder, or its .tex file | | `css=.ob-box input.ob-mono` | The path | stays |
| Browse… | | `css=.ob-box >> role=button[name=/Browse…/]` | `browse { kind }`: the system's dialog; the path chosen goes in the field | stays |
| Import and build | | `role=button[name=/Import and build/]` | `import { kind, source }`, then the build's outcome (disabled until there's a path); a resume imported, the step shows where it came from | [Importing](import.md), [Your resume](resume.md) |
