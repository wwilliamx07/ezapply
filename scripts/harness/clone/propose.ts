import type { EndpointKind } from "@ezapply/sites/clones";
import type { Clone, Exchange } from "../lib/store.ts";
import { at, parseBody, toRequest } from "../standin/engine.ts";

/** One proposed endpoint: a description entry with what it was guessed from. */
interface Proposal {
  name: string;
  kind: EndpointKind;
  method: string;
  url: string;
  key?: string[];
  query?: string;
  items?: string;
  label?: string;
  /** Why this kind, and how many requests it covers. */
  because: string;
}

/** The front end: saved as files and answered by URL, never an endpoint. */
const FRONT_END = new Set(["document", "script", "stylesheet", "image", "font", "media", "manifest", "texttrack"]);

/**
 * A description for a new site, proposed from what the cloner recorded: the site's own requests (not its front-end
 * files) grouped by URL pattern, each group's kind from what the explorer was doing when they were sent (a request
 * whose parameter carried typed text is a search, one sent on Next a step) and from what varied between them. The
 * agent writing the site's `clone.ts` checks and corrects it.
 */
export function propose(clone: Pick<Clone, "exchanges" | "body">): Proposal[] {
  const groups = new Map<string, Exchange[]>();
  for (const e of clone.exchanges) {
    if (e.pass !== "explore" || FRONT_END.has(e.resourceType)) continue;
    const pattern = `${e.method} ${urlPattern(e.url)}`;
    groups.set(pattern, [...(groups.get(pattern) ?? []), e]);
  }
  const used = new Set<string>();
  return [...groups].map(([pattern, list]) => {
    const [method, url] = pattern.split(" ", 2) as [string, string];
    const p = classify(clone, method, list);
    let name = nameOf(url);
    for (let n = 2; used.has(name); n++) name = `${nameOf(url)}-${n}`;
    used.add(name);
    return { name, method, url, ...p };
  });
}

function classify(
  clone: Pick<Clone, "body">,
  method: string,
  list: Exchange[],
): Omit<Proposal, "name" | "method" | "url"> {
  const n = `${list.length} request${list.length === 1 ? "" : "s"}`;
  const actions = new Set(list.map((e) => e.action.split(" ")[0] ?? ""));
  if (
    list.every((e) => e.status === 204 || e.resourceType === "ping") ||
    list.every((e) => !e.body && method === "POST" && e.action === "load")
  ) {
    return { kind: "beacon", because: `${n}, answered empty` };
  }
  // A parameter whose value was the text typed in a search: a search.
  for (const e of list) {
    const m = /^(?:search|type) \S+ (.*)$/.exec(e.action);
    if (!m) continue;
    const typed = (m[1] ?? "").toLowerCase();
    const req = toRequest(e);
    const params = [...new URL(e.url).searchParams].map(([k, v]) => [`query.${k}`, v] as const);
    const body = Object.entries(parseBody(req)).map(([k, v]) => [`body.${k}`, String(v)] as const);
    const hit = [...params, ...body].find(([, v]) => v && typed.startsWith(v.toLowerCase()));
    // An autosave carries the typed text too: a search answers with a list of results.
    const results = hit && resultsOf(clone, list);
    if (hit && results?.items !== undefined) {
      return { kind: "search", query: hit[0], ...results, because: `${n}; ${hit[0]} carried the typed text` };
    }
  }
  if (actions.has("next") || actions.has("back")) return { kind: "step", because: `${n}, sent on Next or Back` };
  if (actions.has("upload")) return { kind: "upload", because: `${n}, sent on attaching a file` };
  if (method !== "GET" && [...actions].some((a) => ["type", "choose", "remove", "add"].includes(a))) {
    return { kind: "save", because: `${n}, sent when a field changed` };
  }
  const varying = varyingParts(list);
  if (varying.length) {
    const kind = actions.has("choose") ? "nested-list" : "list";
    return { kind, key: varying, because: `${n}; answers varied with ${varying.join(", ")}` };
  }
  return { kind: list.length > 1 || actions.has("list") ? "list" : "static", because: n };
}

