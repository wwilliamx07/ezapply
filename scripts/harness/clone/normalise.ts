import type { CloneDescription } from "@ezapply/sites/clones";
import { type Exchange, keepRequestHeaders, keepResponseHeaders, sha } from "../lib/store.ts";
import { tokenPlaceholder } from "../standin/engine.ts";

/** A request and its answer as the recorder saw them, before anything is dropped. */
export interface RawExchange {
  method: string;
  url: string;
  resourceType: string;
  reqHeaders: Record<string, string>;
  reqBody?: Buffer;
  status: number;
  resHeaders: Record<string, string>;
  body?: Buffer;
  timing?: { wait: number; receive: number };
  action: string;
  pass: Exchange["pass"];
}

/**
 * What a clone keeps of a recording: only http(s) requests; headers cut to what decides an answer (never cookies,
 * auth headers or tokens); bodies byte for byte, by their hash; each token the description names replaced, wherever
 * it appears, by a placeholder the stand-in swaps for one it issues.
 */
export function normalise(
  raw: RawExchange[],
  desc: CloneDescription | undefined,
): { exchanges: Exchange[]; bodies: Map<string, Buffer> } {
  const tokens = issuedTokens(raw, desc);
  const redact = (buf: Buffer | undefined): Buffer | undefined => {
    if (!buf || !tokens.size) return buf;
    let text = buf.toString("latin1");
    let changed = false;
    for (const [value, name] of tokens) {
      if (text.includes(value)) {
        text = text.replaceAll(value, tokenPlaceholder(name));
        changed = true;
      }
    }
    return changed ? Buffer.from(text, "latin1") : buf;
  };
  const bodies = new Map<string, Buffer>();
  const exchanges: Exchange[] = [];
  for (const r of raw) {
    if (!/^https?:/.test(r.url)) continue;
    const body = redact(r.body);
    const reqBody = redact(r.reqBody);
    let hash: string | undefined;
    if (body?.length) {
      hash = sha(body);
      bodies.set(hash, body);
    }
    let url = r.url;
    for (const [value, name] of tokens) url = url.replaceAll(encodeURIComponent(value), tokenPlaceholder(name));
    exchanges.push({
      id: exchanges.length,
      method: r.method,
      url,
      resourceType: r.resourceType,
      reqHeaders: keepRequestHeaders(r.reqHeaders),
      ...(reqBody?.length ? { reqBody: reqBody.toString("base64") } : {}),
      status: r.status,
      resHeaders: keepResponseHeaders(r.resHeaders),
      ...(hash ? { body: hash } : {}),
      ...(r.timing ? { timing: r.timing } : {}),
      action: r.action,
      pass: r.pass,
    });
  }
  return { exchanges, bodies };
}

/** Every value the site issued as one of the description's tokens, with the token's name. */
function issuedTokens(raw: RawExchange[], desc: CloneDescription | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of desc?.tokens ?? []) {
    const re = new RegExp(t.issued.source, t.issued.flags.includes("g") ? t.issued.flags : `${t.issued.flags}g`);
    for (const r of raw) {
      const where = [r.body?.toString("utf8") ?? "", ...Object.values(r.resHeaders)].join("\n");
      for (const m of where.matchAll(re)) if (m[1] && m[1].length >= 6) out.set(m[1], t.name);
    }
  }
  return out;
}

/** Each endpoint's recorded times: median and spread (10th to 90th percentile), in ms. */
export function timingSummary(
  times: Map<string, number[]>,
): Record<string, { n: number; median: number; p10: number; p90: number }> {
  const q = (s: number[], f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0;
  return Object.fromEntries(
    [...times].map(([k, v]) => {
      const s = [...v].sort((a, b) => a - b);
      return [
        k,
        { n: s.length, median: Math.round(q(s, 0.5)), p10: Math.round(q(s, 0.1)), p90: Math.round(q(s, 0.9)) },
      ];
    }),
  );
}
