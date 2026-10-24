# The browser pages (`packages/ui`)

What ezapply shows in the user's browser: the **side panel**, where the user works ([below](#the-side-panel-srcpanel)),
and the **document review** and **onboarding** pages. All are React. The panel's components are bundled into the
extension; the two pages are built into static files the companion serves on its loopback server while ezapply
runs. The companion's own small pages (GitHub setup, a review that's gone) stay server-rendered HTML and only take
the package's stylesheet.

**Why pages for these two.** Review happens on every application, and a PDF is read, not chatted about: the page
shows the documents, marks what changed since the last review, and takes comments on the passages the user
selects. Onboarding is mostly form-filling the agent would only relay (a path, a choice of repositories, an
address, screening answers): on a page the user types into the files directly, nothing is transcribed, and no
chat turn is spent on it. What needs judgment stays the agent's ([onboarding](#the-onboarding-page-onboard)).
Everything else happens in the side panel ([philosophy](../philosophy.md)).

**Why React.** A template string with one inline script is enough for a form and a Send button, as the
companion's own pages are. The viewer (pages, highlights, comments, a diff) and onboarding (steps, forms,
the agent's progress arriving live) are state a component tree handles and string templates don't. **Why esbuild:** the
extension already builds with it; no dev server or framework build is needed.

