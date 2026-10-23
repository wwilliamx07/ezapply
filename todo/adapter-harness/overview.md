# An adapter harness: local clones of real application forms

**What.** A usable clone of every site's real application form, made with the adapter harness; the parts of its
explorer and stand-in that only real sites need; a fill run by the panel's agent; and clones as part of building
and changing an adapter.

**Why.** Today an adapter change is checked by the user's next real application. A clone of each site lets every
change, and every new site, be tested first, without the user's time or account.

**Plan.**
- **The public sites first** (Greenhouse, then Lever and Ashby): clone a posting each, write the site's description
  from the cloner's proposal, and fix what the explorer or the stand-in couldn't handle until each clone is usable
  and a fill run reaches the hand-off.
- **What only real sites need:** nested choices walked level by level, saves that come back when the page reloads,
  the explorer's per-site hooks, response times checked against the recorded ones.
- **Fill runs that catch breakage:** deliberate adapter breaks fail them, and their results agree with each site's
  behavioural tests.
- **Sites behind an account** (Workday, then Oracle), with signing in as the user's only step; then the rest.
- **A fill run by the panel's agent**, through the real extension and companion, to the hand-off.
- **Part of the process:** a "Clone it" step when building an adapter, and the rule to fill the site's clone after
  any adapter change, before a live run.

[details](details.md)
