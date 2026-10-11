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

**Why React.** The earlier review page was a template string with one inline script, enough for a form and a
Send button. The viewer (pages, highlights, comments, a diff) and onboarding (eleven steps, forms, the agent's
progress arriving live) are state a component tree handles and string templates don't. **Why esbuild:** the
extension already builds with it; no dev server or framework build is needed.

| Path | Role |
|---|---|
| `build.mjs` | The build: pdf.js's worker and data files copied in, the two pages and the base stylesheet bundled, `manifest.json` written, the favicon |
| `src/styles/base.css` | Tokens (light and dark by `prefers-color-scheme`), plain elements, the shared components' classes, full-window pages, and the companion's plain pages (`.ez-plain`) |
| `src/components/ui.tsx` | `Button`, `Badge`, `Spinner`, `Banner`, `Brand`, `MessagePage`, `Icon` (a small inline SVG set) |
| `src/lib/api.ts` | `pageBase` (from `#root`'s `data-base`), `dropTokenFromUrl`, `getJson`, `postJson`, `subscribe` (Server-Sent Events), `OfflineError` |
| `src/lib/pdf.ts` | pdf.js set up from `/ui/` (worker, fonts, maps, decoders), `loadPdf`: every page's size and text items read up front |
| `src/lib/text.ts` | `joinItems` (a page's text as the companion's `pdf_text` builds it), `itemsOf` (a stretch of that text → the parts of the text items it covers) |
| `src/review/` | The review page: `App.tsx`, `Viewer.tsx` (the PDF viewer, shared with onboarding), `Panel.tsx`, `changes.ts`, `draft.ts`, `selection.ts`, `review.css`, `viewer.css`, `textlayer.css` |
| `src/onboard/` | The onboarding page: `App.tsx`, `state.ts`, `parts.tsx`, `steps-setup.tsx`, `steps-documents.tsx`, `ProfileStep.tsx`, `onboard.css` |
| `src/panel/` | The side panel: `App.tsx` (`PanelApp`, `Conversation`, `REQUESTS`, `withEvent`), `cards.tsx` (question and approval cards: `AskCardView`, `PermissionCardView`, `initialDraft`, `answerOf`, `permissionBody`), `markdown.tsx`, `transport.ts` (`PanelTransport`), `panel.css`, `index.ts`. Exported as `@ezapply/ui/panel` (with `@ezapply/ui/base.css` and `@ezapply/ui/panel.css`) for the extension to bundle |
| `test/review.test.tsx`, `test/panel.test.tsx` | Unit and component tests ([development](../development.md#tests)) |

## The build (`npm run build -w @ezapply/ui`)
- **Bundles:** `review` and `onboard` (`src/<page>/main.tsx`) and `base` (`src/styles/base.css`), as ES modules with
  code splitting (React and pdf.js land in one shared chunk), minified, with source maps, names carrying a hash
  (`review-<HASH>.js`). Targets Chrome 120 and Firefox 128, as the extension does. Each page's CSS bundle holds
  every stylesheet its modules import (the viewer's comes with `Viewer.tsx`).
- **pdf.js** (`pdfjs-dist`, the version the companion uses): its worker copied as `pdf.worker-<hash>.mjs`, whose
  address the bundle gets at build time (`__PDF_WORKER__`); `standard_fonts`, `cmaps`, `iccs` and `wasm` copied
  to `dist/pdfjs/`.
- **`manifest.json`:** `{ worker, base, pages: { review: { js, css }, onboard: { js, css } } }`. The companion
  reads it on every use, so a rebuild while a chat is open is served at once.
- **`favicon.svg`:** ezapply's mark, linked by every page.
- The root `npm run build` builds it after the extension; `npm run typecheck` checks it (`tsc -p
  packages/ui/tsconfig.json`).
- **Nothing from outside:** no CDN, no web fonts (the system font stack). The pages work offline and nothing about
  the user leaves the machine.

## Serving (`companion/src/ui/assets.ts`)
`UiAssets` finds `packages/ui/dist` through the workspace's link to `@ezapply/ui` (a companion dependency).
- **`/ui/<file>`:** files from `dist/` only (a path that leaves it, or holds a NUL, is a 404). Hashed names are
  cached for a year as immutable, pdf.js's data files for a day; `nosniff` and `Cross-Origin-Resource-Policy:
  same-origin` on all.
- **A page's HTML** (`page(res, page, title, base)`): an empty `#root` with `data-base` (the page's API path),
  the favicon, the base and page stylesheets, and the page's module script. Without a built UI, a 503 saying to
  run `npm run build`; `ezapply doctor` reports it too (`pages`).
- **The CSP** (`UI_CSP`): `default-src 'none'`; scripts only from the companion (`'self'`) plus
  `'wasm-unsafe-eval'` for pdf.js's image decoders; styles from the companion and inline (React and pdf.js
  position elements with them); images from the companion, `data:` and `blob:` (rendered pages); fonts from the
  companion and `data:`; connections and workers to the companion only; `frame-ancestors`, `base-uri` and
  `form-action` none. No inline script, so no nonce. Plus `X-Frame-Options: DENY` and no referrer.
- **The companion's own pages** (`htmlPage`, `util/html.ts`) link the base stylesheet and the favicon when the UI
  is built (`useStylesheet`, set in `main.ts`), else a few inline rules. Their CSP allows the companion's own
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
side panel or Firefox's sidebar ([extension](extension.md#the-side-panel)). It reaches ezapply through a
`PanelTransport`, which the extension implements over its background and tests fake: `call` (the companion's
`panel.*` methods: [agent](agent.md#the-panels-side-panelts)), `capture`, `tab`, `openTab`, `connection`,
`subscribe` (pushes: the connection's state, "the tab changed", the companion's updates).

**Layout.** Only the conversation scrolls. The header sits above it, and the buttons and the chat box sit in the
footer below it, so however long the conversation gets, the buttons are next to where the user types. The
posting's details and its documents moved into a popover from the header. An earlier layout put the posting
card, the buttons and the documents above the conversation in the same scroll, so a long conversation pushed the
buttons out of reach. Splitting that into two scrolling boxes (the controls capped at half the height) fixed the
reach but split the panel into two cramped areas. The other candidates were a sticky posting strip under the
header, tabs for the chat and the posting, and icon buttons in the header. The footer layout was chosen because the
buttons belong where the user's attention already is. Capture sits beside the picker rather than with
the footer's buttons: it adds a posting to choose from, while those act on the chosen one, and among them it read
as one of the posting's own actions. The menus and the popover close on a click elsewhere. Top
to bottom:

1. **Header:** ezapply's mark; a status dot (connected, not paired, an error, not running); the posting picker (the
   20 newest postings and "No posting (general)"; choosing a posting makes it active); **+ Capture**, the header's one
   tinted button, which captures the current tab as a posting and follows the new active posting (its title says
   it captures again on the posting's own page; the label stays, so the header doesn't change width), and keeps its
   full width while the picker's label is cut short in a narrow panel. To leave the picker room to read, the
   wordmark gives way to the mark alone below 420 px, and the mark goes too below 360 px (Chrome's side panel is
   320 px at its narrowest); the **posting popover**
   (item 3), its button showing how many documents the posting has (amber while any isn't approved); a menu with
   Setup (opens the setup page) and Extension settings (the extension's options page: its port and pairing, opened
   by the panel itself). No log view: the conversation shows every tool call, and the form log is in the posting's
   folder.
2. **When it can't work:** not running ("Start it in your workspace: `./ezapply`"), not paired, or the
   connection's error, as a banner; the rest is shown but disabled. Setup not finished is a banner of its own with
   **Continue setup** (the steps left are named); the rest stays usable, since setup's own tasks go to the agent.
3. **Posting popover:** role, company, site, deadline and the requirement chips from `notes.md`; the
   **documents**, the posting's PDFs, each **approved** (approved or attached) or **waiting for your review**
   (draft, under review, changes asked), the name opening the PDF and **Review** bringing a waiting review's tab back ("No documents
   yet." before there are any), an approved document with a **trash** button that deletes the PDF (asks first; its
   LaTeX source stays); **Reset Conversation** (red when hovered; asks first: a new conversation for the posting;
   the documents stay); and **Delete posting** (red when hovered; asks first; disabled while Claude works),
   which deletes the posting's folder and its conversation for good, after which the panel follows the active
   posting again (none). For the general conversation, a line saying there's no posting. The panel
   shows only approved or not because approving is the one thing the user does with a document. The finer states
   (`DocumentState`) and the posting's status (`PostingStatus`: drafting, attached, …) are still kept and used by
   the tools and skills; they just aren't shown. A posting-level "documents approved" tag was dropped as well:
   each document's own tag already says it.
4. **Conversation** (the part that scrolls): the user's messages ("waiting for Claude" until taken); Claude's text
   as Markdown built as elements, never as HTML (`Markdown`: paragraphs, lists, headings, code, bold and italics;
   links stay text); each tool call folded to one line (the tool's name without `mcp__ezapply__`, its summary),
   unfolding to its error or arguments, red when it failed, "…" while it runs; settled cards; each turn's end with
   its cost (the session's total less the turn before's), "Stopped" or "Failed: …"; notices. It follows the newest
   event.
5. **Needs you** (while anything waits), at the conversation's end, just above the buttons: every open card, oldest
   first, a card from another conversation labelled with it (or "From a terminal chat"). The panel scrolls them
   into view when one arrives. A **question card**: title, intro, each question by its type (radios,
   checkboxes with Other, a text field or box), the suggestion filled in and marked ("suggested"; a sensitive
   question is flagged and may have one too), `why` under it, "(optional)" ones skippable, **Save for next time**
   where offered; **Send answers** checks the answers first (`askAnswerProblems`, each problem under its
   question), and **Reply in chat instead** sends words in place of the answers. An **approval card**: what Claude
   wants to do (run a command, write or edit a file, fetch a page, or the tool's input as JSON), its description,
   the command or the file and the change whole in a scrollable box, and **Allow**, **Deny**, **Deny with a reason**.
6. **This tab** (first in the footer): what the window's current tab is to the active posting (its page, its
   application on a site, another posting's application, another page), read again when the tab changes.
7. **Action buttons**, acting on the chosen posting: **Tailor documents** (the resume, and the cover letter when the posting or the
   preferences call for one), with a menu (opening upwards) for the resume only, the cover letter only, or one PDF;
   **Fill form** on the application's tab, or **Open the application** when the tab isn't it and the posting knows
   its address. Each button sends its request in words (`REQUESTS`), the same as typing it, so the skills pick it
   up either way; Fill form names the tab (`tabId`). They're disabled, with why in their title, without a posting
   or while Claude works.
8. **Chat bar:** a text box, Enter sends and Shift+Enter is a new line; Send, which is Stop while Claude works in
   this conversation and the box is empty (typing still sends: the message waits for Claude); a line above it with
   what the agent is doing ("Starting Claude…", "Claude is working…", working on another posting, messages
   waiting), or that the agent runs only under `ezapply`.
9. **Settings line:** the permission mode (Ask first, Accept edits, Auto, Plan only, Don't ask; what each does in
   its title), the model (Fable, Opus, Sonnet, Haiku) and the effort (Low to Max), which ezapply keeps and applies
   to the running conversation, the effort from its next message
   ([agent](agent.md#permission-mode-model-and-effort)); and the conversation's cost so far.

Updates: an event for the conversation shown is added (a message's newer state replaces it: `withEvent`); a tool's
end or a turn's end, and every "changed", reads the state and the conversation again.

## The review page (`/review/<id>`)
What it's for and how approvals work: [documents](documents.md#review-before-attaching). Its routes, all under
`/review/<id>`:

| Route | Does |
|---|---|
| `GET` (with `?t=`) | The page; sets the cookie. 410 once the review expired |
| `GET state` | `ReviewPageState`: status (`open`, `answered`, `replaced`, `expired`), the posting's company and role, and per file its name, size, `info` (pages, page size, text layer, encrypted: absent when it isn't a readable PDF), `pageLimit` for a file named like a resume, and `previous` (the version last reviewed); once answered, what was sent |
| `GET file/<n>` | The PDF's bytes as they were when the review opened; `?download=1` as an attachment |
| `GET events` | Server-Sent Events: `state` when the review is answered, replaced or expires |
| `POST answer` | `{ documents: [{ index, request?, comments?: [{ page, quote, note, rects? }] }] }` → 204; 409 `{ status }` when it isn't open any more; 400 for a body that isn't one |

**Layout.** The documents on the left (name, pages, whether it changed since the last review, approve or
changes), the selected one in the viewer, its panel on the right, and a bar along the bottom with the count to
approve and with changes, and Send ("Approve all and send" when nothing asks for changes). Below 900 px the
documents become a row of tabs and the panel goes under the viewer. Every grid item has `min-width: 0`, so a row
that scrolls sideways never widens the page.

**The panel:** the checks (pages, over the resume page limit, the text layer an applicant-tracking system reads,
encryption); since the last review (first time, unchanged since you approved it or asked for changes, or the list
of changes, each pressed to show it on the page); the comments (each with its number, the quoted words, the note,
edit and remove); and "Anything else to change?" for the whole document. A document with no comment and nothing
written is approved as shown, as before.

**Drafts** (`draft.ts`) are kept in the tab's `sessionStorage` under the review's id, so a reload doesn't lose
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
- **Commenting:** text selected on one page (by mouse, or by keyboard with caret browsing) offers a Comment
  button by the selection. A selection that starts or ends inside a word takes the whole word, so the agent gets
  "building", not "uilding". The comment keeps the quoted words (spaces collapsed, at most 600 characters) and
  where they are, as boxes in fractions of the page's size (`PageRect`), merged per line, so they hold at any
  zoom. While the note is written the selection stays highlighted; Ctrl+Enter adds it, Escape cancels. Comments
  show as highlights with their number in the page's left margin, where it covers no text. Without
  `onComment` (onboarding's previews) text can be selected but not commented on.
- **Changes since the last review:** inserted words highlighted on the text layer, a removal as a red marker
  where the words were (its words on hover), measured on the text layer's spans with DOM ranges after each
  render.

### What changed since the last review (`changes.ts`, `protocol/src/textdiff.ts`)
The companion keeps the text of each document when the user answers a review
([`reviewed.json`](../data-formats.md#postingsidreviewedjson)) and gives it to the next review as
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
token is made on the first `onboarding` call and kept for the chat.

| Route | Does |
|---|---|
| `GET` (with `?t=`) | The page; sets the cookie (`Path=/onboard`) |
| `GET state` | `OnboardState`: status (`open`, `finished`), `ready`, the agent file's state, the steps, the tasks, whether the agent is listening, and per step what it shows ([below](#what-each-step-does)) |
| `GET events` | Server-Sent Events: `state` on every change |
| `GET repos` | The repositories the GitHub app can read, each with `selected`, `suggested` and `skipReason` |
| `GET file?path=` | A built template's PDF, under `templates/` only |
| `POST action` | `{ action, … }` (below); the answer, or 400 `{ error, hint? }` with an `EzError`'s words |
| `POST library?name=` | A file's bytes into `library/` |

**Seeing changes made elsewhere.** A login finished in GitHub's tab, the extension connecting, a repository the
agent indexed: none of them goes through the page. While a page listens, the companion compares its state every
2 s (`workspace_check` is cheap) and sends `state` when it differs; the page also reads it again whenever its
window gets focus. The comparison stops when no page listens.

### What each step does
| Step | On the page | Action |
|---|---|---|
| LaTeX | The engine found; else the install command for this OS, and **Ask Claude to install it** | task `install-tex` |
| Browser extension | Chromium or Firefox, the steps and the folder or manifest to load (copyable: a page can't open `chrome://extensions`); **connect** opens the 15-minute pairing window and the step turns green when it connects; a warning when the extension isn't built | `pair` (`startPairing`, shared with `extension_pair`, `bridge/pairing.ts`) |
| GitHub | Without an app: create a new one or connect an existing one; **Continue on GitHub** opens the `/github/` flow in a new tab (opened in the click, so it isn't blocked, then pointed at the address the companion gives); a port mismatch's hint | `github` |
| Repositories | Every repository with language, last push, description, private, a search, and the ones left out (forks, archived, under 10 KB, the profile README repo, dotfiles or config) behind a toggle; nothing selected yet → the rest preselected; a link to give the app access to a missing one | `repos` (sources of repos added by URL kept) |
| Your projects, read | Each selected repository read or not; **Have Claude read N repositories** | task `index-repos` |
| Your resume | A folder or one `.tex` file, typed or chosen with **Browse…**; **Import and build**; the build's outcome (pages, over the limit, its first error) and a preview; a build that fails offers **Ask Claude to fix the build** | `browse`, `import` (`template_import`, then `tex_compile`), task `fix-template-build` |
| Your profile | None yet: **Have Claude draft it from my resume**. Then a form of every field the schema has, the often-asked ones marked when empty, the schema's errors under their fields; a draft that arrives replaces the form unless the user has started editing | task `draft-profile`, `profile` |
| Cover letter | Keep the template (and **Put my name and contact in it** for ezapply's default, **Match my resume's look**, **Show a preview**), use one's own LaTeX (as for the resume), or drop an example letter; a preview and "Anything to change in how it looks?" | tasks `fill-cover-identity`, `restyle-cover`, `cover-from-example`, `revise-cover`; `compile`, `import` |
| Screening questions | The unanswered ones, eight at a time, the suggestion filled in (a sensitive one's too: Claude still asks about it every time, suggesting what's saved; left empty, there's no suggestion), the profile path an answer usually comes from; **Save these** | `answers` |
| Preferences | Before a document is attached (approval first, or at once), then tone, emphasis, never mention, target roles and places, cover letters | `preferences` (`attach_mode`'s setting and `profile/preferences.md`) |
| Library | A drop zone (or the browser's picker: here only contents are needed), the files there, each with a trash button that deletes it for good after asking | `library` |

Plus **Finish setup** (**Finish later** while required steps remain), which ends the agent's wait, and an
**Ask Claude** box in Claude's panel (task `question`, the answer shown as the task's note). A finished page says
what's next (capture a posting with the toolbar button or Alt+Shift+P); asking the agent to set up again reopens
it. A missing or unimported `EZAPPLY.md` shows as a banner: `ezapply init` fixes it, not the page.

**Actions** (`POST action`, validated with zod): `task { kind, params }`, `pair { replace? }`, `github { app? }`,
`repos { repos }`, `browse { kind: folder | tex, title? }`, `import { kind, source, main?, replace? }`,
`compile { kind }`, `profile { value }`, `answers { answers }`, `preferences { attachMode, tone, emphasis,
neverMention, targets, coverLetters }`, `deleteLibrary { name }` (only a file the step lists, by its exact name, so no
name reaches outside `library/`), `finish`.

### The agent's side: tasks
What needs judgment or a shell goes to the agent as a task: `install-tex`, `index-repos`, `fix-template-build`,
`draft-profile`, `fill-cover-identity`, `restyle-cover`, `cover-from-example`, `revise-cover`, `question`, each
with `how`, what to do (`HOW` in the service), so the skill needs no copy of it. Where the agent is decides how it
gets one (`agentIn` in the page's state):
- **Under `ezapply` (`panel`):** the page's task is at once a message to the panel's general conversation
  ([agent](agent.md)): "Setup task t3 from the setup page (kind)", its `how`, its parameters, and how to report:
  `onboarding { taskId, result: { ok, note? }, wait: false }`, which marks it done or failed with the note and
  returns. The task is running from then; Claude busy in another conversation fails it with why, and the page
  offers it again. The page shows Claude as listening while the agent is available, and says to follow it in the
  ezapply panel, where its commands are approved.
- **Under `ezapply chat` (`terminal`):** the agent sits in a blocking [`onboarding`](../mcp-tools.md#onboarding)
  call; a task the page queues wakes it, and it gets `{ id, kind, params, how }`. Its report
  (`onboarding { taskId, result }`) marks the task done or failed and waits for the next in the same call. Tasks
  are taken in the order asked, one at a time; a task taken and never reported is given again, in case the agent
  lost track of it. The page shows whether the agent is listening; a queued task while it isn't says to tell
  Claude in the terminal to continue.

The page shows each task (queued, running, done with Claude's note, failed).

**Why the agent installs TeX, not the page:** Claude Code's permission prompt (in the terminal, or an approval card
in the panel) is where the user approves a command, and a loopback page able to start installers would widen what a
stolen token could do.

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
