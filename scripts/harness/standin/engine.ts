import { randomBytes } from "node:crypto";
import type { CloneDescription, EndpointSpec, RequestPart } from "@ezapply/sites/clones";
import type { Clone, Exchange } from "../lib/store.ts";

/** A request the page sent, as the stand-in sees it. */
export interface StandInRequest {
  method: string;
  url: string;
  /** Lowercase names. */
  headers: Record<string, string>;
  body?: Buffer;
}

interface StandInResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** How long to hold the answer: a recorded time for the endpoint, scaled by the latency. */
  delayMs: number;
  /** The endpoint that answered (`static:<host>` for the saved front end). */
  endpoint: string;
}

interface StandInOptions {
  /** 0 answers at once, 1 as recorded, higher for a slower network. */
  latency?: number;
  /** For drawing a recorded time; Math.random by default. */
  random?: () => number;
  /**
   * Replaying recorded requests (the equivalence check): their tokens are the recorded ones, so tokens aren't checked
   * and responses keep the placeholders the clone stores.
   */
  replay?: boolean;
}

/** What the stand-in refused, which fails a run. */
interface Problem {
  kind: "unknown" | "submit" | "token";
  method: string;
  url: string;
  detail: string;
}

/** The placeholder a clone stores in place of a token's recorded value. */
export const tokenPlaceholder = (name: string) => `__ezapply_token_${name}__`;

/**
 * Stands in for a site's server from a clone: the saved front end, and the site's requests answered by the kind the
 * description gives each (see `EndpointKind`), with the site's timing. A request it can't answer is a `Problem`:
 * the clone is incomplete, and the run that saw it fails.
 */
export class StandIn {
  readonly problems: Problem[] = [];
  /** What `save` requests stored, by endpoint. */
  readonly saved = new Map<string, unknown[]>();
  private readonly byEndpoint = new Map<string, Exchange[]>();
  private readonly statics = new Map<string, Exchange[]>();
  /** For each request signature, how many of its recorded answers were given: answers come back in recorded order. */
  private readonly cursors = new Map<string, number>();
  private readonly tokens = new Map<string, string>();
  private readonly latency: number;
  private readonly random: () => number;
  private readonly replay: boolean;

  private readonly clone: Pick<Clone, "exchanges" | "body">;
  private readonly desc: CloneDescription;

  constructor(clone: Pick<Clone, "exchanges" | "body">, desc: CloneDescription, opts: StandInOptions = {}) {
    this.clone = clone;
    this.desc = desc;
    this.latency = opts.latency ?? 1;
    this.random = opts.random ?? Math.random;
    this.replay = opts.replay ?? false;
    for (const e of clone.exchanges) {
      if (e.pass !== "explore") continue;
      const spec = this.endpointOf(e.method, e.url);
      if (spec) push(this.byEndpoint, spec.name, e);
      else push(this.statics, this.signature(null, toRequest(e)), e);
    }
    for (const t of desc.tokens ?? []) {
      this.tokens.set(t.name, this.replay ? tokenPlaceholder(t.name) : `t${randomBytes(12).toString("hex")}`);
    }
  }

  /** The endpoint a request belongs to, if any. */
  endpointOf(method: string, url: string): EndpointSpec | undefined {
    return this.desc.endpoints.find((s) => (!s.method || s.method === method) && s.url.test(url));
  }

