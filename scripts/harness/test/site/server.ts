import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CloneDescription } from "@ezapply/sites/clones";
import type { StandInRequest } from "../../standin/engine.ts";

/**
 * A small hand-written site for the harness's own tests: its server, played by a function, and its front end
 * (`index.html`, `app.js`). The tests clone it as they would a real site and check the stand-in against it.
 */
export const TEST_SITE = "https://apply.test-site.example";
export const TEST_URL = `${TEST_SITE}/apply`;

const COUNTRIES = [
  { code: "CA", name: "Canada" },
  { code: "FR", name: "France" },
  { code: "NZ", name: "New Zealand" },
];
const REGIONS: Record<string, string[]> = {
  CA: ["Alberta", "Ontario", "Quebec"],
  FR: ["Bretagne", "Normandie"],
  NZ: [],
};
const SCHOOLS = [
  "Atlantic College",
  "Bay State University",
  "Central Institute of Technology",
  "College of the North",
  "Eastern Arts Academy",
  "Northern Technical College",
  "Pacific State University",
  "State College of Design",
  "Technical University of the East",
  "University of the Plains",
  "Western Polytechnic",
  "Westfield College",
];
const PAGE = 5;

const file = (name: string) => readFileSync(join(import.meta.dirname, name));
const json = (status: number, v: unknown) => ({
  status,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify(v)),
});

interface SiteResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** The test site's server: one session per instance, with its own token. */
export function testServer() {
  const csrf = randomBytes(8).toString("hex");
  const saved: Record<string, string> = {};
  const submits: string[] = [];
  return {
    saved,
    submits,
    handle(req: StandInRequest): SiteResponse {
      const u = new URL(req.url);
      if (u.origin !== TEST_SITE) return { status: 404, headers: {}, body: Buffer.alloc(0) };
      const route = `${req.method} ${u.pathname}`;
      switch (route) {
        case "GET /apply":
          return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: file("index.html") };
        case "GET /app.js":
          return { status: 200, headers: { "content-type": "text/javascript" }, body: file("app.js") };
        case "GET /style.css":
          return {
            status: 200,
            headers: { "content-type": "text/css" },
            body: Buffer.from("body{font:16px sans-serif}"),
          };
        case "GET /api/session":
          return json(200, { csrf });
        case "GET /api/countries":
          return json(200, { countries: COUNTRIES });
        case "GET /api/regions":
          return json(200, { regions: REGIONS[u.searchParams.get("country") ?? ""] ?? [] });
        case "GET /api/schools": {
          const q = (u.searchParams.get("q") ?? "").toLowerCase();
          const hits = SCHOOLS.filter((s) =>
            s
              .toLowerCase()
              .split(/\s+/)
              .some((w) => w.startsWith(q)),
          );
          return json(200, { results: hits.slice(0, PAGE).map((name) => ({ name })), at: Date.now() });
        }
        case "POST /api/save": {
          if (req.headers["x-csrf"] !== csrf) return json(403, { error: "bad token" });
          const { field, value } = JSON.parse(req.body?.toString("utf8") ?? "{}");
          saved[field] = value;
          return json(200, { ok: true });
        }
        case "POST /api/submit":
          submits.push(req.body?.toString("utf8") ?? "");
          return json(200, { ok: true });
        default:
          return { status: 404, headers: {}, body: Buffer.alloc(0) };
      }
    },
  };
}

/** The test site's description, as a site's `clone.ts` would give it. */
export const testDescription: CloneDescription = {
  endpoints: [
    { name: "session", kind: "static", method: "GET", url: /\/api\/session$/ },
    { name: "countries", kind: "list", method: "GET", url: /\/api\/countries$/ },
    { name: "regions", kind: "nested-list", method: "GET", url: /\/api\/regions\?/, key: ["query.country"] },
    {
      name: "schools",
      kind: "search",
      method: "GET",
      url: /\/api\/schools\?/,
      query: "query.q",
      match: "word",
      items: "results",
      label: "name",
      volatile: ["at"],
    },
    { name: "save", kind: "save", method: "POST", url: /\/api\/save$/ },
    { name: "submit", kind: "submit", url: /\/api\/submit/ },
  ],
  tokens: [{ name: "csrf", issued: /"csrf":"([0-9a-f]+)"/, sent: "header.x-csrf" }],
};
