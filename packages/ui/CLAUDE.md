# packages/ui: rules for changing it

Read `references/components/ui.md` first: what each page does and why.

- **The UI map is part of the change.** A control added, removed or relabelled, a button that leads somewhere new, a
  new screen or state: update its page in `references/ui-map/` (format in its README) in the same change.
- **Selectors are roles and names.** The map finds controls as the user sees them (`role=button[name="Capture"]`),
  so give every control an accessible name (its text, `aria-label`, or a `<label>`).
