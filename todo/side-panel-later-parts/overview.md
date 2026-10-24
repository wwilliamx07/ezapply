# The side panel's later parts

**What.** The parts of the side panel not built yet: starting without a terminal, the review in the panel, and
pointing at a field.

**Why.** The panel works only while the user has started `./ezapply` in a terminal, and the review and the form
still take the user to a tab.

**Plan.** Each on its own:
- A native messaging host that starts the companion (weighed against the "no daemon" choice).
- The review in the panel, if a narrow PDF viewer is usable.
- An item on the hand-off card that scrolls the form to its field and outlines it.
