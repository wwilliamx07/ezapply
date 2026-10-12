# The side panel's later parts

**Value** Medium · **Size** M–L · **Needs first** — · Part of "Everything happens in the browser"

**What.** The parts of the side panel not built yet: starting without a terminal, the review in the panel, and
pointing at a field.

**Why.** The panel works only while the user has started `./ezapply` in a terminal, and the review and the form
still take the user to a tab.

**Plan.** Each on its own:
1. A native messaging host that starts the companion (weighed against the "no daemon" choice).
2. The review in the panel, if a narrow PDF viewer is usable.
3. A hand-off item that scrolls the form to its field and outlines it.