  /** The answer to a request, or null (and a problem recorded) when there's none. */
  handle(req: StandInRequest): StandInResponse | null {
    const spec = this.endpointOf(req.method, req.url);
    if (!spec) {
      const sig = this.signature(null, req);
      const recorded = this.statics.get(sig);
      if (!recorded) return this.fail("unknown", req, "not in the saved front end and no endpoint matches it");
      return this.respond(this.next(sig, recorded), `static:${new URL(req.url).host}`);
    }
    if (spec.kind === "submit") return this.fail("submit", req, `submit endpoint "${spec.name}"`);
    if (spec.kind === "beacon")
      return { status: 204, headers: {}, body: Buffer.alloc(0), delayMs: 0, endpoint: spec.name };
    const tokenError = this.checkTokens(req);
    if (tokenError) {
      this.problems.push({ kind: "token", method: req.method, url: req.url, detail: tokenError });
      return { status: 403, headers: {}, body: Buffer.from(tokenError), delayMs: 0, endpoint: spec.name };
    }

    const all = this.byEndpoint.get(spec.name) ?? [];
    const keyed = spec.key ? all.filter((e) => sameParts(spec.key ?? [], toRequest(e), req)) : all;
    const sig = this.signature(spec, req);
    const exact = keyed.filter((e) => this.signature(spec, toRequest(e)) === sig);
    if (spec.kind === "save") push(this.saved, spec.name, parseBody(req));
    if (exact.length) return this.respond(this.next(`${spec.name} ${sig}`, exact), spec.name);

    switch (spec.kind) {
      case "static":
      case "list":
      case "nested-list":
      case "validate":
        // Only the key's parts decide these: without a key, a request not seen exactly wasn't explored.
        if (spec.key && keyed.length) return this.respond(this.next(`${spec.name} ${sig}`, keyed), spec.name);
        return this.fail("unknown", req, `no recorded answer for this ${spec.kind} request ("${spec.name}")`);
      case "search":
        return this.search(spec, keyed, req);
      case "step":
        return this.step(spec, keyed, req);
      case "save": {
        const ok = keyed.filter((e) => e.status < 300).at(-1);
        if (ok) return this.respond(ok, spec.name);
        return this.fail("unknown", req, `no recorded answer to a save ("${spec.name}")`);
      }
      case "upload": {
        const ok = keyed.find((e) => e.status < 300);
        if (ok) return this.respond(ok, spec.name);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from("{}"),
          delayMs: 0,
          endpoint: spec.name,
        };
      }
    }
  }

  /** The saved dataset, filtered by the typed text with the site's rule, in a recorded answer's shape. */
  private search(spec: EndpointSpec, keyed: Exchange[], req: StandInRequest): StandInResponse | null {
    const items = spec.items ?? "";
    const parsed = keyed
      .filter((e) => e.status < 300)
      .map((e) => ({ e, json: json(this.clone.body(e.body)) }))
      .filter((x): x is { e: Exchange; json: unknown } => Array.isArray(at(x.json, items)));
    if (!parsed.length) return this.fail("unknown", req, `no recorded results for search "${spec.name}"`);
    const seen = new Set<string>();
    const dataset: unknown[] = [];
    for (const { json: j } of parsed) {
      for (const item of at(j, items) as unknown[]) {
        const id = JSON.stringify(item);
        if (!seen.has(id)) {
          seen.add(id);
          dataset.push(item);
        }
      }
    }
    const pageSize = Math.max(...parsed.map((x) => (at(x.json, items) as unknown[]).length));
    const text = String(part(req, spec.query ?? "") ?? "");
    const hits = dataset.filter((item) => matches(String(at(item, spec.label ?? "") ?? ""), text, spec));
    const template = parsed.reduce((a, b) =>
      (at(b.json, items) as unknown[]).length > (at(a.json, items) as unknown[]).length ? b : a,
    );
    const body = Buffer.from(JSON.stringify(setAt(structuredClone(template.json), items, hits.slice(0, pageSize))));
    return { ...this.respond(template.e, spec.name), body };
  }

  /** The recorded way on when every required part is there, else the recorded refusal. */
  private step(spec: EndpointSpec, keyed: Exchange[], req: StandInRequest): StandInResponse | null {
    const complete = (r: StandInRequest) => (spec.required ?? []).every((p) => present(part(r, p)));
    const goesOn = complete(req);
    const pick = keyed.filter((e) => (e.status < 300 && complete(toRequest(e))) === goesOn).at(-1);
    if (pick) return this.respond(pick, spec.name);
    return this.fail("unknown", req, `no recorded ${goesOn ? "way on" : "refusal"} for step "${spec.name}"`);
  }

  private respond(e: Exchange, endpoint: string): StandInResponse {
    let body = this.clone.body(e.body);
    if (this.tokens.size && isText(e.resHeaders["content-type"])) {
      let text = body.toString("utf8");
      for (const [name, value] of this.tokens) text = text.replaceAll(tokenPlaceholder(name), value);
      body = Buffer.from(text, "utf8");
    }
    return { status: e.status, headers: { ...e.resHeaders }, body, delayMs: this.delay(endpoint), endpoint };
  }

  private delay(endpoint: string): number {
    if (!this.latency) return 0;
    const samples = this.timings().get(endpoint);
    if (!samples?.length) return 0;
    return (samples[Math.floor(this.random() * samples.length)] ?? 0) * this.latency;
  }

  private timingsCache?: Map<string, number[]>;
  /** Each endpoint's recorded times (wait and receive together), static files by host. */
  timings(): Map<string, number[]> {
    if (this.timingsCache) return this.timingsCache;
    const out = new Map<string, number[]>();
    for (const e of this.clone.exchanges) {
      if (e.pass !== "explore" || !e.timing) continue;
      const name = this.endpointOf(e.method, e.url)?.name ?? `static:${new URL(e.url).host}`;
      push(out, name, e.timing.wait + e.timing.receive);
    }
    this.timingsCache = out;
    return out;
  }

  private next(sig: string, recorded: Exchange[]): Exchange {
    const n = this.cursors.get(sig) ?? 0;
    this.cursors.set(sig, n + 1);
    return recorded[Math.min(n, recorded.length - 1)] as Exchange;
  }

  /** The whole request, cache busters aside: what an exact answer is looked up by. */
  private signature(spec: EndpointSpec | null, req: StandInRequest): string {
    const u = new URL(req.url);
    for (const p of this.desc.cacheBusters ?? []) u.searchParams.delete(p);
    u.hash = "";
    let body = req.body?.toString("base64") ?? "";
    if (spec && this.desc.tokens?.length) {
      // A token in the body differs on every session: it never picks an answer.
      const parsed = parseBody(req);
      for (const t of this.desc.tokens) if (t.sent.startsWith("body.")) setAt(parsed, t.sent.slice(5), undefined);
      body = JSON.stringify(parsed);
    }
    return `${req.method} ${u.href} ${body}`;
  }

  private checkTokens(req: StandInRequest): string | undefined {
    if (this.replay) return undefined;
    for (const t of this.desc.tokens ?? []) {
      const sent = part(req, t.sent);
      if (sent !== undefined && sent !== this.tokens.get(t.name))
        return `token "${t.name}" is not one the stand-in issued`;
    }
    return undefined;
  }

  private fail(kind: Problem["kind"], req: StandInRequest, detail: string): null {
    this.problems.push({ kind, method: req.method, url: req.url, detail });
    return null;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** A recorded exchange's request, as the page would send it. */
export function toRequest(e: Exchange): StandInRequest {
  return {
    method: e.method,
    url: e.url,
    headers: Object.fromEntries(Object.entries(e.reqHeaders).map(([k, v]) => [k.toLowerCase(), v])),
    ...(e.reqBody ? { body: Buffer.from(e.reqBody, "base64") } : {}),
  };
}

const isText = (type: string | undefined) => !!type && /text|json|javascript|xml|html|css/i.test(type);

function json(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** A request body as an object: JSON, or a form's fields. */
export function parseBody(req: StandInRequest): Record<string, unknown> {
  if (!req.body?.length) return {};
  const text = req.body.toString("utf8");
  const j = json(req.body);
  if (j && typeof j === "object") return j as Record<string, unknown>;
  if (
    /x-www-form-urlencoded/i.test(req.headers["content-type"] ?? "") ||
    /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(text)
  ) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return {};
}

/** A part of a request (`RequestPart`). */
function part(req: StandInRequest, p: RequestPart): unknown {
  const dot = p.indexOf(".");
  const [where, name] = dot < 0 ? [p, ""] : [p.slice(0, dot), p.slice(dot + 1)];
  const u = new URL(req.url);
  switch (where) {
    case "method":
      return req.method;
    case "query":
      return u.searchParams.get(name) ?? undefined;
    case "header":
      return req.headers[name.toLowerCase()];
    case "path":
      return u.pathname.split("/").filter(Boolean)[Number(name)];
    case "body":
      return at(parseBody(req), name);
    default:
      throw new Error(`Unknown request part "${p}"`);
  }
}

function sameParts(parts: RequestPart[], a: StandInRequest, b: StandInRequest): boolean {
  return parts.every((p) => JSON.stringify(part(a, p)) === JSON.stringify(part(b, p)));
}

const present = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);

/** The value at a dotted path ("" is the value itself). */
export function at(v: unknown, path: string): unknown {
  if (!path) return v;
  let cur = v;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** The value with the dotted path set (removed when `value` is undefined); "" replaces the whole value. */
export function setAt(v: unknown, path: string, value: unknown): unknown {
  if (!path) return value;
  const keys = path.split(".");
  let cur = v as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return v;
    cur = cur[k] as Record<string, unknown>;
  }
  if (cur && typeof cur === "object") {
    const last = keys.at(-1) as string;
    if (value === undefined) delete cur[last];
    else cur[last] = value;
  }
  return v;
}

/** Whether a result's label matches the typed text by the site's rule. */
function matches(label: string, text: string, spec: Pick<EndpointSpec, "match" | "caseSensitive">): boolean {
  if (!text) return true;
  const l = spec.caseSensitive ? label : label.toLowerCase();
  const t = spec.caseSensitive ? text : text.toLowerCase();
  switch (spec.match ?? "prefix") {
    case "prefix":
      return l.startsWith(t);
    case "word":
      return l.startsWith(t) || l.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(t));
    case "contains":
      return l.includes(t);
  }
}
