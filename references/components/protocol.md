# Protocol (`packages/protocol`)

Schemas and types only: no I/O, no Node or browser APIs. Both the companion and the extension import it,
so a change here is a change to the contract between them.

| Module | Contents |
|---|---|
| `bridge.ts` | `PROTOCOL_VERSION`, close codes, handshake and envelope messages, `CompanionApi` / `ExtensionApi` method maps, `parseBridgeMessage` |
| `rpc.ts` | `RpcPeer`: symmetric, validated request/response over any message channel |
| `forms.ts` | `FormSchema`, `Field`, `FillAction`, `FillResult`, `NextResult`, `OptionInfo`, `PageKind`, `PageAction`, `UploadFile`, `RemoveResult`, and the extension's form methods |
| `postings.ts` | `CapturePayload`, `CaptureResult`, `PostingMeta`, `PostingMetaPatch`, `PostingStatus`, `SiteId` |
| `browser.ts` | `TabInfo` (`tabId`, `windowId`, `url`, `title`, `active`, `focused?`, `lastAccessed?`, `site`), `BrowserStatus`, `detectSite(url)` |
| `errors.ts` | `ErrorCode`, `ErrorPayload`, `EzError` |
| `workday.ts` | Workday facts shared by the companion and the in-page adapter, with no imports (so the adapter bundle stays free of zod; imported as `@ezapply/protocol/workday`): `WORKDAY_HOST` (`*.myworkdayjobs.com`, `*.myworkdaysite.com`), `WORKDAY_HOST_PERMISSIONS`, `isWorkdayUrl`, `workdayTenant(url)`, `WORKDAY_LOCALE_SEGMENT`, and the posting-page hooks `WORKDAY_POSTING` |

The package exports `.` (everything) and `./workday`. `detectSite` counts only candidate-facing Workday
hosts as Workday: `www.workday.com` is marketing and `*.myworkday.com` are employee tenants.

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

### Methods

`CompanionApi` (served by the companion):

| Method | Params → result |
|---|---|
| `posting.capture` | `CapturePayload` → `CaptureResult { postingId, isNew, company?, role? }` |

`ExtensionApi` (served by the extension):

| Method | Params → result |
|---|---|
| `browser.status` | `{}` → `BrowserStatus { extensionVersion, tabs[] }` |
| `form.get` | `{ tabId? }` → `FormSchema` |
| `form.listOptions` | `{ tabId?, fieldId }` → `OptionInfo[]` |
| `form.searchOptions` | `{ tabId?, fieldId, query }` → `OptionInfo[]` |
| `form.fill` | `{ tabId?, fills: FillAction[] }` → `FillResult[]` |
| `form.upload` | `{ tabId?, fieldId, file: UploadFile }` → `FillResult` |
| `form.remove` | `{ tabId?, fieldId, values? }` → `RemoveResult { fieldId, ok, removed, remaining, notFound?, error? }` (no `values` = all). Added without a version bump; an older extension answers "Unknown method" |
| `form.removeRepeatable` | `{ tabId?, sectionId }` → `RemoveRowResult { sectionId, ok, removed?, error? }`. Added without a version bump, like `form.remove` |
| `form.addRepeatable` | `{ tabId?, addButtonId }` → `{ ok, error? }` |
| `form.next` | `{ tabId? }` → `NextResult` |
| `form.back` | `{ tabId? }` → `BackResult { moved, pageKind, step?, errors[], messages?, refusedReason? }`. Added without a version bump |
| `form.pageAction` | `{ tabId?, action: PageAction }` → `{ ok, pageKind, error? }` |
| `tab.screenshot` | `{ tabId? }` → `{ tabId, pngBase64 }` |

## Form schema

What the adapter reports of an application page (`FormSchema`; Claude gets a leaner copy, see
[mcp-tools](../mcp-tools.md#forms)): `adapter`, `tabId`, `url`, `tenant?`, `pageKind`,
`step? { index?, total?, title }`, `sections[] { id, title, fields[], removable? }`,
`addButtons[] { id, label, section? }` (`section`: the heading the button sits under), `actions[]` (page
actions available), `errors[]`, `messages?` (notices such as "resume.pdf successfully uploaded", which live
Workday shows in the same alert region as errors), `nextLabel?`, `backLabel?`.

- `PageKind`: `posting`, `auth`, `start-choice`, `step`, `review`, `confirmation`, `unknown`.
- `PageAction`: `apply`, `apply_manually`, `autofill_with_resume`, `use_last_application`.
- `Field`: `id` (stable within the page: section + automation id, `#n` for repeats), `automationId?`,
  `label`, `helpText?`, `required`, `kind`, `options?`, `optionsLazy?`, `dateParts?`, `multiple?`,
  `currentValue` (string, string[], boolean or null), `error?`, `hint? { profileKey }`.
- `FieldKind`: `text`, `textarea`, `number`, `password`, `date`, `dropdown`, `typeahead`, `radio`,
  `checkbox`, `checkbox-group`, `file`.
- `FillValue`: a string, a string array, or a boolean. `FillResult`: `{ fieldId, ok, readBack?, error?,
  availableOptions?, unmatched?, inexact? }`: `unmatched[] { value, suggestions[] }` lists typeahead entries
  that matched nothing, with the options their search showed; `inexact[] { value, selected }` those for which
  Workday selected an option itself. `OptionInfo`: `{ label, hasChildren? }` (children = a nested menu).
- `NextResult`: `{ advanced, pageKind, step?, errors[], messages?, refusedReason? }`; `advanced` = the step
  index, title or page kind changed. `BackResult`: `{ moved, pageKind, step?, errors[], messages?,
  refusedReason? }`.

## Postings

`CapturePayload`: `url`, `pageTitle`, `html` (body verbatim), `visibleHtml`, `visibleText`, `jsonLd[]`,
`frameUrl?` (the content came from this embedded frame; `url` and `pageTitle` are still the tab's),
`capturedAt`, `tabId`. `PostingMeta` and `PostingStatus` are described in
[data-formats.md](../data-formats.md#postingsidmetajson-protocolsrcpostingsts).

## Errors

`EzError { code, message, hint? }`, serialized as `ErrorPayload`. Codes: `bad_request`, `unauthorized`,
`protocol_mismatch`, `not_paired`, `extension_disconnected`, `timeout`, `not_found`, `no_active_posting`,
`capture_failed`, `path_not_allowed`, `internal`. `EzError.from(anything)` wraps unknown errors as
`internal`.

## Changing the protocol
- Additive, optional fields: no version bump (both sides ignore unknown fields). Examples: code-less
  pairing added the optional `welcome.pairingToken`, and idle shutdown added `hello.pendingCapture` and
  close code 4005 (4005 went again with the background daemon; the companion now closes with 1001 when its
  chat ends, which every extension treats as a plain disconnect); later `TabInfo.focused` and
  `lastAccessed`, `Section.removable`, `CapturePayload.frameUrl`, `FormSchema.backLabel` and the
  `form.removeRepeatable` and `form.back` methods, `hello.browser`, and `addButtons[].section`,
  `FormSchema.messages`, `NextResult`/`BackResult.messages` and `FillResult.unmatched`/`inexact`.
  `PROTOCOL_VERSION` stayed 2.
- Anything else that changes a message or a method's schema: bump `PROTOCOL_VERSION`. Old and new sides
  then refuse each other with a hint naming the side to rebuild.
- New method: add it to `CompanionApi` or `ExtensionApi`; the serving side gets a type error until its
  handler exists.
