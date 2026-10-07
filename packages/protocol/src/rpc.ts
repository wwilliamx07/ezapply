import type { z } from "zod";
import type { RequestMessage, ResponseMessage } from "./bridge.js";
import { ErrorCode, EzError } from "./errors.js";

export interface MethodSpec {
  params: z.ZodType;
  result: z.ZodType;
}
export type MethodMap = Record<string, MethodSpec>;

export type ParamsOf<M extends MethodMap, K extends keyof M> = z.input<M[K]["params"]>;
export type ResultOf<M extends MethodMap, K extends keyof M> = z.output<M[K]["result"]>;

export type Handlers<M extends MethodMap> = {
  [K in keyof M]: (
    params: z.output<M[K]["params"]>,
  ) => Promise<z.input<M[K]["result"]> | WithDebug<z.input<M[K]["result"]>>>;
};

/**
 * A handler's result with a debug trace beside it (debug mode: the adapter's trace and the page's markup).
 * The trace travels in the response's `debug`, outside the result, so `request` never returns it and it can't end
 * up in a tool result: only a caller that passed `onDebug` gets it. A handler that fails carries one the same way,
 * as its thrown error's `debug`.
 */
export class WithDebug<T> {
  constructor(
    readonly result: T,
    readonly debug: unknown,
  ) {}
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: EzError) => void;
  timer: ReturnType<typeof setTimeout>;
  spec: MethodSpec;
  onDebug?: (debug: unknown) => void;
}

export interface RpcPeerOptions<Out extends MethodMap, In extends MethodMap> {
  send: (msg: RequestMessage | ResponseMessage) => void;
  /** Methods the other side serves (what this peer can call). */
  remote: Out;
  /** Methods this side serves. */
  local: In;
  handlers: Handlers<In>;
  timeoutMs?: number;
  idPrefix?: string;
}

/**
 * Symmetric request/response over any message channel. Both params and results are
 * validated against the shared schemas on the receiving side.
 */
export class RpcPeer<Out extends MethodMap, In extends MethodMap> {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly opts: RpcPeerOptions<Out, In>) {}

  request<K extends keyof Out & string>(
    method: K,
    params: ParamsOf<Out, K>,
    timeoutMs = this.opts.timeoutMs ?? 30_000,
    onDebug?: (debug: unknown) => void,
  ): Promise<ResultOf<Out, K>> {
    const spec = this.opts.remote[method];
    if (!spec) return Promise.reject(new EzError(ErrorCode.BadRequest, `Unknown method ${method}`));
    const id = `${this.opts.idPrefix ?? ""}${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EzError(ErrorCode.Timeout, `${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, spec, onDebug });
      try {
        this.opts.send({ kind: "request", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(EzError.from(err));
      }
    });
  }

  async handle(msg: RequestMessage | ResponseMessage): Promise<void> {
    if (msg.kind === "response") {
      this.settle(msg);
      return;
    }
    const reply = (res: ResponseMessage) => {
      try {
        this.opts.send(res);
      } catch {
        // Channel closed while handling; the caller will time out.
      }
    };
    const spec = this.opts.local[msg.method];
    const handler = (this.opts.handlers as Record<string, (p: unknown) => Promise<unknown>>)[msg.method];
    if (!spec || !handler) {
      const error = new EzError(ErrorCode.BadRequest, `Unknown method ${msg.method}`).toPayload();
      reply({ kind: "response", id: msg.id, ok: false, error });
      return;
    }
    const parsed = spec.params.safeParse(msg.params);
    if (!parsed.success) {
      const error = new EzError(
        ErrorCode.BadRequest,
        `Invalid params for ${msg.method}: ${parsed.error.message}`,
      ).toPayload();
      reply({ kind: "response", id: msg.id, ok: false, error });
      return;
    }
    try {
      const out = await handler(parsed.data);
      if (out instanceof WithDebug) {
        reply({ kind: "response", id: msg.id, ok: true, result: out.result, ...debugOf(out) });
      } else {
        reply({ kind: "response", id: msg.id, ok: true, result: out });
      }
    } catch (err) {
      reply({ kind: "response", id: msg.id, ok: false, error: EzError.from(err).toPayload(), ...debugOf(err) });
    }
  }

  /** Reject every in-flight request, e.g. when the connection drops. */
  failAll(err: EzError): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private settle(msg: ResponseMessage): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.debug !== undefined) p.onDebug?.(msg.debug);
    if (!msg.ok) {
      p.reject(EzError.fromPayload(msg.error));
      return;
    }
    const parsed = p.spec.result.safeParse(msg.result);
    if (parsed.success) p.resolve(parsed.data);
    else p.reject(new EzError(ErrorCode.Internal, `Invalid result: ${parsed.error.message}`));
  }
}

/** The `debug` a response carries: a `WithDebug`'s, or one set on a thrown error. */
function debugOf(x: unknown): { debug?: unknown } {
  const debug = x && typeof x === "object" ? (x as { debug?: unknown }).debug : undefined;
  return debug === undefined ? {} : { debug };
}
