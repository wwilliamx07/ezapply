# 0001: Foundations

- Status: accepted
- Date: 2026-09-24

## Context
ezapply is single-user today, but it should stay maintainable and able to grow (more users, more job sites,
an optional decision model). Claude Code is the only agent. The companion only provides tools.

## Decisions
1. **TypeScript monorepo with npm workspaces.** We use npm instead of pnpm because it ships with Node, so there's nothing extra to install. Changing later is cheap.
2. **Shared `protocol` package.** zod schemas are the single source of truth for the wire protocol and the tool inputs and outputs. Both sides validate what they receive. `PROTOCOL_VERSION` is checked at handshake, and a mismatch is refused with a hint saying which side to update.
3. **Companion is a long-running daemon.** It serves MCP over Streamable HTTP in *stateless* mode (a new McpServer per request), and the extension connects on a WebSocket on the same loopback port. Stateless MCP works because all state lives in services and on disk.
4. **Local security.**
   - Loopback bind, plus a Host-header check against DNS rebinding.
   - Bearer token on `/mcp`, and browser requests (those with an `Origin` header) are refused.
   - The extension authenticates with a pairing code, and its ID is pinned on first pairing.
5. **Extension UI is one button.** Set posting captures `body.innerHTML` verbatim, plus a visible-only copy (a lockstep TreeWalker with `checkVisibility`), `innerText`, and JSON-LD. `posting.md` is built from the visible copy, so hidden prompt-injection text never reaches the default context.
6. **TeX engine defaults to latexmk + XeLaTeX.** The user's resume uses system fonts. Tectonic stays available through config.
7. **Decision models are deferred.** The `decisions.provider` config value is `none` for v1. See plan §11.

## Consequences
- Adding an MCP tool: schema in `protocol` if the extension is involved, a service method, then a thin registration in `companion/src/mcp/tools/`.
- Adding a bridge method: add it to `CompanionApi`/`ExtensionApi`, then implement a handler on the serving side. Both sides get type errors until it's wired.
- Breaking wire changes bump `PROTOCOL_VERSION`. Breaking file-format changes bump that file's `schemaVersion` and add a migration.
