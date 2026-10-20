import { EzError } from "@ezapply/protocol";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "../logger.js";

/** Compact JSON: results sit in Claude's context, and indentation costs a fifth to a third more tokens. */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * A panel conversation's call that waits on the user (`ask_user`, `review_documents`) returns this at once: the
 * answer comes as the next message. Nothing in it reads as a next step, so the agent ends its turn.
 */
export const PENDING_HINT =
  "Waiting on the user. End your turn now: their answer arrives as your next message, in an <ezapply-result> block. Don't call again to check.";

function failure(log: Logger, name: string, err: unknown): CallToolResult {
  const e = EzError.from(err);
  if (e.code === "internal") log.error({ tool: name, err: e.message, stack: (err as Error).stack }, "tool failed");
  else log.info({ tool: name, code: e.code }, "tool returned error");
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: e.toPayload() }) }] };
}

/**
 * Wrap a tool body so every failure reaches Claude as a structured error with a recovery
 * hint instead of an opaque exception. The body's return value is sent as JSON text.
 */
export function tool<A>(log: Logger, name: string, fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return failure(log, name, err);
    }
  };
}

/** Like `tool`, for bodies that build their own result (e.g. image content). */
export function rawTool<A>(log: Logger, name: string, fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return failure(log, name, err);
    }
  };
}
