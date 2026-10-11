# Building an adapter

How to add a job site to ezapply: the whole process, from saving its pages to its first real application, and the
rules every adapter follows. What the parts are and how they work is in [adapters](components/adapters.md) (the
engine, the drivers), [protocol](components/protocol.md#the-site-registry-sitests) (the registry) and the site pages
([sites](components/sites.md)).
This page says how to build one and what goes where.

## Principles

**1. Generic everywhere, specific in one place.** The tool descriptions, the apply skill, `EZAPPLY.md`, the MCP
server's instructions and the companion's planning never name a site. Everything a site does differently lives with
that site:

| What | Where | Read by |
|---|---|---|
| Registry entry: signature, URL rules, tenant, job, canonical path, waits | `protocol/src/sites.ts`, `protocol/src/<site>.ts` | Extension and companion |
| Definition: fields, sections, buttons, pages, its own messages | `extension/src/adapters/sites/<site>/` | The engine, in the page |
| Notes: what the agent must know that no schema fact says | `companion/src/forms/sites/<site>.ts` | The agent, once per session |
| Posting reader, only if the generic capture reads its posting pages badly | `companion/src/postings/readers/` | Posting capture |

**Why.** Every Claude session reads the tool descriptions and the apply skill, whichever site it fills. A sentence
about one site there is paid for in every session on every other site, and with many sites those sentences pile up
into rules the agent has to sort through for sites it isn't on. A site's knowledge reaches the agent only once the
page in front of it is known to be that site: as schema facts on every read, and as its notes on the first read in
a session (`siteNotes`).

**2. Say it as a schema fact first.** If the agent's next move can follow from something the adapter can compute
on the page, the adapter computes it and the generic skill explains it once for every site. The facts there are:

| Fact | Tells the agent |
|---|---|
| `pageKind` (`posting`, `auth`, `start-choice`, `step`, `review`, `confirmation`, `unknown`), `actions` | What to do with the page as a whole |
| `step`, `nextLabel`, `backLabel`, `lastPage` | Where it is; `lastPage`: Submit is the only way on, hand off after this page |
| Field `kind`, `required`, `options`, `optionsLazy`, `multiple`, `dateParts`, `error`, `helpText` ("Read-only on this page.") | How to fill it, and what's wrong with it |
| Field `hint` | Which profile value it takes |
| `addButtons[].kind`: `row`, `form`, `save`, `edit` | Adds a row of fields; opens an inline form; saves a form; opens a saved item's form again |
| Section `removable`, `saved` | `remove_repeatable` works on it; a saved item without fields |
| `errors` vs `messages`, `refusedReason` | What the page refused, what it only noted, why `go_next` won't go on |
| `job` | Which posting the application is for |

The companion and the agent read these facts, never the adapter's id: the checklist counts rows and `saved`
sections against the profile's lists (never a `save` or `edit` button), the agent adds rows through `row` buttons and
items through `form` buttons and their `save`, and hands off on `review` or `lastPage`. A site that fits the facts needs no companion change.

**3. Notes only for what no fact can say.** Judgment and caveats: a document the site needs before anything else
(and what it does with it), a removal that reaches beyond this application (the candidate's profile on the site), a
choice or an agreement that is the user's, a field whose value takes a particular form there. Keep notes short and
imperative, a few lines per site. Never repeat a fact the schema already carries ("one page with only Submit" is
`lastPage`), never explain the generic flow again, and never restate the skill.

**4. Drivers per widget library, not per site.** A driver (`adapters/widgets/`) is one kind of widget: a native
control, react-select, Ant Design's Select, a react-datepicker, a file input. Most sites are built from a few
widely used libraries, so the drivers grow with the libraries sites use, not with the number of sites. In order:
- Use an existing shared driver. Its selector or container is the site's to give (`textDriver("number",
  "input.ant-input-number-input")`).
- If none drives the widget and it comes from a library other sites use, write a shared driver named after the
  library (`antd-select.ts`, not `dayforce-select.ts`). Give it options only where another site could need them
  (`selectDriver({ settled })`): a quirk of one site's data is better handled where every site benefits (Dayforce's
  dialling codes read "🇨🇦 +1 Canada": the shared option match takes "Canada" for it, rather than the driver
  rewording one site's labels).
- A driver of the site's own (`sites/<site>/widgets.ts`) only for a widget that is the site's own (Workday's
  prompt, Oracle's cx-select).

**5. Never submit.** `isSubmit` recognises the site's Submit, by a hook of its own or its words, never by
`type=submit` alone when the site's other buttons are `type=submit` too (Phenom's Next, Dayforce's Update). `next`
refuses on the review page, and `nextBlocked` refuses where pressing Next would raise a native dialog. The guard
blocks every synthetic press of Submit.

**6. Build from what was seen, and say what wasn't.** Every selector comes from a saved page or the site's own
scripts. What the definition handles but nobody has seen render (a step never reached, a dialog never opened) is
listed in its reference section and in [status](status.md#not-yet-verified-for-real), with what to check on the first
real run.

## The process

### 1. Gather the pages
- Save the posting and every step of the application; for a one-page site, the application. Public pages can be
  rendered headless; a site behind an account or a bot challenge needs pages the user saves from a real
  application. Never work around bot protection.
- Save several employers' applications where possible: one rarely shows every kind of question. A definition built
  from one Ashby page missed every radio and checkbox group, which another employer's page had
  ([sites](components/sites.md#ashby-sitesashby)).
- **When a step can't be reached** (it saves to the employer's system, or needs a finished earlier step), read the
  site's own scripts, saved with the page: the components' hooks (`test-id`, `data-automation-id`), form field
  names, the markup of each field type, and the text of every message (a Next.js app keeps them in
  `__NEXT_DATA__`). Dayforce's questionnaire, records and Submit step were built that way. Say so in the reference.
- Scrub every page before it's committed ([live snapshots](development.md#live-snapshots-are-scrubbed)): one
  fictional employer per site, used consistently, and nothing of the user's. Read the result's visible text and
  attribute values afterwards.

### 2. The registry entry (`protocol`)
- **URL rules** in `protocol/src/<site>.ts`, with no imports: `isXUrl` (a posting or application page by its URL
  alone), `xTenant` (the employer's space on the site), `xJob` (the job), and a canonical path when the site varies
  the path for one job (a locale, the application's own path). `tenant` and `job` tie a posting to its application
  and a tab to its posting ([which posting](mcp-tools.md#forms)), so read them from the application's URL as well
  as the posting's. `hostPageJob` if companies' careers pages name the site's jobs in their own URLs (Greenhouse's
  `?gh_jid=`)). `sameJob` if the application's job id differs from the one the posting shows (Phenom's
  `jobSeqNo` embeds the requisition): without it the tab is refused as another job's.
- **Signature:** the provider's own markup on every page of the site (its hooks, class names, script host), never a
  link to it or its embed script, which an employer's careers page has too.
- **Waits:** `STANDARD_WAITS` unless the site needs longer ones; say why beside each.
- Add the id to `FormSiteId` and `SiteId`, and bump `PROTOCOL_VERSION`: an older peer rejects a new site id.
- The extension's bundle for the site, telling its pages (by signature, then URL), the companion's tab choice and
  the per-site sections of `autofill-timing.yaml` all follow from the entry.

### 3. The definition (`extension/src/adapters/sites/<site>/`)
`site.ts` exports the `SiteDefinition`, `main.ts` installs it, and `sites/index.ts` lists it.
- **Fields** (`fields(doc)`): every field in page order, each with its container, its driver, a key, its prompt, its
  section and whether it's required, and its error, help and hint where there are any.
  - **Keys** are stable: the control's own name or form path where it reads as one (`firstName`), else the prompt's
    slug (an employer's question). The engine makes ids `<section slug>.<key>`.
  - **Sections** are the page's own headings. A row of a list is a section of its own titled by the list and its
    number ("Work Experience 2", "Employment History 2"), so the companion matches it to the profile's list by title.
    Number rows by something that doesn't move when a row is added, where the page has it (a record's index).
  - **Hints** go only on fields whose meaning is certain from the markup, never from a label guess; outside rows by
    the profile path (`identity.firstName`), inside rows by the row's slot (`work[].title`). A read-only field gets
    no hint and says so in its help.
- **Buttons** (`addButtons(doc)`) with their kind: `row`, `form` (an inline form opens), `save` (an inline form's,
  or a form that's part of the step), `edit`. Keys `add.<list>`, `save.<section>`, `edit.<section>`.
- **Rows and saved items** (`rows(doc)`): what can be removed, with its delete button. A saved item (a summary
  without fields) gets a section id `<block>.<kind>-<n>`, `kind` being `experience`, `education` or `item`, and a
  title starting with its list ("Employment History: Analyst, Example Corp"), so the checklist can count it against
  the profile's list.
- **Pages** (`page`): the page kind, the step and its key (whatever changes on a move: a step bar, a URL), the job,
  errors and notices kept apart, next and back, `nextBlocked`, `isSubmit`, and the actions a posting or start page
  offers.
- **Fill order:** `page` when lists depend on ones above them (a country's provinces).
- **Messages:** what the engine says when it refuses or finds nothing, in the site's words. These can name the
  site's own steps and buttons: they're only ever shown on its pages.

### 4. Its notes (`companion/src/forms/sites/<site>.ts`)
Export one string, `<Site name>:` then a few bullets, and add it to `SITE_NOTES` (`sites/index.ts`), which is keyed
by every registry site: a site without notes doesn't compile. Check each line against principle 3: if a schema
fact already says it, drop it; if every site does it, it belongs in the skill instead.

### 5. A posting reader, only if needed (`companion/src/postings/readers/`)
Posting capture reads JSON-LD, then the page title, then the main content, for every site. Only when a capture of
the site's posting page comes out wrong (no JSON-LD, a title that is only the role) does it get a reader in
`POSTING_READERS`; never a branch in `extract.ts`.

### 6. Tests
- **Conformance** (`extension/test/sites.test.ts`): its page in `PAGES`, its saved pages in `SAVED`. Every field
  has a prompt and a kind, ids are the same on two reads, the guard blocks Submit and `next` never presses it, and
  its signature matches its own pages and no other site's.
- **Extraction** (`extension/test/sites-live.test.ts`) on its saved pages: page kind, step, job, tenant, each kind
  of field with its key, prompt, hints and requirement, buttons and their kinds, rows and saved items, `isSubmit`.
  What came from the site's scripts rather than a saved page is tested on markup built from them.
- **A new shared driver** (`extension/test/widgets.test.ts`) on a minimal model of the widget, including what was
  seen live to go wrong.
- **URL rules** (`protocol/test/sites.test.ts`): its postings and applications, and pages that look close but aren't.
- **Notes** need no test of their own: the type checks every site has them, and `e2e.test.ts` checks they come
  once per session.

### 7. Check it live
- On public forms: a script drives the built bundle with obviously fake values and never submits
  ([how](components/adapters.md#checking-a-site-live)).
- Then one real application with [debug mode](development.md#debugging-a-live-run-debug-mode) on. Its
  records (`ezapply debug export`) give the steps that couldn't be saved before: save them as fixtures and test
  them. One adapter change per live run, so a failure points at one change.

### 8. The reference
A section in [sites](components/sites.md) (or a page of its own for a large site): its pages, registry entry,
fields, buttons and rows, what it refuses, and what was verified and how. Its line in [status](status.md), with what
the first real run must check. Its name in the lists of sites in the references (not in the skills or tool
descriptions).

## Checklist
- [ ] Pages saved and scrubbed; what couldn't be saved read from the site's scripts, and said so
- [ ] URL rules, registry entry, `FormSiteId`, `SiteId`, `PROTOCOL_VERSION`
- [ ] Definition, `main.ts`, listed in `sites/index.ts`; existing drivers first, a new one only for a new library
- [ ] Facts set: page kinds, `lastPage`, button kinds, `removable` and `saved`, hints, errors apart from notices
- [ ] `isSubmit` by hook or words; `next` refused where it must be
- [ ] Notes in `SITE_NOTES`, saying only what no fact says
- [ ] No site named in a tool description, the skill, `EZAPPLY.md` or the MCP instructions
- [ ] Tests: conformance, signatures, extraction, drivers, URL rules
- [ ] Reference section, status entry, the site in the references' lists
