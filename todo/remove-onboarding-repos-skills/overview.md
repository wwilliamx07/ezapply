# Remove the onboarding and repos skills

**What.** Drop the `ezapply-onboard` and `ezapply-repos` skills; what they do is done mechanically instead.

**Why.** These flows can be done completely mechanically, so they needn't depend on the agent.

**Plan.**
1. Move each step the two skills drive into code or the setup page.
2. Remove the skills and anything that points at them.
3. Update the references.