| Path | Role |
|---|---|
| `build.mjs` | The build: pdf.js's worker and data files copied in, the two pages and the base stylesheet bundled, `manifest.json` written, the favicon |
| `static/mark.svg` | ezapply's mark ("ez" in white strokes on the accent): the favicon, and the source of the extension's icons ([extension](extension.md#builds-npm-run-build--w-ezapplyextension)) |
| `src/styles/base.css` | Tokens (light and dark by `prefers-color-scheme`), plain elements, the shared components' classes, full-window pages, and the companion's plain pages (`.ez-plain`) |
| `src/components/ui.tsx` | `Button`, `Badge`, `Spinner`, `Banner`, `Brand` (the mark drawn inline from `MARK`, and the wordmark), `MessagePage`, `Icon` (a small inline SVG set) |
| `src/lib/api.ts` | `pageBase` (from `#root`'s `data-base`), `dropTokenFromUrl`, `getJson`, `postJson`, `subscribe` (Server-Sent Events), `OfflineError` |
| `src/lib/pdf.ts` | pdf.js set up from `/ui/` (worker, fonts, maps, decoders), `loadPdf`: every page's size, text items and links read up front |
| `src/lib/links.ts` | `PdfLink`, `safeLinkUrl` (only web, mail and phone addresses), `linkRect` (a link's place as fractions of the page), `linkLabel` |
| `src/lib/text.ts` | `joinItems` (a page's text as the companion's `pdf_text` builds it), `itemsOf` (a stretch of that text → the parts of the text items it covers) |
| `src/review/` | The review page: `App.tsx`, `Viewer.tsx` (the PDF viewer, shared with onboarding), `Panel.tsx`, `changes.ts`, `draft.ts`, `selection.ts`, `review.css`, `viewer.css`, `textlayer.css` |
| `src/onboard/` | The onboarding page: `App.tsx`, `state.ts`, `parts.tsx`, `steps-setup.tsx`, `steps-documents.tsx`, `ProfileStep.tsx`, `onboard.css` |
| `src/panel/` | The side panel: `App.tsx`, `cards.tsx` (question and approval cards), `markdown.tsx`, `transport.ts`, `panel.css`. `@ezapply/ui/panel` exports `PanelApp` and the transport's types (with `@ezapply/ui/base.css` and `@ezapply/ui/panel.css`) for the extension to bundle |
| `test/review.test.tsx`, `test/panel.test.tsx`, `test/onboard.test.tsx`, `test/brand.test.ts` | Unit and component tests ([development](../development.md#tests)) |

## The build (`npm run build -w @ezapply/ui`)
- **Bundles:** `review` and `onboard` (`src/<page>/main.tsx`) and `base` (`src/styles/base.css`), as ES modules with
  code splitting (React and pdf.js land in one shared chunk), minified, with source maps, names carrying a hash
  (`review-<HASH>.js`). Targets Chrome 120, as the extension does. Each page's CSS bundle holds
  every stylesheet its modules import (the viewer's comes with `Viewer.tsx`).
- **pdf.js** (`pdfjs-dist`, the version the companion uses): its worker copied as `pdf.worker-<hash>.mjs`, whose
  address the bundle gets at build time (`__PDF_WORKER__`); `standard_fonts`, `cmaps`, `iccs` and `wasm` copied
  to `dist/pdfjs/`.
- **`manifest.json`:** `{ worker, base, pages: { review: { js, css }, onboard: { js, css } } }`. The companion
  reads it on every use, so a rebuild while a chat is open is served at once.
- **`favicon.svg`:** `static/mark.svg` copied, linked by every page. `Brand` draws the same mark inline (`MARK`),
  so the header needs no request; a test keeps the two the same.
- The root `npm run build` builds it after the extension; `npm run typecheck` checks it (`tsc -p
  packages/ui/tsconfig.json`).
- **Nothing from outside:** no CDN, no web fonts (the system font stack). The pages work offline and nothing about
  the user leaves the machine.

## Serving (`companion/src/ui/assets.ts`)
`UiAssets` finds `packages/ui/dist` through the workspace's link to `@ezapply/ui` (a companion dependency).
- **`/ui/<file>`:** files from `dist/` only (a path that leaves it, or holds a NUL, is a 404). Hashed names are
  cached for a year as immutable, everything else (pdf.js's data files, the favicon, `manifest.json`) for a day; `nosniff` and `Cross-Origin-Resource-Policy:
  same-origin` on all.
- **A page's HTML** (`page(res, page, title, base)`): an empty `#root` with `data-base` (the page's API path),
  the favicon, the base and page stylesheets, and the page's module script. Without a built UI, a 503 saying to
  run `npm run build`; `ezapply doctor` reports it too (`pages`).
- **The CSP** (`UI_CSP`): `default-src 'none'`; scripts only from the companion (`'self'`) plus
  `'wasm-unsafe-eval'` for pdf.js's image decoders; styles from the companion and inline (React and pdf.js
  position elements with them); images from the companion, `data:` and `blob:` (rendered pages); fonts from the
  companion and `data:`; connections and workers to the companion only; `frame-ancestors`, `base-uri` and
  `form-action` none. No inline script, so no nonce. Plus `X-Frame-Options: DENY` and no referrer.
- **The companion's own pages** (`htmlPage`, `util/html.ts`) link the base stylesheet and the favicon, and show
  the mark beside the name, when the UI is built (`useStylesheet`, set in `main.ts`), else a few inline rules. Their CSP allows the companion's own
  stylesheets and images.

## How a page talks to the companion
`companion/src/ui/session.ts` holds what both pages share.
- **The link carries a random token** (`?t=`, 24 random bytes). The first load with a valid token sets a cookie,
  `ezapply_page=<token>; Path=<the page's path>; HttpOnly; SameSite=Strict`, and the page takes the token off the
  address bar (`history.replaceState`), where it would sit in history and in anything the user copies. Every
  later request under that path (state, events, PDFs, actions) carries the cookie; `?t=` is still accepted
  (tests use it). A wrong or missing token is a 404, compared in constant time.
- **A request that changes something** (a POST) must carry `Origin` equal to `http://<the Host it was sent to>`,
  else 403. Browsers send `Origin` with every POST, so no other site can act, even one that learned the token.
  The loopback `Host` check stays in front of everything.
- **State and events:** each page reads its state as JSON and listens on a Server-Sent Events stream; the
  companion sends `event: state` when something changed and the page reads its state again. A comment line every
  25 s keeps the stream alive, and `EventSource` reconnects by itself (`retry: 2000`). The types both sides use are
  in `protocol/src/pages.ts`, types only, so the pages import them without bundling anything.
- **Offline:** a request that can't reach the companion says "ezapply isn't reachable. Is ezapply still
  running?"

## The side panel (`src/panel/`)
Everything the user does with ezapply after setup ("Everything in the browser"): the extension shows it as Chrome's
side panel ([extension](extension.md#the-side-panel)). It reaches ezapply through a
`PanelTransport`, which the extension implements over its background and tests fake: `call` (the companion's
`panel.*` methods: [agent](agent.md#the-panels-side-panelts)), `capture`, `tab`, `openTab`, `openSettings`,
`connection`, `subscribe` (pushes: the connection's state, "the tab changed", the companion's updates).

**Layout.** Only the conversation scrolls. The header sits above it, and the buttons and the chat box sit in the
footer below it, so however long the conversation gets, the buttons are next to where the user types. The
posting's details and its documents are in a popover from the header. Rejected: the posting card, buttons and
documents above the conversation in one scroll (a long conversation pushes the buttons out of reach); two
scrolling boxes, the controls capped at half the height (two cramped areas); a sticky posting strip under the
header; tabs for the chat and the posting; icon buttons in the header. The buttons belong where the user's
attention already is. The menus and the popover close on a click elsewhere.

**The list of applications first.** The panel opens on a list of every application, and opening one shows its
conversation, with a back arrow to the list. It is laid out for applications in parallel, an agent working in each at
once ([agent](agent.md#conversations-servicets)): each row says what that application waits on or what the agent is
doing in it, with no limit on how many there are. Rejected: a posting `<select>` in the header (it hid
every other application's state); a grouped popover from the header (the others are seen only once it's open); a
strip of tabs (it holds about eight, with company names only); an icon rail (it takes width from an already narrow
panel). The cost is one more click to switch, which the **needs-you line** makes up for. Capture is on the list
and not in an application, since it adds an application to the list.

**The list** (`Applications`, grouped by `applications()`): **Needs you** (a card waits in one of its conversations;
the row says which, and the card's title or the tool to approve), **Working** (an agent is in one or both of its
conversations, named: "Documents and Application: Claude Code is working"; a **Stop** button beside it stops those,
`panel.stop { key }` for each, and no other application's), **Open** (where it stands, from its `PostingStatus`), **Done** (submitted or archived), newest
first within each. The companion lists the 20 newest postings and any older one a card waits on or the
agent is in, so an application that needs the user is never left off. Opening a row opens that posting's conversations; the companion keeps no "active" posting. On
the list the footer has only the agent line and the agent settings, and the Needs you cards are only a terminal
chat's.

**The general conversation is pinned above the list** (`GeneralCard`), under the header and outside the part that
scrolls: a tinted card with a chat icon, "General" and what it's doing (what it waits on, "… is working", or what
it's for), a **Working** pill and a **Stop** button while the agent is in it, and a **Needs you** pill (the card
turns amber) while a card waits in it. It is never one of the groups. **Why:** it isn't an application, it has no
posting, status or documents, and a row that moved between the groups looked like one and was hard to find again.
Rejected: a row last under Other (it looked like an application); a pinned plain row with company
avatars on the applications (less distinct, more change to every row); a chat box in the list's footer (two chat
boxes that look alike, this one and an application's); tabs for Applications and General (the tabs rejected
above); a Chat button in the header (the header is already full at 320 px). The cost is the card's height on every
visit to the list.

Top to bottom, in an application:

1. **Header:** a back arrow to the list; a status dot (connected, not paired, an error, not running); the
   posting's role, with its company and site under it ("General" for the general conversation); for a posting, the **posting
   popover** (item 3), its button showing how many documents the posting has (amber while any isn't approved), and for the general conversation, which has no posting or documents, a
   **Reset** button (a circular-arrow icon; asks first: a new general session) in its place; a
   menu with Setup (opens the setup page) and Extension settings (the extension's options page: its port and
   pairing, opened by the panel itself). On the list, the header has ezapply's mark, the status dot,
   "Applications", **+ Capture** (the header's one tinted button: it captures the current tab as a posting and opens
   it; its title says it captures again on the posting's own page) and the menu. The wordmark gives way to the mark
   alone below 420 px, and the mark goes too below 360 px (Chrome's side panel is 320 px at its narrowest). No log
   view: the conversation shows every tool call, and the form log is in the posting's folder. Under the header, a
   **needs-you line** while another application (or the general conversation) waits on the user: it names that one
   and opens it, or says how many wait and goes back to the list. Then, for a posting, a switch between its two
   conversations, **Documents** and **Application** ([agent](agent.md#conversations-servicets)), a dot on each one
   an agent works in. The panel shows the one picked there, else one an agent works in for this posting, else
   Documents; opening another application starts over from that rule.
2. **When it can't work:** not running ("Start it in your workspace: `./ezapply`"), not paired, or the
   connection's error, as a banner; the rest is shown but disabled. Setup not finished is a banner of its own with
   **Continue setup** (the steps left are named); the rest stays usable, since setup's own tasks go to the agent.
3. **Posting popover:** role, company, site, deadline and the requirement chips from `notes.md`; the
   **documents**, the posting's PDFs, each **approved** (approved or attached) or **waiting for your review**
   (draft, under review, changes asked), the name opening the PDF and **Review** bringing a waiting review's tab back ("No documents
   yet." before there are any), an approved document with a **trash** button that deletes the PDF (asks first; its
   LaTeX source stays); **Mark submitted** (until the posting is submitted or archived: for a Submit the
   extension's watch missed, [postings](postings.md#status)), or **Mark open** once it is (in case a page was taken
   for a confirmation, or the click went astray); **Reset Conversation** (red when hovered; asks first: a new session for the conversation
   shown, documents or application; the files stay); and **Delete posting** (red when hovered; asks first; disabled
   while an agent works in either of the posting's conversations; refused while the posting has a review open), which deletes the posting's folder and both its conversations for good, after which the panel goes back to
   the list. The panel
   shows only approved or not because approving is the one thing the user does with a document. The finer states
   (`DocumentState`) and the posting's status (`PostingStatus`: drafting, attached, …) are still kept and used by
   the tools and skills; they just aren't shown. No posting-level "documents approved" tag either: each
   document's own tag already says it.
4. **Conversation** (the part that scrolls): the user's messages ("waiting for Claude Code", or for whichever agent is chosen, until taken), and a result ezapply delivered for them as a note by its label ("Your review: sent to Claude Code", [agent](agent.md#results-as-messages)) rather than the block the agent reads; Claude's text
   as Markdown built as elements, never as HTML (`Markdown`: paragraphs, lists, headings, code, bold and italics;
   links stay text); each tool call folded to one line (the tool's name without `mcp__ezapply__`, its summary),
   unfolding to its error or its summary, red when it failed, "…" while it runs; settled cards; each turn's end with
   its cost (the session's total less the turn before's), "Stopped" or "Failed: …"; notices. It follows the newest
   event.
5. **Needs you** (while anything waits), at the conversation's end, just above the buttons: the open cards of this
   application's two conversations and of a terminal chat, oldest first, one from the other conversation labelled
   with it (or "From a terminal chat", for a Claude Code run by hand in the workspace). Another application's
   cards wait for it on the list, and the needs-you line points to them. The panel scrolls them
   into view when one arrives. A **question card**: title, intro, each question by its type (radios,
   checkboxes with Other, a text field or box), the suggestion filled in and marked ("suggested"; a sensitive
   question is flagged and may have one too), `why` under it, "(optional)" ones skippable, **Save for next time**
   where offered; **Send answers** checks the answers first (`askAnswerProblems`, each problem under its
   question), and **Reply in chat instead** sends words in place of the answers. An **approval card**: what the agent
   wants to do, named as the one asking ("Codex wants to run a command"; Claude Code for a terminal chat's): run a
   command, write or edit a file (Codex's patch shows its files and diff), fetch a page, get more access, or the
   tool's input as JSON; its description,
   the command or the file and the change whole in a scrollable box, and **Allow**, **Deny**, **Deny with a reason**.
   An application's **hand-off card** (a `handoff` event in its conversation, `HandoffView` in `cards.tsx`):
   "Ready for you to submit", with what is attached, approved documents not attached, the answers to check
   (label, value, source), each step's open warnings and what was removed
   ([the hand-off](../mcp-tools.md#forms)).
6. **This tab** (first in the footer): what the window's current tab is to the posting shown (its page, its
   application on a site, including one embedded in a careers page's frame, another posting's application, another
   page; in the general conversation, only
   whether it's an application), read again when the tab changes.
7. **Action buttons**, acting on the chosen posting: **Tailor documents** (the resume, and the cover letter when the posting or the
   preferences call for one), with a menu (opening upwards) for the resume only, the cover letter only, or one PDF;
   **Fill form** on the application's tab, or **Open the application** when the tab isn't it and the posting knows
   its address. Each button sends its skill by name, then the request in words (`REQUESTS`: `/ezapply-resume …`,
   `/ezapply-cover-letter …`, `/ezapply-apply …`; one PDF names `bundle_build`, which has no skill), so the agent
   doesn't match words to a skill. Claude Code under stream-json input and Antigravity both run a message that
   starts with `/<skill>` as that skill, Antigravity also after the `<ezapply-panel>` block its first message
   carries (it reads the skill's file); for Codex, ezapply adds the skill to the message as an input item
   ([agent](agent.md#how-ezapply-drives-codex)). Fill form names the tab (`tabId`). Tailor documents goes to the posting's Documents conversation
   and Fill form to its Application one, whichever is shown, and the panel switches to it; typing goes to the
   conversation shown. They're disabled, with why in their title, without a posting
   or while an agent works in the conversation the button goes to: the other one, and every other application,
   can start at the same time. With a workspace change the work needs still pending, the request waits on the
   Workspace changes card ([below](#workspace-changes)).
   **Sending blocks at once:** from the press of anything that starts a turn (these buttons, Send, Enter) until the
   companion has answered the send and the state read after it says the agent works, the buttons and Send are
   disabled and the box is read-only (it keeps its focus); a ref holds it within the same frame, so a double click
   or a second Enter sends one message, not two. *Why not just "while Claude works":* the state says so only once
   the companion's answer arrives, and a second press in that gap would queue a second message.
8. **Chat bar:** a text box, Enter sends and Shift+Enter is a new line; Send, which is Stop while the agent works
   in this conversation and the box is empty (typing still sends: the message waits for the agent); a line above
   it with what the agent is doing in this conversation, named as the one in use ("Starting Antigravity…", "Claude
   Code is working…", messages waiting), then what it's doing elsewhere at the same time (one conversation named,
   "Also working on Acme: Developer · Application…", more counted), or that no agent is available (none was found when ezapply
   started). The panel's other lines that name the agent (busy titles, Reset's and a document delete's
   confirmations, a queued message's "waiting for …") name the one in use too.
9. **Settings line:** the agent (Claude Code, Antigravity or Codex, only when more than one is installed), the
   permission mode (for Claude Code and Codex Ask first, Accept edits, Auto, Plan only, Don't ask; for Antigravity
   Plan only and Don't ask; what each does for that agent in its title), the model (Claude Code's Fable, Opus,
   Sonnet, Haiku; Antigravity's and Codex's "Default model" and the ones ezapply listed), and for Claude Code and
   Codex the effort (Low to Max; Antigravity's models name their level), each agent's own. The extension keeps them
   (`transport.prefs`, `savePrefs`, a `prefs` push when another panel changes them), so they show as the panel
   opens, before ezapply answers, and a change shows at once; ezapply applies them to the running conversation
   ([agent](agent.md#permission-mode-model-and-effort)). What they come to is `effectiveSettings`, with the agents
   installed from the state (until it's read, the chosen one). Then the conversation's cost so far (the amount,
   its title saying what it is), or its tokens from an agent that reports no cost (Codex: "12k tokens"); each turn's
   end in the conversation shows its own the same way. It stays one row at any panel width: each select is as wide as its chosen option
   (`field-sizing: content`), and in Chrome's narrowest panel the agent, a listed model and the
   effort are cut short, never the mode or Claude Code's model.

Updates: an event for the conversation shown is added (a message's newer state replaces it: `withEvent`); a tool's
end or a turn's end, and every "changed", reads the state and the conversation again.

### Workspace changes
What in the workspace is out of date ([companion](companion.md#keeping-the-workspace-current-workspace_changes)),
for the user to act on: the panel's **Workspace changes** card (`panel/changes.tsx`), under the general card and
above the conversation, and the setup page's **Changes** list, both drawn by `WorkspaceChangesList`
(`components/changes.tsx`). Nothing listed, no card. The card is collapsed, its title counting the changes and the
ones the conversation's work uses; it reads the list for the conversation shown (the general one on the list of
applications) again on every "changed".

Each change is a line (its `summary`, **this work uses it** when `needed`) with buttons by kind: a template's
source changed (**Update now**, **Keep the current copy**), a template imported from a copy nothing edits (**Choose
the file I edit** or **Choose the folder**, which open the system's file dialog, or **I keep none**), a LaTeX
document in `library/` (**It's my resume**, **It's my cover letter**, **Neither**), the profile's name or contact
(**Update now**), an edited resume (**Update my profile**, **Nothing to change**), a repo's new commits (**Read it
again**, or **Put off** for a day, a week or a month), a repo no longer selected (**Select it again**, **Delete its
knowledge** after a confirm). Every kind but a repo's new commits has **Later**, which hides it in this
conversation until ezapply stops. **Update all N**
updates the ones that need no choice in one request. What each press did stays under the list after the change
leaves it ("Updated.", "Handed to Claude Code: follow it in the General conversation."), and a change being worked on
shows **Being updated…** instead of buttons. Then the repos put off, until when, and what couldn't be checked.

**Tailor documents and Fill form check first** (`panel.workspaceChanges` for the conversation they go to): with a
needed change pending that isn't being updated, the panel switches to that conversation and opens the card with
**Go on anyway** and **Cancel**, and nothing is sent until one is pressed. The check counts as sending, so a second
press meanwhile is refused; a check that fails sends at once. *Why not block:* the user may know the change doesn't
matter to this posting.

## The review page (`/review/<id>`)
What it's for and how approvals work: [documents](documents.md#review-before-attaching). Its routes, all under
`/review/<id>`:

| Route | Does |
|---|---|
| `GET` (with `?t=`) | The page; sets the cookie. 410 once the review expired |
| `GET state` | `ReviewPageState`: status (`open`, `answered`, `replaced`, `expired`), the posting's company and role, `agentName` (who gets the answer: the panel conversation's agent, or "Claude Code" for a terminal's review; the page names it wherever it says who revises or receives), and per file its name, size, `info` (pages, page size, text layer, encrypted: absent when it isn't a readable PDF), `pageLimit` for a file named like a resume, and `previous` (the version last reviewed); once answered, what was sent |
| `GET file/<n>` | The PDF's bytes as they were when the review opened; `?download=1` as an attachment |
| `GET events` | Server-Sent Events: `state` when the review is answered, replaced or expires |
| `POST answer` | `{ documents: [{ index, request?, comments?: [{ page, quote, note, rects? }] }] }` → 204; 409 `{ status }` when it isn't open any more; 400 for a body that isn't one |

**Layout.** The documents on the left (name, pages, whether it changed since the last review, and Approved,
Changes or To decide), the selected one in the viewer, its panel on the right, and a bar along the bottom with the
count approved, with changes and still to decide (and the sending, or why it failed). There's no separate Send
button: the panel's one button moves through the documents and sends after the last (below). **Why no "Approve
all":** what's attached goes to an employer, so each document is approved by a press of its own rather than by
leaving it untouched. Below 900 px the
documents become a row of tabs and the panel goes under the viewer. Every grid item has `min-width: 0`, so a row
that scrolls sideways never widens the page.

**The panel**, top to bottom: the checks (pages, over the resume page limit, the text layer an applicant-tracking
system reads, encryption); the document's **links** (each web, mail or phone address once, with the page it's
first on, openable from the list; "No web or email links" when there are none), so a link the build dropped is
noticed before the document goes to an employer; since the last review (first time, unchanged since you approved
it or asked for changes, or the list of changes, each pressed to show it on the page); the comments (each with its
number, the quoted words, the note, edit and remove); "Anything else to change?" for the whole document; and under
it, the one button. A comment or a request asks for changes and takes back an approval, so removing them
afterwards leaves the document to decide again rather than approved. The answer sent is unchanged: a document with
no comment and no request is the approved one.

**The one button** decides the document and moves on: **Approve Document**, or **Request Changes** once it has a
comment or a request. Either goes to the next document still to decide (after this one, then from the top) and
scrolls the page back to its top, since below 900 px the button sits under the viewer and the next document would
otherwise open with only its panel in view. On the
last one left it reads **Send to <agent>** (`agentName`, above) and sends the answer, with a line under it saying what that does to this
document (approves it as shown, or asks for its changes). An approved document shows **Undo approval** in its
place, the same size and shape but in the accent's soft tint instead of its fill, so it reads as the way back
rather than the next step; once every document is decided (a send that failed, or the user went back to one),
**Send to <agent>** under it. *Why one button:* approving and sending were two presses in two places, and the last
approval was always followed by the send. *Why under the edits box:* the decision follows what the user just wrote
(a comment or a request turns it into Request Changes). It stays stuck to the panel's bottom edge while the rest
scrolls, so it's in reach however long the panel gets; below 900 px, where the page scrolls rather than the panel,
it sits in place.

**Drafts** (`draft.ts`: each document's request, comments and approval) are kept in the tab's `sessionStorage` under the review's id, so a reload doesn't lose
what the user wrote; unavailable storage only means they aren't kept. Sending clears them.

**Sending** closes the tab on the 204 (a tab the companion opened has one page in its history, so the browser
allows it; taking the token off the address bar replaces the entry, adding none); where the browser refuses, the
page says "Sent to Claude. You can close this tab." A 409 reads the state again, which shows what happened.

### The viewer (`Viewer.tsx`)
pdf.js draws each page on a canvas, at the device's pixel ratio, once the page is within a screen and a half of
the view (an `IntersectionObserver`), and again at a new zoom. Each drawing goes to a new canvas swapped in when
done: pdf.js refuses a second drawing on a canvas whose first is still being cancelled, and the old one stays on
screen meanwhile. Over it, pdf.js's own text layer (`TextLayer`, with its rules copied unchanged from pdf.js's
viewer stylesheet into `textlayer.css`: the whole stylesheet is 160 KB of rules and images for a viewer this page
doesn't use), so text can be selected and found with the browser's own find; every page's text layer is there
from the start. **Why pdf.js, not the browser's viewer:** the same in every browser, and it can be drawn on.

- **Toolbar:** page n of m (the page a third of the way down the view), zoom out and in (steps from 50 % to
  300 %), Fit width (the default: the widest page across the viewer), Changes (when there are any), Download.
  Keys, outside a text field: ← and → go a page, + and − zoom, 0 fits the width.
- **Links:** the PDF's link annotations (`lib/links.ts`, read with each page in `loadPdf`), drawn over the text
  with a faint underline and a tint on hover, the address in their title. A web, mail or phone address opens in a
  new tab (`noopener noreferrer`); a link to a place in the same PDF scrolls to its page. Any other kind
  (`javascript:`, `file:`, a launch or form action) isn't drawn: a link's address can come from a posting or a
  template, and the page is served from the companion's origin.
- **Commenting:** text selected on one page (by mouse, or by keyboard with caret browsing) offers a Comment
  button by the selection. A selection that starts or ends inside a word takes the whole word, so the agent gets
  "building", not "uilding". The comment keeps the quoted words (spaces collapsed, at most 600 characters) and
  where they are, as boxes in fractions of the page's size (`PageRect`), merged per line, so they hold at any
  zoom. While the note is written the selection stays highlighted; Ctrl+Enter adds it, Escape cancels.
  **Commenting never moves the page:** the note's box opens under the selection, or above it when there's no room
  below in the view, and is focused without scrolling (focusing scrolls every container above a box, the page
  included); only when it fits neither way does the viewer alone scroll by the rest. A new comment becomes the
  active one, and the panel brings an active comment into view by scrolling itself only (`scrollWithin`), not with
  `scrollIntoView`, which also scrolled the page, down to the panel under the viewer on a narrow window. Comments
  show as highlights with their number in the page's left margin, where it covers no text. Without
  `onComment` (onboarding's previews) text can be selected but not commented on.
- **Changes since the last review:** inserted words highlighted on the text layer, a removal as a red marker
  where the words were (its words on hover), measured on the text layer's spans with DOM ranges after each
  render. The highlight lets the mouse through (`pointer-events: none`), so inserted words can be selected and
  commented on like the rest; what they replaced is in the panel's list of changes.

### What changed since the last review (`changes.ts`, `protocol/src/textdiff.ts`)
The companion keeps the text of each document when the user answers a review
([`reviewed.json`](../data-formats.md#postingsidreviewedjson-companionsrcdocumentsreviewts)) and gives it to the next review as
`previous.pages`. The page reads the new version's text from pdf.js, as the companion's `pdf_text` does (each
item, a line break after a line's last), so both sides compare the same text, and diffs the two with the shared
module the companion's `pdf_text { sinceReviewed }` uses:
- **Words, on collapsed text:** whitespace and line breaks separate words and are otherwise ignored, because a
  word changed early in a paragraph reflows every line after it and a line diff would mark them all. A word broken
  by a hyphen at a line's end, followed by a lower-case one, is one word. Each word is normalised: NFKC (ligatures
  unfolded), quotes and dashes unified, soft hyphens and zero-width characters dropped.
- **The PDF's text, not the LaTeX source:** it's what the user approves, and a bundle or an imported template has
  no source of ezapply's.
- **Myers' diff** on the words after their common ends, grouped into hunks of adjacent removals and insertions.
  Past 2,000 edits (the saved frontiers grow with the square of the edits) the middle is one change.
- **Each change as text** (`describeHunk`): its page in the new version (for a pure removal, the page of the word
  after it), the words removed and added, and up to five words before it on that page. Each mark keeps the
  added words' places in each page's text; `itemsOf` maps those to the text items' spans.

Approvals stay per version (the hash): the diff is a reading aid. A renamed file has no history.

## The onboarding page (`/onboard`)
The `workspace_check` items as steps the user works through in any order, done ones ticked, required and optional
marked, with a progress bar. One page per chat (`OnboardingService`, `companion/src/onboarding/service.ts`): the
token is made on the first `onboarding` call and kept for the chat. The address's hash names the step shown
(`#repos`): `onboarding { step }` opens the link with it, a page already open gets a `step` event that sets it, and
moving between steps updates it, so a reload stays on the step. Without one the page opens on the first required
step not done.

| Route | Does |
|---|---|
| `GET` (with `?t=`) | The page; sets the cookie (`Path=/onboard`) |
| `GET state` | `OnboardState`: status (`open`, `finished`), `ready`, the agent file's state, the steps, the tasks, whether the agent is listening, and per step what it shows ([below](#what-each-step-does)) |
| `GET events` | Server-Sent Events: `state` on every change, `step { step }` when the agent opens the open page at a step |
| `GET repos` | The repositories the GitHub app can read, each with `selected`, `suggested` and `skipReason`, then the selected ones added by address (`source: "public-url"`), so saving the list keeps them |
| `GET file?path=` | A built template's PDF, under `templates/` only |
| `POST action` | `{ action, … }` (below); the answer, or 400 `{ error, hint? }` with an `EzError`'s words |
| `POST library?name=` | A file's bytes into `library/` |

**Seeing changes made elsewhere.** A login finished in GitHub's tab, the extension connecting, a repository the
agent indexed: none of them goes through the page. While a page listens, the companion compares its state every
2 s (`workspace_check` is cheap) and sends `state` when it differs; the page also reads it again whenever its
window gets focus. The comparison stops when no page listens. The resume's and cover's `builtAt` (their PDF's
modified time) are part of that state, and each preview reloads when it changes, so a template the agent
rebuilt from the panel's chat shows here without a task.

### What each step does
| Step | On the page | Action |
|---|---|---|
| LaTeX | The engine found; else the install command for this OS and, where ezapply can run it (`canInstall`), **Install it**, which shows **Installing…**, a Terminal window to watch on a Mac, or why it failed; elsewhere the command to run and **Check again** | `installTex` (`util/install-tex.ts`, [below](#installing-tex)) |
| Browser extension | The steps for Chrome and other Chromium browsers and the folder to load (copyable: a page can't open `chrome://extensions`); **connect** opens the 15-minute pairing window and the step turns green when it connects; a warning when the extension isn't built | `pair` (`startPairing`, shared with `extension_pair`, `bridge/pairing.ts`) |
| GitHub | Without an app: create a new one or connect an existing one; **Continue on GitHub** opens the `/github/` flow in a new tab (opened in the click, so it isn't blocked, then pointed at the address the companion gives); a port mismatch's hint | `github` |
| Repositories | Every repository with language, last push, description, private, a search, and the ones left out (forks, archived, under 10 KB, the profile README repo, dotfiles or config) behind a toggle; nothing selected yet → the rest preselected; a link to give the app access to a missing one; a field for a public repository the user contributed to but doesn't own (its address or `owner/name`), saved at once and listed ticked | `repos` (sources of repos added by URL kept), `addRepo { url }`: refused when it isn't a GitHub address, when the app lists it (tick it there, keeping the app's access), or when it doesn't answer an anonymous `ls-remote` (private, or no such repo); else appended with `source: "public-url"` |
| Your projects, read | Each selected repository read or not; **Have Claude read N repositories** | task `index-repos` |
| Your resume | A folder or one `.tex` file, typed or chosen with **Browse…**; **Import and build**; the build's outcome (pages, over the limit, its first error) and a preview; a build that fails offers **Ask Claude to fix the build** | `browse`, `import` (`template_import`, then `tex_compile`), task `fix-template-build` |
| Your profile | None yet: **Have Claude draft it from my resume**. Then a form of every field the schema has, the often-asked ones marked when empty, the schema's errors under their fields; a draft that arrives replaces the form unless the user has started editing | task `draft-profile`, `profile` |
| Cover letter | Keep the template (and **Put my name and contact in it** for ezapply's default, set by code and built, **Match my resume's look**, **Show a preview**), use one's own LaTeX (as for the resume), or drop an example letter; a preview, and under it where to ask for any other change (the panel's chat) | `coverIdentity`; tasks `restyle-cover`, `cover-from-example`; `compile`, `import` |
| Screening questions | The unanswered ones, eight at a time, the suggestion filled in (a sensitive one's too: Claude still asks about it every time, suggesting what's saved; left empty, there's no suggestion); **Save these**. Then, read-only, the questions [answered from the profile](profile-and-templates.md#answer-bank-profileanswersyaml), each with what the profile holds or that it holds nothing yet | `answers` |
| Preferences | Before a document is attached (approval first, or at once), then tone, emphasis, never mention, target roles and places, cover letters. Below them, a setting of its own, saved the moment it's changed (it's the extension's behaviour, not how Claude writes): **Notify me when Claude finishes a reply or asks me something** ([notifications](extension.md#notifications-notifyts)) | `preferences` (`attach_mode`'s setting and `profile/preferences.md`); `notifications { turnEnd }` (`notifications.turnEnd` in `ezapply.config.json`) |
| Library | A drop zone (or the browser's picker: here only contents are needed), the files there, each with a trash button that deletes it for good after asking | `library` |

Plus **Finish setup** (**Finish later** while required steps remain), which ends the agent's wait. Claude's pane
lists the tasks and says that questions and changes no button covers are asked in the panel's chat (in the
terminal, without a panel agent). **Why no chat on the page:** the panel's general conversation already is one;
a second box split the conversation, could only answer in a task's one-line note, and every free-text request
needed a task kind of its own. The page keeps buttons whose task is fixed. A finished page says
what's next (capture a posting with the panel's Capture or Alt+Shift+P); asking the agent to set up again reopens
it. A missing or unimported `EZAPPLY.md` shows as a banner: `ezapply init` fixes it, not the page.

**Actions** (`POST action`, validated with zod): `task { kind, params }`, `pair { replace? }`, `github { app? }`,
`repos { repos }`, `addRepo { url }`, `browse { kind: folder | tex, title? }`, `import { kind, source, main?, replace? }`,
`compile { kind }`, `coverIdentity` (the cover's `\myname` and `\mycontact` from the profile, as the
Workspace changes card sets them: [companion](companion.md#acting-on-a-change-workspaceupdates); refused for a
template the user imported, whose layout ezapply doesn't know), `installTex`, `change { ids, change: update | later | done, hours?, kind?, pick?, confirm? }` (the Changes list's
buttons, as `panel.workspaceChange` with the key `setup`), `profile { value }`, `answers { answers }`, `preferences { attachMode, tone, emphasis,
neverMention, targets, coverLetters }`, `deleteLibrary { name }` (only a file the step lists, by its exact name, so no
name reaches outside `library/`), `finish`. `import`, `compile` and `coverIdentity` end with a build of the template,
and a build that can't run (no TeX engine yet) comes back as a failed build with its hint, not a refused action, so
the import or the name and contact it followed stay done and the page says why it didn't build.

### The agent's side: tasks
What needs judgment goes to the agent as a task: `index-repos`, `fix-template-build`,
`draft-profile`, `fill-cover-identity`, `restyle-cover`, `cover-from-example`, `update-profile` (the profile from an
edited resume's diff), each with `how`, what to do (`HOW` in the service), so no skill is needed for it. The
Workspace changes card queues them too (`OnboardingService.queue`), as "Workspace task tN"; a task queued with a
follow-up runs it when reported done (marking the change done). Where the agent is decides how it
gets one (`agentIn` in the page's state):
- **Under `ezapply` (`panel`):** the page's task is at once a message to the panel's general conversation
  ([agent](agent.md)): "Setup task t3 from the setup page (kind)", its `how`, its parameters, and how to report:
  `onboarding { taskId, result: { ok, note? } }`, which marks it done or failed with the note and
  returns. The task is running from then, whatever other conversations the agent works in; a send that fails
  (no agent) fails the task with why, and the page offers it again. A turn that carried the task and ends without
  its report fails it too, saying why: the user pressed Stop ("Stopped before it finished"), the turn ended with an
  error, or the agent ended it without reporting (its reply is in the panel). Without this, a stopped task would
  spin on the page forever, since nothing else ends it. A report that comes later (the user answers in the panel
  and the agent reports then) still marks it done. The page shows the agent as listening while it is available,
  and says to follow it in the ezapply panel, where its commands are approved.
- **Without a panel agent (`terminal`; a companion started without Claude Code, which only tests do):** the agent sits in a blocking [`onboarding { wait: true }`](../mcp-tools.md#setup-and-status)
  call; a task the page queues wakes it, and it gets `{ id, kind, params, how }`. Its report
  (`onboarding { taskId, result, wait: true }`) marks the task done or failed and waits for the next in the same call. Tasks
  are taken in the order asked, one at a time; a task taken and never reported is given again, in case the agent
  lost track of it. The page shows whether the agent is listening; a queued task while it isn't says to tell
  Claude in the terminal to continue.

The page shows each task (queued, running, done with the agent's note, failed). Wherever it speaks of the agent
(the task lines, its pane, the buttons that ask it), it uses `agentName` from the page's state: the agent the panel
uses (Claude Code, Antigravity or Codex, `AgentService.agentName`), or Claude Code in a terminal. The step texts in the
table above say "Claude" for short.

### Installing TeX
**Install it** runs this system's install command from the companion, in the background (`installTex`, one at a
time; the page follows `tex.install` in its state, and the step turns green once `workspace_check` finds an
engine):
- **Windows:** `winget` installs MiKTeX, then `initexmf` lets it fetch the packages a document needs without a
  prompt nobody would see. The installer asks for elevation itself if it needs it. Done when an engine is found
  afterwards (`which` adds MiKTeX's folders to `PATH`); else the output's last line says why.
- **macOS with Homebrew:** a Terminal window runs `brew install --cask mactex-no-gui`, since the installer asks
  for the password and only a terminal can. Nothing waits on it.
- **Linux with `pkexec` and `apt-get`:** `pkexec apt-get install -y texlive-xetex latexmk`, polkit asking for
  the password.
- **Anything else** (no `winget`, no Homebrew, another package manager): no button, the command to run.

*Why the page, not the agent:* installing is the same fixed command every time, with nothing to judge, so a turn of
the agent's (and its approval card) added only a wait. The user approves through the system instead: the
installer's elevation prompt, polkit's or sudo's password. The page sends no command, only `installTex`, so a
stolen page token can start this one install of TeX and nothing else.

### Writing the user's files
- **The profile** (`ProfileService.saveProfile`): only the top-level keys the schema models are written, each
  object key by key and in place in the YAML document, so the user's comments, their order and keys of their own
  survive; lists are written whole. An empty string, undefined or empty object removes the key: the form leaves a
  field empty to say it isn't known (a yes/no "Not said" is left out, so forms ask). The result must validate
  against `Profile`, else nothing is written and the issues come back by path. The form sends a phone without a
  number as none, and drops empty fields and blank lines inside list items.
- **Answers** (`saveAnswers`): each id's `answer` set in place (empty: null, asked every time); unknown ids are
  skipped; the file must still validate.
- **Preferences** (`savePreferences`): under fixed headings ([format](../data-formats.md#profilepreferencesmd)),
  keeping what the file held under other headings.
- **Library:** the name only (no folders, nothing Windows refuses, nothing below a space), PDF, Word, images,
  text and LaTeX, up to 25 MB, never over another file (`-2`, `-3`…).
- **Paths for templates** come from the OS's own dialog (`util/dialog.ts`): a WinForms folder or file dialog
  through PowerShell (`-STA`, an owner form kept on top), `osascript` on macOS, `zenity` or `kdialog` on Linux;
  none there → the page asks for the path typed. **Why not the browser's file picker:** it gives the file's
  contents, never its path, and `template_import` must record the path to watch the user's later edits. No shell
  runs any of it: PowerShell and AppleScript read the title from the environment, the Linux programs take it as an
  argument. The dialog may open behind the browser; the page says so while it waits.

## Look
Tokens as CSS custom properties (surfaces, text, accent, ok, warn, danger, the diff's and comments' colours,
radii, shadows, the focus ring), redefined for dark mode. A few components of the package's own, no component
library; visible focus, labels on every field, landmarks, `aria-current` on the selected document and step,
live regions for page numbers and counts. The rendered PDF pages stay white in dark mode.
