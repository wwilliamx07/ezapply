# Protocol (`packages/protocol`)

Schemas and types only: no I/O, no Node or browser APIs. Both the companion and the extension import it,
so a change here is a change to the contract between them.

| Module | Contents |
|---|---|
| `bridge.ts` | `PROTOCOL_VERSION`, close codes, handshake and envelope messages, `CompanionApi` / `ExtensionApi` method maps (the side panel's `panel.*` among the companion's, `panel.update` among the extension's), `parseBridgeMessage` |
| `rpc.ts` | `RpcPeer`: symmetric, validated request/response over any message channel; `WithDebug` (a result with a debug trace beside it) |
| `forms.ts` | `FormSchema`, `Field`, `FillAction`, `FillResult`, `NextResult`, `OptionInfo`, `PageKind`, `PageAction`, `UploadFile`, `RemoveResult`, `DebugRequest` (what a debugged form call asks for), and the extension's form methods |
| `postings.ts` | `CapturePayload`, `CaptureResult`, `PostingMeta`, `PostingApplication` (the application a posting is tied to: [data-formats](../data-formats.md#postingsidmetajson-protocolsrcpostingsts)), `PostingMetaPatch`, `PostingStatus`, `SiteId` (a registry site's id or `generic`: a string, which each side checks against its own registry, `isFormSite`) |
| `browser.ts` | `TabInfo` (`tabId`, `windowId`, `url`, `title`, `active`, `focused?`, `lastAccessed?`, `site` (the site the page shows, else its URL's: [telling a site](extension.md#telling-a-pages-site-framests)), `frames?`: the form sites' frames inside the page, each a `FrameInfo { frameId, url, site }`), `BrowserStatus`, `BrowserInfo` |
| `sites.ts` | `SiteInfo`, the shape of a [registry entry](sites.md#the-registry), and `HOST_PERMISSIONS` (`<all_urls>`: the extension's host permissions, [why](sites.md#the-registry)); no zod (`@ezapply/protocol/sites`). The sites themselves are in `@ezapply/sites`: the protocol names none |
| `panel.ts` | The side panel's agent ([agent](agent.md)): `AgentEvent`, `AgentStatus`, `AskSpec`, `AskQuestion`, `AskAnswers` and their checks (`askSpecProblems`, `askAnswerProblems`), the cards (`AskCard`, `PermissionCard`, `Card`), the conversation keys (`GENERAL_CONVERSATION`, `ConversationPart`, `conversationKey`, `postingConversation`); the panel's bridge methods (`PanelMethods`: [agent](agent.md#the-panels-side-panelts)) and their types (`PanelState`, `PanelPosting`, `PanelConversation`, `DocumentState`, `PanelTabParams`, `PanelTab`, `PanelUpdate`); the agent settings (`AgentPrefs`, `AgentChoice`, `AgentSettings`, `AgentPermissionMode`, `AgentModel`, `AgentEffort`, `AGENT_MODES` and `AGENT_EFFORT` (which modes each agent offers, whether it takes an effort), `DEFAULT_AGENT_CHOICES`, `DEFAULT_AGENT_PREFS`) and what they come to (`readAgentPrefs`, `effectiveSettings`, `changeAgentPrefs`) |
| `pages.ts` | Types only (exported with `export type`): the review and onboarding pages' state, answers and steps (`ReviewPageState`, `ReviewAnswer`, `PageRect`, `OnboardState`, …), so the pages import them without bundling anything ([ui](ui.md#how-a-page-talks-to-the-companion)) |
| `textdiff.ts` | The word diff between two versions of a document's text (`tokenizePages`, `diffWords`, `diffPages`, `describeHunk`), shared by the companion's `pdf_text { sinceReviewed }` and the review page; no imports (`@ezapply/protocol/textdiff`) ([ui](ui.md#what-changed-since-the-last-review-changests-protocolsrctextdiffts)) |
| `errors.ts` | `ErrorCode`, `ErrorPayload`, `EzError` |
| `timing.ts` | `STANDARD_WAITS` (every adapter wait, in ms: the values a site starts from, measured on Workday), `Timing`, `TIMING_DOCS`, `resolveTiming(base, overrides, scale)` (a site's waits with the user's overrides); no imports (`@ezapply/protocol/timing`) ([waits owned by the site](adapters.md#waits-owned-by-the-site)) |

The package exports `.` (everything), `./sites` and `./timing` for the in-page adapters and the site registry, and
`./textdiff` for the review page: those import nothing, and importing them through `.` would pull zod into the
bundle (for the waits, it made each adapter 850 KB instead of 60 KB).

## Bridge handshake

WebSocket, JSON text frames, one message per frame.

1. Extension → `hello { protocolVersion, extensionVersion, pairingToken, pendingCapture?, browser?, sites? }`. An empty
   `pairingToken` asks to pair; it's accepted only while a pairing window is open. `pendingCapture: true`
   says a capture made while the companion was down follows right after `welcome` (the companion holds
   `posting_get` until it's saved). `browser { name, version? }` is the browser the extension runs in
   (`BrowserInfo`; `name` one of `BROWSER_NAMES`: chrome, edge, brave, opera, vivaldi, chromium, or
   something newer the companion ignores); the companion opens pages and files there. `sites` are the ids of the
   registry the extension was built with: the companion refuses a list other than its own (in any order), or none, as
   an extension built from another version, since one side would name a site the other can't handle. This is what
   lets a new site go without a version bump ([changing the protocol](#changing-the-protocol)).
2. Companion → `welcome { protocolVersion, companionVersion, pairingToken? }` (the code is included only
   when the extension paired without one), or `reject { error }` followed by a close.
3. Then either side sends `request` / `response`; the extension sends `ping` every 20 s and gets `pong`.

The companion closes the socket if no `hello` arrives within 5 s, and closes every socket with 1001 when `ezapply`
stops, which the extension treats as a plain disconnect (retries with backoff).

| Close code | Name | Meaning | Extension reaction |
|---|---|---|---|
| 4001 | `Unauthorized` | Wrong or rotated code, or not paired | Error state, no backoff retries (only the 30 s alarm tries again). Without a code: quietly "not paired" |
| 4002 | `ProtocolMismatch` | Versions differ (the error hint names the side to rebuild), or the two sides' sites do (rebuild and reload the extension) | Error state, as above |
| 4003 | `Replaced` | A newer connection from the same extension took over | Stays quiet |
| 4004 | `HandshakeTimeout` | No `hello` in time | Retries with backoff |

Upgrades from an unexpected `Origin` (not `chrome-extension://<32 a–p>`, or not the
pinned id) are refused with HTTP 403 before any message is exchanged.

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
| `posting.submitted` | `{ postingId, url, at }` → `{}`: a watched application reached its confirmation page (`tab.watchSubmit`); the companion moves the posting to `submitted` and logs it. Answered even for a posting deleted since, so the extension doesn't send it again |
| `panel.*` | The side panel's methods (`PanelMethods` in `panel.ts`), relayed by the extension from its panels: [agent](agent.md#the-panels-side-panelts) |

`ExtensionApi` (served by the extension). Every `form.*` and `tab.*` method also takes `timing?` (name → ms):
the adapter's waits for that call, resolved by the companion from `autofill-timing.yaml` against the tab's
site's waits; the keys are `STANDARD_WAITS`'s in `timing.ts` ([waits](adapters.md#waits-owned-by-the-site)). Unknown
keys are ignored and an older extension strips the field. They also take
`debug?` (`DebugRequest { before?, after?, failures? }`), sent only while debug mode is on: the adapter
records its trace for the call, and the page's markup before it, after it and at each failed field as the flags
say, and the response brings it back in its `debug`. The `tab.*` methods ignore it.

| Method | Params → result |
|---|---|
| `browser.status` | `{}` → `BrowserStatus { extensionVersion, tabs[] }` (each tab's `frames`: embedded applications) |
| `panel.update` | `PanelUpdate { event?, changed?, cards? }` → `{}`: relayed to the open side panels; `cards` (how many wait) also sets the toolbar badge while none is open ([extension](extension.md#the-side-panel)) |
| `form.get` | `{ tabId?, frameId? }` → `FormSchema` (with `frameId` when read in a frame). Every `form.*` method takes `frameId`: act on that frame of the tab, an application embedded in another site's page, instead of the tab's own page ([embedded applications](extension.md#embedded-applications)) |
| `form.searchOptions` | `{ tabId?, fieldId, query }` → `OptionInfo[]` |
| `form.fill` | `{ tabId?, fills: FillAction[] }` → `FillResult[]` |
| `form.upload` | `{ tabId?, fieldId, file: UploadFile }` → `FillResult` |
| `form.remove` | `{ tabId?, fieldId, values? }` → `RemoveResult { fieldId, ok, removed, remaining, notFound?, error? }` (no `values` = all). An older extension answers "Unknown method" |
| `form.removeRepeatable` | `{ tabId?, sectionId }` → `RemoveRowResult { sectionId, ok, removed?, error? }`. An older extension answers "Unknown method", as for `form.remove` |
| `form.addRepeatable` | `{ tabId?, addButtonId }` → `{ ok, error? }` |
| `form.next` | `{ tabId? }` → `NextResult` |
| `form.back` | `{ tabId? }` → `BackResult { moved, pageKind, step?, errors[], refusedReason? }`. An older extension answers "Unknown method" |
| `form.pageAction` | `{ tabId?, action: PageAction }` → `{ ok, pageKind, error? }` |
| `tab.screenshot` | `{ tabId? }` → `{ tabId, pngBase64 }` (always the whole tab) |
| `tab.watchSubmit` | `{ tabId, url, postingId }` → `{}`: watch the tab for the application's confirmation page on `url`'s host, and report it with `posting.submitted` ([the watch](extension.md#watching-for-the-users-submit-submit-watchts)). Sent at the hand-off; a failure is only logged |
| `tab.show` | `{ tabId?, frameId? }` → `{ tabId, emulated, hidden, focused? }`: turn on focus emulation for the tab ([extension](extension.md#focus-emulation-emulationts)), then report whether the page says `document.visibilityState === "hidden"`, and `document.hasFocus()` as `focused` (absent when the page can't be read). `emulated` false: it couldn't, and nothing else was done. Sent before every form call, with a 5 s timeout ([the tab at full speed](../mcp-tools.md#forms)). An older extension that fails it (another form of it, or "Unknown method") doesn't fail the call: the companion goes ahead without it (`FormsService.show`) |

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
- `FillAction`: `{ fieldId, value }`; `form.fill` takes at least one.
- `FillValue`: a string, a string array, or a boolean. `FillResult`: `{ fieldId, ok, readBack?, error?,
  availableOptions?, optionCount?, unmatched?, inexact? }` (`optionCount` is the companion's, when it cut
  `availableOptions` to the closest: [mcp-tools](../mcp-tools.md#forms)): `unmatched[] { value, suggestions[] }` lists typeahead entries
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
`protocol_mismatch`, `extension_disconnected`, `timeout`, `not_found`, `no_posting` (no posting named outside a posting's conversation),
`path_not_allowed`, `posting_mismatch` (the tab is another posting's: nothing that changes the page runs), `internal`. `EzError.from(anything)` wraps unknown errors as
`internal`.

## Changing the protocol
- Additive, optional fields and new methods: no version bump (zod strips unknown fields on both sides, and an
  unknown method answers `bad_request` "Unknown method", which the companion turns into a hint to rebuild the
  extension, `olderExtension` in `forms/service.ts`). Design such an addition so the older side fails safe: an
  older extension ignores `frameId` and acts on the tab's own page, which isn't an application, so the call fails
  with "not an application page" rather than landing anywhere else; it strips `debug` and answers without a trace
  (the companion's record notes it), and an older companion strips the response's `debug`.
- Anything else that changes a message or a method's schema: bump `PROTOCOL_VERSION`. Old and new sides
  then refuse each other with a hint naming the side to rebuild. That includes a new variant of a union the
  receiving side parses, such as an `AgentEvent` kind: unlike an unknown field it isn't stripped, and an older
  receiver rejects the whole message over it (`panel.conversation` fails on one unknown event).
- A new site: no bump. `SiteId` is a string, so neither side rejects a message for naming a site, and `hello`
  compares the two sides' sites instead: an extension and a companion built with different sites refuse each other
  at the handshake, before a `browser.status` could list a tab of a site one of them doesn't know.
- New method: add it to `CompanionApi` or `ExtensionApi`; the serving side gets a type error until its
  handler exists.
