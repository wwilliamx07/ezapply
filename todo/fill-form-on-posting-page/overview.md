# Fill form is missing where the posting and the form share a page

**What.** On a Greenhouse application the panel shows no Fill form: "This tab" calls the tab the posting's page,
not its application.

**Why.** `PanelService.tab` (`companion/src/agent/panel.ts`) returns `posting` whenever the tab's address is the
posting's, before it looks at the site. On Greenhouse the posting and the form are one page
([greenhouse](../../references/components/sites/greenhouse.md)), so the application tab is never `application`, and
`FillButton` offers Open the application (or nothing) instead. On Workday the posting page is a form site too but
not the application, so the check can't simply go by site.

**Plan.**
1. When the tab's address is the posting's and its site is a form site, call it the application if the posting's
   application address (`postings.application`) is that same address; otherwise keep `posting`.
2. Tests in the panel's test: a Greenhouse posting whose application is its own page gives `application`; the
   Workday posting page still gives `posting`.

[details](details.md)
