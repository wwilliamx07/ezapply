# Protocol (`packages/protocol`)

Schemas and types only: no I/O, no Node or browser APIs. Both the companion and the extension import it,
so a change here is a change to the contract between them.

| Module | Contents |
|---|---|
| `bridge.ts` | `PROTOCOL_VERSION`, close codes, handshake and envelope messages, `CompanionApi` / `ExtensionApi` method maps (the side panel's `panel.*` among the companion's, `panel.update` among the extension's), `parseBridgeMessage` |
| `rpc.ts` | `RpcPeer`: symmetric, validated request/response over any message channel; `WithDebug` (a result with a debug trace beside it) |
| `forms.ts` | `FormSchema`, `Field`, `FillAction`, `FillResult`, `NextResult`, `OptionInfo`, `PageKind`, `PageAction`, `UploadFile`, `RemoveResult`, `DebugRequest` (what a debugged form call asks for), and the extension's form methods |
| `postings.ts` | `CapturePayload`, `CaptureResult`, `PostingMeta`, `PostingApplication` (the application a posting is tied to: [data-formats](../data-formats.md#postingsidmetajson-protocolsrcpostingsts)), `PostingMetaPatch`, `PostingStatus`, `SiteId` |
| `browser.ts` | `TabInfo` (`tabId`, `windowId`, `url`, `title`, `active`, `focused?`, `lastAccessed?`, `site` (the site the page shows, else its URL's: [telling a site](extension.md#telling-a-pages-site-framests)), `frames?`: the form sites' frames inside the page, each a `FrameInfo { frameId, url, site }`), `BrowserStatus`, and, from the [registry](#the-site-registry-sitests): `detectSite(url)` (a registry site by its URL alone, else `generic`: what decides where no page can be read), `FORM_SITES` / `isFormSite` (the sites with a form adapter), `siteTenant(url)` (the employer's space on its site: a Workday tenant, an Oracle career site, a Greenhouse board…), `siteJob(url)` (the job the URL is for: a Workday requisition, an Oracle job id, a Greenhouse job…); and `sameJob(a, b, site?)` (Workday's `-1` posting suffix counts as the same job, and with `site`, that site's own rule: its registry entry's `sameJob`; [which posting](../mcp-tools.md#forms)) |
| `sites.ts` | The [site registry](#the-site-registry-sitests): `SITES`, `FormSiteId`, `SiteInfo`, `FORM_SITE_IDS`, `siteInfo(id)`, `siteOfUrl(url)`, `siteSignatures()` (each site's `[id, signature]`, in registry order), `HOST_PERMISSIONS` (`<all_urls>`: the extension's host permissions); no zod (`@ezapply/protocol/sites`) |
| `panel.ts` | The side panel's agent ([agent](agent.md)): `AgentEvent`, `AgentStatus`, `AskSpec`, `AskQuestion`, `AskAnswers` and their checks (`askSpecProblems`, `askAnswerProblems`), the cards (`AskCard`, `PermissionCard`, `Card`), `GENERAL_CONVERSATION`; the panel's bridge methods (`PanelMethods`: [agent](agent.md#the-panels-side-panelts)) and their types (`PanelState`, `PanelPosting`, `PanelConversation`, `DocumentState`, `PanelTabParams`, `PanelTab`, `PanelUpdate`); the agent's settings (`AgentSettings`, `AgentPermissionMode`, `AgentModel`, `AgentEffort`, `DEFAULT_AGENT_SETTINGS`) |
| `errors.ts` | `ErrorCode`, `ErrorPayload`, `EzError` |
| `timing.ts` | `STANDARD_WAITS` (every adapter wait, in ms: the values a site starts from, measured on Workday), `Timing`, `TIMING_DOCS`, `resolveTiming(base, overrides, scale)` (a site's waits with the user's overrides); no imports (`@ezapply/protocol/timing`) ([waits owned by the site](adapters.md#waits-owned-by-the-site)) |
| `oracle.ts` | Oracle Recruiting Cloud facts, with no imports (`@ezapply/protocol/oracle`): `isOracleUrl` (by path: `…/sites/<site>/job|jobs|requisitions|my-profile`, https), `oracleTenant(url)` (`host/site`), `oracleJob(url)`, `oracleJobPath` (a job's path without language or application pages), `ORACLE_LOCALE_SEGMENT` ([oracle-adapter](oracle-adapter.md#which-pages)) |
| `workday.ts` | Workday facts shared by the companion and the in-page adapter, with no imports (so the adapter bundle stays free of zod; imported as `@ezapply/protocol/workday`): `WORKDAY_HOST` (`*.myworkdayjobs.com`, `*.myworkdaysite.com`), `isWorkdayUrl`, `workdayTenant(url)`, `workdayJob(url)` (the requisition), `workdayCanonicalPath` (without the locale segment), `WORKDAY_LOCALE_SEGMENT`, and the posting-page hooks `WORKDAY_POSTING` |
| `greenhouse.ts`, `lever.ts`, `ashby.ts`, `phenom.ts`, `dayforce.ts`, `successfactors.ts` | Each site's URL rules, with no imports: `isXUrl`, `xTenant`, `xJob`, and for Lever and Ashby a canonical path without the application page (`/apply`, `/application`); Phenom's apply page on any host by its last path segment and `jobSeqNo`, the host of any of the site's pages as tenant, `jobSeqNo` as job, `hvhapply` as `apply`; Dayforce's `…/<client>/<site>/jobs/<id>` on `*.dayforcehcm.com` with or without a locale, the client as tenant, the posting id as job, a canonical path from the client to the id ([sites](sites.md#dayforce-sitesdayforce)); SuccessFactors' career site paths on its `career<n>` hosts (`sapsf.com`, `successfactors.eu`…), `company` as tenant, `career_job_req_id` (or `jobId`) as job, a signed-in page's URL naming neither ([sites](sites.md#sap-successfactors-sitessuccessfactors)) |

The package exports `.` (everything), and `./workday`, `./oracle`, `./sites` and `./timing` for the in-page adapters:
those import nothing, and importing them through `.` would pull zod into the page bundle (it did for the
waits, making each adapter 850 KB instead of 60 KB). `detectSite` counts only candidate-facing Workday hosts
as Workday: `www.workday.com` is marketing and `*.myworkday.com` are employee tenants.

## The site registry (`sites.ts`)
Every job site whose application forms ezapply fills has one entry (`SiteInfo`), and everything that knows the
list of sites derives from it, so a new site's only protocol change is its entry (plus its URL module):

| Field | Meaning |
|---|---|
| `id` | `FormSiteId`: `workday`, `oracle`, `greenhouse`, `lever`, `ashby`, `phenom`, `dayforce`, `successfactors` (each also in `SiteId`) |
| `name` | As the user knows it ("Oracle Recruiting Cloud"); the options page uses it |
| `signature` | What the site's own pages render, as a CSS selector list: a page (or frame) is the site's when its document matches any part. How the extension tells a site, before the URL ([telling a site](extension.md#telling-a-pages-site-framests)). Each part is the provider's own markup (its widgets' attributes, class names, script host), never a link to it or its embed script, which an employer's careers page has too |
| `isUrl(url)` | A posting or application page of the site by its URL alone: what decides where no page can be read (a captured page's links, the companion's canonical URLs, a tab the extension can't read) |
| `tenant(url)`, `job(url)` | The employer's space and the job, lowercased, read from a URL of the site's (by `isUrl`, or a tab whose page showed the site) |
| `canonicalPath?(pathname)` | The posting's identifying path, when the site varies it for the same job (a locale segment, an application page) |
| `hostPageJob?(url)` | The site's job that a page on another host names in its URL: a company's careers page embedding the site's board (Greenhouse: `?gh_jid=`). Ties a posting captured there to its application |
| `sameJob?(a, b)` | Whether two of the site's job ids name one job where its pages use different ids for it (Phenom: `jobSeqNo` embeds the requisition the posting shows, [Phenom](sites.md#phenom-sitesphenom)). Consulted by `sameJob` only when the caller names the site, so no other site's ids are compared loosely |
| `waits` | The site's own waits ([waits owned by the site](adapters.md#waits-owned-by-the-site)); all start from `STANDARD_WAITS` |

Derived from it: `detectSite`, `FORM_SITES`, `siteTenant`, `siteJob`, the companion's canonical posting URLs
(`siteOfUrl(url)?.canonicalPath`), which application a posting is tied to and which posting a tab belongs to
(`tenant`, `job`, `hostPageJob`, `sameJob`: [which posting](../mcp-tools.md#forms)), the extension's bundles (`build.mjs`), the
site of every tab, frame and capture in the extension (`siteSignatures`, then `detectSite`), and `loadTiming`'s
per-site sections. `sites.test.ts` checks that the registry and `SiteId` name the same sites and that every site
has a signature; the extension's `sites.test.ts` checks each signature on every saved page of every site.

**Why signatures, and access to every site.** Phenom and Oracle run on employers' own domains, where the URL
is the employer's and its shape varies from one employer to the next: Phenom's apply pages are
`/ca/en/apply` on one site and `/global/en/apply` on another, and a URL rule written from the first missed the
second, so a Phenom application was listed `generic` and the form tools refused it. What every page of a
provider's site has is the provider's own markup, so that's what tells the site. Reading a page needs access to
its host, which for sites on any host means every host: asked for one origin at a time, a tab on an unknown
host stayed unreadable until something already knew its site, which only the URL could say.
`HOST_PERMISSIONS` is `<all_urls>`, which also lets `tab.screenshot` work. The cost is Chrome's broadest
install warning ("Read and change all your data on all websites"), accepted for this; the extension still acts
on a page only for Set posting or a call from Claude ([security](../security.md)).

## Bridge handshake

WebSocket, JSON text frames, one message per frame.

1. Extension → `hello { protocolVersion, extensionVersion, pairingToken, pendingCapture?, browser? }`. An empty
   `pairingToken` asks to pair; it's accepted only while a pairing window is open. `pendingCapture: true`
   says a capture made while the companion was down follows right after `welcome` (the companion holds
   `posting_active` until it's saved). `browser { name, version? }` is the browser the extension runs in
   (`BrowserInfo`; `name` one of `BROWSER_NAMES`: chrome, edge, brave, opera, vivaldi, chromium, firefox, or
   something newer the companion ignores); the companion opens pages and files there.
2. Companion → `welcome { protocolVersion, companionVersion, pairingToken? }` (the code is included only
   when the extension paired without one), or `reject { error }` followed by a close.
3. Then either side sends `request` / `response`; the extension sends `ping` every 20 s and gets `pong`.

The companion closes the socket if no `hello` arrives within 5 s.

| Close code | Name | Meaning | Extension reaction |
|---|---|---|---|
| 4001 | `Unauthorized` | Wrong or rotated code, or not paired | Error state, no backoff retries (only the 30 s alarm tries again). Without a code: quietly "not paired" |
| 4002 | `ProtocolMismatch` | Versions differ; the error hint names the side to rebuild | Error state, as above |
| 4003 | `Replaced` | A newer connection from the same extension took over | Stays quiet |
| 4004 | `HandshakeTimeout` | No `hello` in time | Retries with backoff |

Upgrades from an unexpected `Origin` (not `chrome-extension://<32 a–p>` or `moz-extension://<uuid>`, or not
the pinned id) are refused with HTTP 403 before any message is exchanged.

## RPC

`RpcPeer<Remote, Local>` sends `{ kind: "request", id, method, params }` and resolves on the matching
`response`. The receiving side validates `params` against the method's schema before calling the handler,
and the caller validates `result` before resolving. Handler errors travel as `ErrorPayload` and are
rethrown as `EzError` on the calling side. Unknown methods get `bad_request`. Requests time out (default
30 s; callers pass longer for slow form work) with `timeout`. `failAll` rejects everything in flight
when the connection drops. Ids are prefixed per side (`e` for the extension) so they never collide.

**A debug trace beside the result.** A handler may return `new WithDebug(result, debug)`, or throw an error with
a `debug` property; the response then carries `debug` next to `result` or `error`. The caller gets it only through
the `onDebug` callback it passed to `request` (the companion's `ExtensionBridge.call` takes it as its fourth
argument), never from what `request` resolves to. That's how debug mode's adapter trace and markup
([adapters](adapters.md#debug-mode-the-adapter-trace)) reach the companion's record without passing
through anything that builds a tool result.

### Methods

`CompanionApi` (served by the companion):

| Method | Params → result |
|---|---|
| `posting.capture` | `CapturePayload` → `CaptureResult { postingId, isNew, company?, role? }` |

`ExtensionApi` (served by the extension). Every `form.*` and `tab.*` method also takes `timing?` (name → ms):
the adapter's waits for that call, resolved by the companion from `autofill-timing.yaml` against the tab's
site's waits; the keys are `STANDARD_WAITS`'s in `timing.ts` ([waits](adapters.md#waits-owned-by-the-site)). Unknown
keys are ignored and an older extension strips the field, so it came without a version bump. They also take
`debug?` (`DebugRequest { before?, after?, failures? }`), sent only while debug mode is on: the adapter
records its trace for the call, and the page's markup before it, after it and at each failed field as the flags
say, and the response brings it back in its `debug`. The `tab.*` methods ignore it.

| Method | Params → result |
|---|---|
| `browser.status` | `{}` → `BrowserStatus { extensionVersion, tabs[] }` (each tab's `frames`: embedded applications) |
| `form.get` | `{ tabId?, frameId? }` → `FormSchema` (with `frameId` when read in a frame). Every `form.*` method takes `frameId`: act on that frame of the tab, an application embedded in another site's page, instead of the tab's own page ([embedded applications](extension.md#embedded-applications)) |
| `form.listOptions` | `{ tabId?, fieldId }` → `OptionInfo[]` |
| `form.searchOptions` | `{ tabId?, fieldId, query }` → `OptionInfo[]` |
| `form.fill` | `{ tabId?, fills: FillAction[] }` → `FillResult[]` |
| `form.upload` | `{ tabId?, fieldId, file: UploadFile }` → `FillResult` |
| `form.remove` | `{ tabId?, fieldId, values? }` → `RemoveResult { fieldId, ok, removed, remaining, notFound?, error? }` (no `values` = all). Added without a version bump; an older extension answers "Unknown method" |
| `form.removeRepeatable` | `{ tabId?, sectionId }` → `RemoveRowResult { sectionId, ok, removed?, error? }`. Added without a version bump, like `form.remove` |
| `form.addRepeatable` | `{ tabId?, addButtonId }` → `{ ok, error? }` |
| `form.next` | `{ tabId? }` → `NextResult` |
| `form.back` | `{ tabId? }` → `BackResult { moved, pageKind, step?, errors[], refusedReason? }`. Added without a version bump |
| `form.pageAction` | `{ tabId?, action: PageAction }` → `{ ok, pageKind, error? }` |
| `tab.screenshot` | `{ tabId? }` → `{ tabId, pngBase64 }` (always the whole tab) |
| `tab.show` | `{ tabId?, frameId?, activate, focusWindow? }` → `{ tabId, activated, windowFocused?, hidden, focused? }`: with `focusWindow` (and `activate`), bring the browser window to the front first, restoring it if minimized (`windowFocused`: it was raised; the OS may still keep it behind); switch to the tab in its window (`activate`), then report whether the page still says `document.visibilityState === "hidden"`, and `document.hasFocus()` as `focused` (false while the browser window is behind another app; absent when the page can't be read). Sent before every form call ([which tab](../mcp-tools.md#forms)). Added without a version bump, and `focused`, then `focusWindow` and `windowFocused`, later the same way (an older extension ignores `focusWindow`); an extension older than `tab.show` answers "Unknown method" |

## Form schema

What a site adapter reports of an application page (`FormSchema`; Claude gets a leaner copy, see
[mcp-tools](../mcp-tools.md#forms)): `adapter` (the site id), `tabId`, `url`, `tenant?`, `pageKind`,
`step? { index?, total?, title }`, `sections[] { id, title, fields[], removable?, saved? }` (`saved`: a saved
item, shown as a summary with no fields: Oracle's tiles and timeline entries), `addButtons[] { id, label,
section?, kind? }` (`section`: the heading the button sits under; `kind`: `row` adds a row of fields, `form`
opens an inline form, `save` is an open inline form's Save (`save.<block>`) or that of a form that's part of the
step, `edit` opens a saved item's form again), `actions[]` (page
actions available), `errors[]`, `messages?` (notices such as "resume.pdf successfully uploaded", which live
Workday shows in the same alert region as errors), `nextLabel?`, `lastPage?` (a step whose only way on is
Submit: Oracle's last or only page, every one-page site), `backLabel?`, `job? { title?, reqId? }` (the job the page
says it's the application for, from the site definition's `page.job`: [adapters](adapters.md)). The companion
reads `kind`, `saved`, `lastPage` and `job` instead of the site's name, so a new site needs no companion change.

- `PageKind`: `posting`, `auth`, `start-choice`, `step`, `review`, `confirmation`, `unknown` (Oracle has no
  `review`: its last page is a `step` whose `nextLabel` is Submit).
- `PageAction`: `apply`, `apply_manually`, `autofill_with_resume`, `use_last_application`.
- `Field`: `id` (stable within the page: section + a key (Workday's automation id, Oracle's control id
  without its render counter), `#n` for repeats), `automationId?`,
  `label`, `helpText?`, `required`, `kind`, `options?`, `optionsLazy?`, `dateParts?`, `multiple?`,
  `currentValue` (string, string[], boolean or null), `error?`, `hint? { profileKey }`.
- `FieldKind`: `text`, `textarea`, `number`, `password`, `date`, `dropdown`, `typeahead`, `radio`,
  `checkbox`, `checkbox-group`, `file`.
- `FillAction`: `{ fieldId, value }`. (A `strict?` flag, for deterministic autofill, was removed with it; an
  extension built before that still accepts it, and nothing sends it.)
- `FillValue`: a string, a string array, or a boolean. `FillResult`: `{ fieldId, ok, readBack?, error?,
  availableOptions?, unmatched?, inexact? }`: `unmatched[] { value, suggestions[] }` lists typeahead entries
  that matched nothing, with the options their search showed; `inexact[] { value, selected }` those for which
  Workday selected an option itself. `OptionInfo`: `{ label, hasChildren? }` (children = a nested menu).
- `NextResult`: `{ advanced, pageKind, step?, errors[], messages?, refusedReason? }`; `advanced` = the step
  index, title or page kind changed. `BackResult`: `{ moved, pageKind, step?, errors[],
  refusedReason? }`.

## Postings

`CapturePayload`: `url`, `pageTitle`, `html` (body verbatim), `visibleHtml`, `visibleText`, `jsonLd[]`,
`frameUrl?` (the content came from this embedded frame; `url` and `pageTitle` are still the tab's), `site?`
(the site the content's page showed, by its body; absent when none did, and the companion goes by the URL),
`capturedAt`, `tabId`. `PostingMeta` and `PostingStatus` are described in
[data-formats.md](../data-formats.md#postingsidmetajson-protocolsrcpostingsts).

## Errors

`EzError { code, message, hint? }`, serialized as `ErrorPayload`. Codes: `bad_request`, `unauthorized`,
`protocol_mismatch`, `not_paired`, `extension_disconnected`, `timeout`, `not_found`, `no_active_posting`,
`capture_failed`, `path_not_allowed`, `posting_mismatch` (the tab is another posting's: nothing that changes the page runs), `internal`. `EzError.from(anything)` wraps unknown errors as
`internal`.

## Changing the protocol
- Additive, optional fields: no version bump (both sides ignore unknown fields). Examples: code-less
  pairing added the optional `welcome.pairingToken`, and idle shutdown added `hello.pendingCapture` and
  close code 4005 (4005 went again with the background daemon; the companion now closes with 1001 when its
  chat ends, which every extension treats as a plain disconnect); later `TabInfo.focused` and
  `lastAccessed`, `Section.removable`, `CapturePayload.frameUrl`, `FormSchema.backLabel` and the
  `form.removeRepeatable` and `form.back` methods, `hello.browser`, the `timing` param, and `addButtons[].section`,
  `FormSchema.messages`, `NextResult.messages` and `FillResult.unmatched`/`inexact`.
  `PROTOCOL_VERSION` stayed 2 through these. Later, also without a bump: `FillAction.strict` (since removed), and
  `addButtons[].kind`, `Section.saved` and `FormSchema.lastPage`; then `tab.show`'s `focused`, and
  `FormSchema.job`; then `tab.show`'s `focusWindow` and `windowFocused`; then `TabInfo.frames`, the `frameId`
  param of the form methods and `tab.show`, and `FormSchema.frameId`. An older extension ignores `frameId` and
  acts on the tab's own page, which isn't an application, so the call fails with "not an application page"
  rather than landing anywhere else. Then `CapturePayload.site`, and `TabInfo.site` (and `FrameInfo.site`) going by
  the page's body before its URL, which changes what a site is, not the schema. Then the form methods' `debug`
  param and the response's `debug`: an older extension strips the param and answers without a trace (the companion's
  record notes it), and an older companion strips the response's field.
- Anything else that changes a message or a method's schema: bump `PROTOCOL_VERSION`. Old and new sides
  then refuse each other with a hint naming the side to rebuild. **3:** `SiteId` gained `oracle`; an older
  companion would have rejected every `browser.status` listing an Oracle tab, so the handshake says so instead.
  **4:** `SiteId` gained `greenhouse`, `lever` and `ashby`, for the same reason. **5:** `SiteId` gained `phenom`. **6:** `SiteId` gained `dayforce`, and
  `addButtons[].kind` gained `edit`, which an older companion would reject. **7:** `SiteId` gained `successfactors`.
- New method: add it to `CompanionApi` or `ExtensionApi`; the serving side gets a type error until its
  handler exists.
