# The side panel's later parts: details

**Why.** The side panel ([ui](../../references/components/ui.md#the-side-panel-srcpanel)) works only while the user
has started `./ezapply` in a terminal, and two things still leave it for a tab: the review and the form.

**How, each on its own.**
- **Starting without a terminal:** a native messaging host (`ezapply native-host`, registered by `init`) the panel
  asks to start the companion when it isn't running. A process the user didn't start in a terminal, which the "no
  daemon" choice in `references/architecture.md` argued against; weigh it then.
- **The review in the panel,** if a narrow PDF viewer turns out usable.
- **Pointing at a field:** an item of the fill's hand-off that scrolls the form to its field and outlines it (an
  adapter call).

**References when built:** `architecture.md`, `components/extension.md`, `components/ui.md`, `components/cli.md`,
`security.md`, `status.md`.
