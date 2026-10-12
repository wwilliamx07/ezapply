# Application forms on an employer's own page

**Value** Medium · **Size** M–L · **Needs first** One directory per adapter; a page saved from a real one

**What.** Fill an application that a careers page shows in its own page, with no provider frame.

**Why.** Nothing finds such a form today: the extension tells a page's site by its body, and every signature is a
provider's own markup. A frameless application is the employer's own form, posted to its own server, so no
per-provider signature or definition can read it.

**Plan.**
1. A `generic` definition for plain HTML forms, on the engine with the shared drivers only.
2. Used only when asked for (a form call with an explicit `tabId`), never by detection.
3. Only if a saved page shows it: a provider's markup served on the employer's host, read through `hostPageJob`.
