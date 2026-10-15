# Tailoring edits that fit the page and the text

**What.** Better edits to the tailored documents:
- The agent leaves a lot of empty space, wary of overfilling. Give it a measure of how full the page is after a
  compile, or a lint rule.
- Several edits made without rereading the document read badly together: revisit the rule against rereading
  tailored documents.
- An edit sometimes fails: find why.

**Why.** Empty space and edits that don't fit their surrounding sentences make a weaker document, and the user
has to ask for fixes in the review.

**Plan.**
1. The compile reports how full the last page is; the skill aims for full without overflow, or a lint flags a
   page left too empty.
2. Let the agent reread the passages around its edits (not the whole file) before compiling.
3. Collect failed edits and fix their cause.

[details](details.md)
