import type { AgentEvent } from "@ezapply/protocol";

/**
 * Claude Code's stream-json output (`claude -p --output-format stream-json --verbose`), read into what the panel
 * shows. Only the fields below are read, so a line of a kind this doesn't know is skipped rather than failing the
 * conversation; `stream.test.ts` pins them on lines recorded from the CLI (values replaced).
 *
 * - `system/init` (at the start of every turn): `session_id`, `mcp_servers[] { name, status }`.
 * - `assistant`: `message.content[]` blocks, `text` and `tool_use { id, name, input }`, one block per line;
 *   `parent_tool_use_id` names the subagent call a block came from.
 * - `user`: a replayed user message (`isReplay`, with `--replay-user-messages`): the message reached Claude; or
 *   `tool_result { tool_use_id, is_error, content }` blocks.
 * - `result`: the turn's end, `is_error`, `total_cost_usd` (the session's so far), `duration_ms`,
 *   `terminal_reason` (`aborted_tools` after an interrupt), `queued_turn_count`, `result` (its text or error).
 * - `system/api_retry`: `attempt`, `max_retries`, `error`.
 */
export type StreamItem =
  | { type: "event"; event: AgentEvent }
  | { type: "init"; sessionId: string; mcpServers: { name: string; status: string }[] }
  | { type: "taken"; text: string }
  | { type: "turnEnd"; event: Extract<AgentEvent, { kind: "turnEnd" }>; queued: number }
  | { type: "controlResponse"; requestId: string; ok: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** One line of output into what it means, or none for a line to skip. `now` stamps the events. */
export function readStreamLine(line: string, now: () => string = () => new Date().toISOString()): StreamItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  const e = obj(raw);
  if (!e) return [];
  const at = now();
  const parent = str(e.parent_tool_use_id);
  switch (e.type) {
    case "system": {
      if (e.subtype === "init") {
        const servers = Array.isArray(e.mcp_servers) ? e.mcp_servers : [];
        return [
          {
            type: "init",
            sessionId: str(e.session_id) ?? "",
            mcpServers: servers.flatMap((s) => {
              const o = obj(s);
              const name = str(o?.name);
              return name ? [{ name, status: str(o?.status) ?? "unknown" }] : [];
            }),
          },
        ];
      }
      if (e.subtype === "api_retry") {
        const attempt = num(e.attempt);
        const max = num(e.max_retries);
        const why = str(e.error) ?? "unknown";
        const of = attempt !== undefined && max !== undefined ? ` (${attempt} of ${max})` : "";
        return [
          {
            type: "event",
            event: { kind: "notice", at, level: "warn", text: `The API failed (${why}); retrying${of}.` },
          },
        ];
      }
      return [];
    }
    case "assistant": {
      const content = obj(e.message)?.content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((b): StreamItem[] => {
        const block = obj(b);
        if (block?.type === "text") {
          const text = str(block.text)?.trim();
          return text ? [{ type: "event", event: { kind: "text", at, text, ...(parent ? { parent } : {}) } }] : [];
        }
        if (block?.type === "tool_use") {
          const id = str(block.id) ?? "";
          const name = str(block.name) ?? "tool";
          return [
            {
              type: "event",
              event: {
                kind: "tool",
                at,
                id,
                name,
                summary: toolSummary(name, block.input),
                ...(parent ? { parent } : {}),
              },
            },
          ];
        }
        return [];
      });
    }
    case "user": {
      const message = obj(e.message);
      if (e.isReplay === true) return [{ type: "taken", text: textOf(message?.content) }];
      const content = message?.content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((b): StreamItem[] => {
        const block = obj(b);
        if (block?.type !== "tool_result") return [];
        const failed = block.is_error === true;
        const error = failed ? clip(textOf(block.content), 300) : undefined;
        return [
          {
            type: "event",
            event: { kind: "toolDone", at, id: str(block.tool_use_id) ?? "", ok: !failed, ...(error ? { error } : {}) },
          },
        ];
      });
    }
    case "result": {
      const failed = e.is_error === true;
      const interrupted = str(e.terminal_reason)?.startsWith("aborted") ?? false;
      const cost = num(e.total_cost_usd);
      const duration = num(e.duration_ms);
      const error = failed && !interrupted ? clip(str(e.result) ?? str(e.subtype) ?? "", 500) : undefined;
      return [
        {
          type: "turnEnd",
          queued: num(e.queued_turn_count) ?? 0,
          event: {
            kind: "turnEnd",
            at,
            ok: !failed,
            ...(interrupted ? { interrupted: true } : {}),
            ...(cost !== undefined ? { totalCostUsd: cost } : {}),
            ...(duration !== undefined ? { durationMs: duration } : {}),
            ...(error ? { error } : {}),
          },
        },
      ];
    }
    case "control_response": {
      const response = obj(e.response);
      return [
        { type: "controlResponse", requestId: str(response?.request_id) ?? "", ok: response?.subtype === "success" },
      ];
    }
    default:
      return [];
  }
}

/** A tool call in one line: what it runs or touches, not its whole input. */
export function toolSummary(name: string, input: unknown): string {
  const i = obj(input) ?? {};
  const s = (k: string) => str(i[k]);
  switch (name) {
    case "Bash":
    case "PowerShell":
      return clip(s("command") ?? "", 200);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return s("file_path") ?? s("notebook_path") ?? "";
    case "Glob":
    case "Grep":
      return clip(s("pattern") ?? "", 120);
    case "Skill":
      return s("skill") ?? s("command") ?? "";
    case "Task":
    case "Agent":
      return clip(s("description") ?? s("prompt") ?? "", 120);
    case "WebFetch":
      return s("url") ?? "";
    case "WebSearch":
      return clip(s("query") ?? "", 120);
    case "ToolSearch":
      return clip(s("query") ?? "", 120);
    case "mcp__ezapply__fill_fields": {
      const fills = Array.isArray(i.fills) ? i.fills.length : 0;
      return `${fills} ${fills === 1 ? "field" : "fields"}`;
    }
    case "mcp__ezapply__upload_file":
      return s("path")?.split(/[\\/]/).pop() ?? "";
    case "mcp__ezapply__page_action":
      return s("action") ?? "";
    case "mcp__ezapply__ask_user":
      return s("title") ?? "";
    default: {
      // Other MCP tools: their arguments, compact, cut short.
      const json = JSON.stringify(i);
      return json === "{}" ? "" : clip(json, 160);
    }
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      const o = obj(b);
      return o?.type === "text" ? (str(o.text) ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
