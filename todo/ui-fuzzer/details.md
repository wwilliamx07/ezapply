# A UI fuzzer with a map of the UI: details

**Driver.** Playwright, as the adapter harness uses it (`references/harness.md`: its browser fallback too), run as
`npm run fuzz -- [section]`. The agent reads the pass/fail output and opens the screenshots with its image reader.

## The UI map

- `references/ui-map/`, since it describes the UI as built and every UI change has to keep it current. A
  `README.md` with the sections and how to read a page, then one directory per section following `components/ui.md`:
  `onboarding/` (the setup page's steps, TeX install, the cover letter's options), `panel/` (the conversation card,
  the applications list, workspace-change cards, a posting's view), `review/` (the viewer, what changed since the
  last review).
- One file per screen or state: what it shows, then a table of its controls — the label as the user sees it, a
  stable selector (`data-testid`, added where missing), what pressing it does (the bridge call or agent task), and a
  link to the screen it leads to. Conditions go with the control ("only when the build failed"). Short, no
  implementation beyond the selector and the call.
- The fuzzer reads the tables (selector → target) as its list of edges, so the map is the fuzzer's input, not a
  copy beside it.

## The fuzzer

- Serve the UI pages from `packages/ui` without the extension, against a fake companion answering the bridge from
  canned responses: the agent's replies and workspace-change cards, repo indexing, `tex_compile` results and
  previews, TeX install progress. Named scenarios set the starting state (empty workspace, onboarded, a posting
  under review, a build that fails), so states the map conditions on can be reached.
- From each scenario, walk the map breadth-first: press each control, check the screen matches its target page
  (its marker selector), screenshot, go on. Then press what the map doesn't list and fill inputs with odd values
  (empty, very long, non-ASCII, pasted LaTeX) to find what breaks.
- Fails on: a console error or uncaught exception, a control that does nothing, a control on screen that the map
  lacks, a target other than the map's, a map control the screen lacks. Each failure names the map page and the
  path of presses that reached it.
- Screenshots are compared with goldens in the repo (placeholder profile only: `Jane Doe`, `jane@example.com`);
  a diff fails the run and saves the new image beside the old one for the agent to look at.

**Open.** Where the canned responses come from (recorded from a run and scrubbed, or written by hand) and how they
stay in step with the real ones.

**References when built:** `development.md`, `components/ui.md`, `ui-map/`, `status.md`.
