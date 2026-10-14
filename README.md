# ezapply

Apply for jobs more efficiently and effectively without lowering the quality or honesty of what you send.
ezapply tailors your documents and form answers to the posting, based on your profile and projects.

- **Tailored documents.** A tailored resume and cover letter for each posting, built only from your
  profile and claims backed by your repos. Nothing made up.
- **Review before anything goes out.** Each document requires your approval before being attached. ezapply drafts documents,
  asks for your feedback, and attaches when you're satisfied.
- **Autofill.** ezapply fills the application form and attaches your approved documents automatically on Workday, Oracle
  Recruiting Cloud, Greenhouse, Lever, Ashby, Phenom, Dayforce and SAP SuccessFactors. Capture works on any site.
- **You submit** The agent never submits, it leaves the final review and submission to you.
- **Local.** Everything runs on your machine and only while you have it open. Your data stays there, except
  what you put into an application and what Claude Code sends to Claude.

https://github.com/user-attachments/assets/463a4da3-7829-4a26-b54b-6d94c6b25df6

## Setup

You need Node 22.12+, Chrome 120+ (or another Chromium browser), and [Claude Code](https://claude.com/claude-code).

```sh
npm run setup        # install, build, create the workspace ~/ezapply-home
cd ~/ezapply-home
./ezapply            # Windows: .\ezapply
```

The first run opens a setup page in your browser. It takes you through installing TeX, loading the browser
extension, connecting GitHub and choosing repos, and adding your resume, profile, cover letter template and
screening answers. You can do the steps in any order and come back to them later. Claude does the parts that
need judgment, such as drafting your profile from your resume.

## Using it

Run `./ezapply` in `~/ezapply-home` and leave it open: it is the bridge between the extension and Claude.
Open a job posting, open the ezapply side panel from the toolbar, and press **Capture** (or Alt+Shift+P).
Then click tailor documents, fill application, or ask Claude for anything.

## How it works

```
browser extension ──WebSocket──▶ companion ◀──MCP── Claude Code ──▶ ~/ezapply-home
 (side panel, capture,           (tools, files,     (started by the companion,
  form filling)                   GitHub, TeX)       runs in the workspace)
```

ezapply has no agent of its own. It gives Claude Code tools over MCP, plus a workspace of files and skills
that tell Claude how to use them. Running `ezapply` starts the **companion**, a local server that
serves those tools, the review and setup pages, and a WebSocket bridge to the extension. It also starts Claude
Code headless when the side panel needs it. The **extension** captures postings and reads and fills
application forms through a site adapter per job site. Postings, forms and repositories are all treated as
untrusted data, never as instructions. Repos are mirrored read-only, and secrets go in the OS keychain.

| Package | What it is |
|---|---|
| `packages/protocol` | Shared zod schemas: the extension↔companion protocol, forms, postings, errors |
| `packages/companion` | The MCP server, the extension bridge, the side panel's agent, and the services behind them: postings, documents (TeX/PDF), profile, GitHub, repos, forms |
| `packages/cli` | The `ezapply` command (`init`, `doctor`, `debug`, `mcp`), the workspace templates and Claude Code skills |
| `packages/extension` | The MV3 extension for Chrome and other Chromium browsers (`dist/`): side panel, capture, site adapters |
| `packages/ui` | The side panel's components and the review and setup pages (React, pdf.js) |

Where your data lives:

- `~/ezapply-home/`: your workspace, with your profile, templates, postings, documents and repo cache
- `~/.ezapply/`: config, pairing, and logs (personal data redacted)
- the OS keychain, under "ezapply": GitHub secrets and tokens

## Development

| Command | Does |
|---|---|
| `npm run build` | Build every package |
| `npm test` | Build, then run the vitest suite |
| `npm run typecheck` | Typecheck every package and the tests |
| `npm run lint` / `npm run format` | Biome |

The full references are in [references/](references/README.md).
