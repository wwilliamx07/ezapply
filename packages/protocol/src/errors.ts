import { z } from "zod";

/**
 * Error codes shared by the companion, the extension and MCP tool results.
 * Every error carries a hint telling the caller (usually Claude) how to recover.
 */
export const ErrorCode = {
  BadRequest: "bad_request",
  Unauthorized: "unauthorized",
  ProtocolMismatch: "protocol_mismatch",
  ExtensionDisconnected: "extension_disconnected",
  Timeout: "timeout",
  NotFound: "not_found",
  NoPosting: "no_posting",
  PathNotAllowed: "path_not_allowed",
  /** The application tab belongs to another posting than the call's: nothing that changes the page runs. */
  PostingMismatch: "posting_mismatch",
  Internal: "internal",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorPayload = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;

export class EzError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "EzError";
    this.code = code;
    this.hint = hint;
  }

  toPayload(): ErrorPayload {
    return this.hint === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, hint: this.hint };
  }

  static fromPayload(p: ErrorPayload): EzError {
    return new EzError(p.code as ErrorCode, p.message, p.hint);
  }

  static from(err: unknown): EzError {
    if (err instanceof EzError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new EzError(ErrorCode.Internal, message);
  }
}
