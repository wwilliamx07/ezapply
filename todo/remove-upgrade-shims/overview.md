# Remove the upgrade shims

**What.** Delete the code that upgrades older installs, once no older install is left.

**Why.** The shims only serve installs from before a change; after that they're dead code.

**Plan.** When no older install is left, remove the shims and their tests, and the references' mentions of them.
