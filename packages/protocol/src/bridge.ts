import { z } from "zod";
import { BrowserInfo, BrowserStatus } from "./browser.js";
import { ErrorPayload } from "./errors.js";
import { FormMethods } from "./forms.js";
import { CapturePayload, CaptureResult } from "./postings.js";

/**
 * Wire protocol between the browser extension and the companion (WebSocket, JSON text frames).
 *
 * Bump PROTOCOL_VERSION on any breaking change to the envelope or to a method's schema.
 * Both sides refuse to talk across versions and tell the user which side to update.
 */
export const PROTOCOL_VERSION = 6;

/** WebSocket close codes used by the companion. */
export const CloseCode = {
  Unauthorized: 4001,
  ProtocolMismatch: 4002,
  Replaced: 4003,
  HandshakeTimeout: 4004,
} as const;

export const HelloMessage = z.object({
  kind: z.literal("hello"),
  protocolVersion: z.number().int(),
  extensionVersion: z.string(),
  /** Empty when the extension isn't paired yet and asks to pair (only accepted while pairing is open). */
  pairingToken: z.string(),
  /** A capture made while the companion was down follows right after `welcome`. */
  pendingCapture: z.boolean().optional(),
  /** The browser the extension runs in; the companion opens pages and files there. */
  browser: BrowserInfo.optional(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

export const WelcomeMessage = z.object({
  kind: z.literal("welcome"),
  protocolVersion: z.number().int(),
  companionVersion: z.string(),
  /** Sent when the extension paired without a code, for it to store and present from then on. */
  pairingToken: z.string().optional(),
});
export type WelcomeMessage = z.infer<typeof WelcomeMessage>;

export const RejectMessage = z.object({
  kind: z.literal("reject"),
  error: ErrorPayload,
});
export type RejectMessage = z.infer<typeof RejectMessage>;

export const PingMessage = z.object({ kind: z.literal("ping"), t: z.number() });
export const PongMessage = z.object({ kind: z.literal("pong"), t: z.number() });

export const RequestMessage = z.object({
  kind: z.literal("request"),
  id: z.string(),
  method: z.string(),
  params: z.unknown(),
});
export type RequestMessage = z.infer<typeof RequestMessage>;

/**
 * `debug`: a debug trace beside the result or error (autofill debug mode, rpc.ts's `WithDebug`), sent only for a
 * request that asked for one. Optional, so either side may be older.
 */
export const ResponseMessage = z.union([
  z.object({
    kind: z.literal("response"),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
    debug: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("response"),
    id: z.string(),
    ok: z.literal(false),
    error: ErrorPayload,
    debug: z.unknown().optional(),
  }),
]);
export type ResponseMessage = z.infer<typeof ResponseMessage>;

export const BridgeMessage = z.union([
  HelloMessage,
  WelcomeMessage,
  RejectMessage,
  PingMessage,
  PongMessage,
  RequestMessage,
  ResponseMessage,
]);
export type BridgeMessage = z.infer<typeof BridgeMessage>;

export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = BridgeMessage.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Methods served by the companion, called by the extension. */
export const CompanionApi = {
  "posting.capture": { params: CapturePayload, result: CaptureResult },
};

/** Methods served by the extension, called by the companion. */
export const ExtensionApi = {
  "browser.status": { params: z.object({}), result: BrowserStatus },
  ...FormMethods,
};
