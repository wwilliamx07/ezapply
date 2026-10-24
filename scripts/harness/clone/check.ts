import type { CloneDescription } from "@ezapply/sites/clones";
import type { Clone, Exchange } from "../lib/store.ts";
import { at, StandIn, setAt, toRequest } from "../standin/engine.ts";

interface CheckResult {
  pass: Exchange["pass"];
  total: number;
  same: number;
  /** The requests the stand-in answered differently from the site, or not at all. */
  differences: { id: number; method: string; url: string; endpoint?: string; why: string }[];
}

/**
 * The equivalence check: each of a pass's recorded requests, in order, sent to a stand-in built from the explore
 * pass, and its answer compared with the site's, the description's volatile parts aside. Run on the explore pass it
 * shows the stand-in reproduces what it was built from; on the held-out pass, that it answers a path it never saw.
 */
export function checkPass(
  clone: Pick<Clone, "exchanges" | "body">,
  desc: CloneDescription,
  pass: Exchange["pass"],
): CheckResult {
  const standIn = new StandIn(clone, desc, { latency: 0, replay: true });
  const recorded = clone.exchanges.filter((e) => e.pass === pass);
  const differences: CheckResult["differences"] = [];
  for (const e of recorded) {
    const spec = standIn.endpointOf(e.method, e.url);
    if (spec?.kind === "beacon") continue;
    const res = standIn.handle(toRequest(e));
    const base = { id: e.id, method: e.method, url: e.url, ...(spec ? { endpoint: spec.name } : {}) };
    if (!res) {
      differences.push({ ...base, why: standIn.problems.at(-1)?.detail ?? "no answer" });
      continue;
    }
    if (res.status !== e.status) {
      differences.push({ ...base, why: `status ${res.status}, the site's ${e.status}` });
      continue;
    }
    const site = clone.body(e.body);
    if (!sameBody(site, res.body, spec?.volatile ?? [])) differences.push({ ...base, why: "a different body" });
  }
  return { pass, total: recorded.length, same: recorded.length - differences.length, differences };
}

/** Byte for byte, or as JSON with the volatile paths removed from both. */
function sameBody(a: Buffer, b: Buffer, volatile: string[]): boolean {
  if (a.equals(b)) return true;
  if (!volatile.length) return false;
  try {
    const strip = (buf: Buffer) => {
      let v = JSON.parse(buf.toString("utf8")) as unknown;
      for (const p of volatile) v = at(v, p) === undefined ? v : setAt(v, p, undefined);
      return JSON.stringify(v);
    };
    return strip(a) === strip(b);
  } catch {
    return false;
  }
}
