# The UI map

Where every button in ezapply's browser UI leads: one short page per screen or state, in a section per part of the
UI. Read it to find your way around the UI without opening the code; the UI fuzzer ([development](../development.md#the-ui-fuzzer))
reads the same tables as its list of edges and checks the real UI against them, so the map can't drift from what's
built. What each part is for, and why, is on its component page ([ui.md](../components/ui.md)); the map holds only
what's on screen and where it goes.

| Section | Covers | Opened as |
|---|---|---|
| [panel/](panel/README.md) | The side panel: the list of applications, a conversation, the posting's popover, cards, the workspace changes card | The extension's side panel |
| [review/](review/README.md) | The review page: the documents, the viewer, comments, the answer | A tab the companion opens (`/review/<id>`) |
| [onboarding/](onboarding/README.md) | The setup page: each step, the Changes list, finishing | A tab the companion opens (`/onboard`) |

## A page

```
# The screen's name

What it shows, in a few lines.

**Marker:** `a Playwright selector that's on screen only while this screen (or state) is`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| The label the user sees | Empty: always there. Else when it is | `a Playwright selector` | The bridge call or agent task | [The next screen](page.md) |
```

- **Marker:** on screen exactly while the page applies. Several pages apply at once: the panel's frame (header and
  settings) with the list under it and the menu open over both. The controls on screen are those of every page
  whose marker is.
- **Selector:** a Playwright selector (`role=button[name="Capture"]`, `css=.ez-app-open`), the user's view of the
  control by role and name where it has one. A role name matches as a substring, ignoring case; `/^…$/` for exact.
  A selector may match several controls (each row of a list): the fuzzer presses the first, and all of them are the
  map's. *(triple-click)* after it: pressed by a triple click, which selects a line of text.
- **When:** a control that isn't always there says when it is. One with no condition missing from its screen is a
  failure; a conditional one must show in one of the section's scenarios.
- **Leads to:** a link to the page it opens (several when it depends: any one will do); `stays`: the same screen,
  changed, or a call to ezapply (pressing it and nothing happening is a dead control); `same`: the same screen, and
  it may do nothing (pressing the tab already shown); `a new tab`; `a download`; `the file chooser`.

A control that asks first (`window.confirm`) is confirmed by the fuzzer.

## Keeping it current
A change to the UI changes the map in the same change: a new control, a label, where a button leads, a new screen.
`npm run fuzz` fails on a control on screen that no page lists, a listed one that isn't there, and a press that
leads somewhere else, naming the page and the presses that got there.
