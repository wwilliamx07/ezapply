# Employer's own forms beyond plain HTML

**What.** Read more of the application forms careers pages render themselves: their custom widgets, forms built
without a `<form>` element, and a provider's form served on the employer's own host.

**Why.** The generic reader fills only standard HTML forms and leaves the rest to the user. Pages built with
JavaScript frameworks often have home-made dropdowns or no form element at all, so nothing on them is read.

**Plan.**
- Start from saved real pages: what custom widgets they use decides what's worth reading.
- Read ARIA comboboxes with the shared driver, and find a form without a `<form>` element by its fields.
- Only if a saved page shows it: a provider's markup on the employer's host, matched by the page's own job.
