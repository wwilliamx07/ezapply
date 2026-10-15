# Form-filling fixes

**What.** Places where the agent goes wrong on a form:
- It can't clear a text input in Chrome.
- It couldn't press Back on an application's review page.
- After going back and then forward again, it refills fields it thinks are empty when they aren't.
- It ticks some checkboxes and not others for the same kind of question ("I certify the above is true"): these
  should always be ticked.

**Why.** Each costs a turn or a wrong value, and the user has to catch it.

**Plan.** Reproduce each against a fixture or a live run (one adapter change per live run), fix it in the engine,
the adapter or the skill, and add a test.

[details](details.md)
