---
name: ui-fuzz
description: Run the UI fuzzer over the side panel, the review page and onboarding, and fix what it finds. Builds the UI, walks every control against the UI map in references/ui-map/, then triages each failure as the UI's bug or the map out of date. Use when the user asks to fuzz the UI or check a UI change in a real browser.
argument-hint: "[panel | review | onboarding | scenario name …] [--update]"
disable-model-invocation: true
---

# /ui-fuzz: walk the UI against its map

Read "The UI fuzzer" in `references/development.md` first: what it checks and how. `$ARGUMENTS`, if given, is
passed to the fuzzer (a section, scenario names, or flags). Otherwise fuzz everything.

1. **Map first.** If the working tree changes `packages/ui`, check that its pages in `references/ui-map/` (format
   in its README) match: a control added, removed or relabelled, a new destination, a new screen or state.
2. **Build, then fuzz:**
   ```bash
   npm run build
   ```
   ```bash
   npm run fuzz -- $ARGUMENTS
   ```
   The whole run takes about four minutes; run it in the background. It needs a browser (Playwright's Chromium,
   else Edge or Chrome). Without one it can't run: say so and stop.
3. **Triage every failure.** Each names the map page it's about and the presses that reached it. Open the
   screenshots it names in `.fuzz/shots/`. Decide which side is wrong:
   - the UI (a console error, a dead control, a press leading somewhere it shouldn't): fix the UI;
   - the map (the UI changed on purpose and the page didn't follow): fix the map page;
   - a condition no scenario shows: add a scenario in `scripts/fuzz/lib/scenarios.ts` and list it in the map
     section's README.
   Re-run only the section you touched until it passes.
4. **Goldens.** A changed screenshot leaves a `.new.png` beside the golden. Open both. Only when the difference is
   the change you meant, re-run with `--update`. Look at every new golden before it is committed.
5. **Report** the scenarios run, each failure and which side you fixed, goldens updated (and why), and anything
   left failing.