/** The array in the answers that held the results, and the field in each result that matched the typed text. */
function resultsOf(clone: Pick<Clone, "body">, list: Exchange[]): { items?: string; label?: string } {
  for (const e of list) {
    let j: unknown;
    try {
      j = JSON.parse(clone.body(e.body).toString("utf8"));
    } catch {
      continue;
    }
    const arrays = findArrays(j, "");
    const best = arrays.sort((a, b) => b.length - a.length)[0];
    if (!best?.length) continue;
    const first = (at(j, best.path) as unknown[])[0];
    const label =
      first && typeof first === "object"
        ? Object.entries(first as Record<string, unknown>).find(([, v]) => typeof v === "string")?.[0]
        : "";
    return { items: best.path, ...(label !== undefined ? { label } : {}) };
  }
  return {};
}

function findArrays(v: unknown, path: string): { path: string; length: number }[] {
  if (Array.isArray(v)) return [{ path, length: v.length }];
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => findArrays(x, path ? `${path}.${k}` : k));
}

/** The query parameters and body fields that differ between a group's requests. */
function varyingParts(list: Exchange[]): string[] {
  const values = new Map<string, Set<string>>();
  for (const e of list) {
    const req = toRequest(e);
    const parts = [
      ...[...new URL(e.url).searchParams].map(([k, v]) => [`query.${k}`, v] as const),
      ...Object.entries(parseBody(req)).map(([k, v]) => [`body.${k}`, JSON.stringify(v)] as const),
    ];
    for (const [k, v] of parts) values.set(k, (values.get(k) ?? new Set()).add(v));
  }
  return [...values].filter(([, v]) => v.size > 1).map(([k]) => k);
}

/** A URL as a pattern: its query dropped, ids in its path (numbers, uuids, long hex) made wildcards. */
function urlPattern(url: string): string {
  const u = new URL(url);
  const path = u.pathname
    .split("/")
    .map((s) => (/^\d+$|^[0-9a-f]{8}-[0-9a-f-]{27}$|^[0-9a-f]{16,}$/i.test(s) ? "*" : s))
    .join("/");
  return `${u.origin}${path}`;
}

const nameOf = (pattern: string) =>
  pattern
    .split("/")
    .slice(3)
    .filter((s) => s && s !== "*")
    .slice(-2)
    .join("-")
    .replace(/[^a-z0-9-]/gi, "")
    .toLowerCase() || "root";

/** The proposal as the source of a site's `clone.ts`, for the agent to check and correct. */
export function proposalSource(site: string, proposals: Proposal[]): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\\\*/g, "[^/]+");
  const lines = proposals.map((p) => {
    const fields = [
      `name: ${JSON.stringify(p.name)}`,
      `kind: ${JSON.stringify(p.kind)}`,
      `method: ${JSON.stringify(p.method)}`,
      `url: /^${esc(p.url)}(\\?|$)/`,
      ...(p.key ? [`key: ${JSON.stringify(p.key)}`] : []),
      ...(p.query ? [`query: ${JSON.stringify(p.query)}`, `match: "prefix"`] : []),
      ...(p.items !== undefined ? [`items: ${JSON.stringify(p.items)}`] : []),
      ...(p.label !== undefined ? [`label: ${JSON.stringify(p.label)}`] : []),
    ];
    return `    // ${p.because}\n    { ${fields.join(", ")} },`;
  });
  return [
    'import type { CloneDescription } from "../clones.js";',
    "",
    `/** Proposed by the cloner from what it recorded: check each kind, key and match rule before relying on it. */`,
    `export const ${site}Clone: CloneDescription = {`,
    "  endpoints: [",
    ...lines,
    "  ],",
    "};",
    "",
  ].join("\n");
}
