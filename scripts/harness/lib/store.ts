import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Where clones live: git-ignored, at the repo's root. */
export const CLONES = join(import.meta.dirname, "..", "..", "..", ".clones");

/** One request the site answered while cloning, as kept: headers cut to an allowlist, the body by its hash. */
export interface Exchange {
  id: number;
  method: string;
  url: string;
  resourceType: string;
  reqHeaders: Record<string, string>;
  /** The request's body, base64. */
  reqBody?: string;
  status: number;
  resHeaders: Record<string, string>;
  /** The response body's file under `bodies/` (its sha-256); absent for an empty body. */
  body?: string;
  /** Milliseconds from sending the request to the first byte back, and from there to the last. */
  timing?: { wait: number; receive: number };
  /** What the explorer was doing when the request was sent. */
  action: string;
  /** `explore`: the clone's data. `held-out`: the second path, kept only to check the stand-in against. */
  pass: "explore" | "held-out";
}

/** What `clone.json` records about a clone. */
export interface CloneMeta {
  site: string;
  /** The posting or application the clone started from. */
  url: string;
  /** When it was captured: fill runs pin the page's clock here. */
  capturedAt: string;
  /** Every check passed: fill runs pick the newest usable clone. */
  usable: boolean;
  /** The clone's report: coverage, checks, what the explorer couldn't open. */
  report: Record<string, unknown>;
}

export interface Clone {
  dir: string;
  id: string;
  meta: CloneMeta;
  exchanges: Exchange[];
  body(hash: string | undefined): Buffer;
}

/** Request headers kept: what decides an answer, never cookies, auth or tokens. */
const REQUEST_HEADERS = new Set(["content-type", "accept"]);
/** Response headers kept: what the page reads. Cookies never; encodings are gone (bodies are stored decoded). */
const RESPONSE_HEADERS = new Set(["content-type", "location", "content-disposition"]);

export function keepRequestHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).filter(([k]) => REQUEST_HEADERS.has(k.toLowerCase())));
}

export function keepResponseHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(h).filter(([k]) => RESPONSE_HEADERS.has(k.toLowerCase()) || /^access-control-/i.test(k)),
  );
}

export const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A new clone's directory: `.clones/<site>/<timestamp>`. */
export function newCloneDir(site: string, root = CLONES): { dir: string; id: string } {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  return { dir: join(root, site, id), id };
}

export async function writeClone(
  dir: string,
  meta: CloneMeta,
  exchanges: Exchange[],
  bodies: Map<string, Buffer>,
): Promise<void> {
  await mkdir(join(dir, "bodies"), { recursive: true });
  for (const [hash, buf] of bodies) await writeFile(join(dir, "bodies", hash), buf);
  await writeFile(join(dir, "exchanges.json"), `${JSON.stringify(exchanges, null, 1)}\n`);
  await writeMeta(dir, meta);
}

export const writeMeta = (dir: string, meta: CloneMeta) =>
  writeFile(join(dir, "clone.json"), `${JSON.stringify(meta, null, 2)}\n`);

export async function loadClone(dir: string): Promise<Clone> {
  const meta = JSON.parse(await readFile(join(dir, "clone.json"), "utf8")) as CloneMeta;
  const exchanges = JSON.parse(await readFile(join(dir, "exchanges.json"), "utf8")) as Exchange[];
  const bodies = new Map<string, Buffer>();
  for (const e of exchanges) {
    if (e.body && !bodies.has(e.body)) bodies.set(e.body, await readFile(join(dir, "bodies", e.body)));
  }
  return {
    dir,
    id: dir.split(/[\\/]/).at(-1) ?? dir,
    meta,
    exchanges,
    body: (hash) => (hash ? (bodies.get(hash) ?? Buffer.alloc(0)) : Buffer.alloc(0)),
  };
}

/**
 * A clone by a site's name (its newest usable clone, else its newest) or by its id (any site's), or by its path.
 */
export async function findClone(which: string, root = CLONES): Promise<string | undefined> {
  if (existsSync(join(which, "clone.json"))) return which;
  if (!existsSync(root)) return undefined;
  const sites = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== ".profile");
  const ids = async (site: string) =>
    (await readdir(join(root, site), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && existsSync(join(root, site, d.name, "clone.json")))
      .map((d) => d.name)
      .sort();
  for (const s of sites) if ((await ids(s.name)).includes(which)) return join(root, s.name, which);
  if (!sites.some((s) => s.name === which)) return undefined;
  const all = (await ids(which)).reverse();
  for (const id of all) {
    const meta = JSON.parse(await readFile(join(root, which, id, "clone.json"), "utf8")) as CloneMeta;
    if (meta.usable) return join(root, which, id);
  }
  return all[0] ? join(root, which, all[0]) : undefined;
}
