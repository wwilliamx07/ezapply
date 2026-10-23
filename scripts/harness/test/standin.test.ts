import type { CloneDescription } from "@ezapply/sites/clones";
import { describe, expect, it } from "vitest";
import { checkPass } from "../clone/check.ts";
import { normalise, type RawExchange } from "../clone/normalise.ts";
import { propose } from "../clone/propose.ts";
import type { Exchange } from "../lib/store.ts";
import { StandIn, type StandInRequest, tokenPlaceholder } from "../standin/engine.ts";
import { TEST_SITE, TEST_URL, testDescription, testServer } from "./site/server.ts";

const get = (path: string): StandInRequest => ({ method: "GET", url: `${TEST_SITE}${path}`, headers: {} });
const post = (path: string, body: unknown, headers: Record<string, string> = {}): StandInRequest => ({
  method: "POST",
  url: `${TEST_SITE}${path}`,
  headers: { "content-type": "application/json", ...headers },
  body: Buffer.from(JSON.stringify(body)),
});

/** Requests sent to the test site's server and recorded as the cloner would, each with its action and pass. */
function record(steps: [StandInRequest | ((csrf: string) => StandInRequest), string, Exchange["pass"]?][]) {
  const server = testServer();
  const raw: RawExchange[] = [];
  let csrf = "";
  for (const [r, action, pass] of steps) {
    const req = typeof r === "function" ? r(csrf) : r;
    const res = server.handle(req);
    if (req.url.endsWith("/api/session")) csrf = JSON.parse(res.body.toString()).csrf;
    raw.push({
      method: req.method,
      url: req.url,
      resourceType: req.url.includes("/api/") ? "fetch" : req.url.endsWith(".js") ? "script" : "document",
      reqHeaders: { ...req.headers, cookie: "session=secret", authorization: "Bearer secret" },
      ...(req.body ? { reqBody: req.body } : {}),
      status: res.status,
      resHeaders: { ...res.headers, "set-cookie": "session=secret" },
      body: res.body,
      timing: { wait: 100, receive: 20 },
      action,
      pass: pass ?? "explore",
    });
  }
  const { exchanges, bodies } = normalise(raw, testDescription);
  const clone = {
    exchanges,
    body: (h: string | undefined) => (h ? (bodies.get(h) ?? Buffer.alloc(0)) : Buffer.alloc(0)),
  };
  return { clone, bodies, server, raw };
}

const exploreSteps = (): Parameters<typeof record>[0] => [
  [get("/apply"), "load"],
  [get("/app.js"), "load"],
  [get("/api/session"), "load"],
  [get("/api/countries"), "load"],
  [get("/api/regions?country=CA"), "choose country Canada"],
  [get("/api/regions?country=FR"), "choose country France"],
  [get("/api/schools?q=a"), "type school a"],
  [get("/api/schools?q=c"), "type school c"],
  [get("/api/schools?q=s"), "type school s"],
  [get("/api/schools?q=t"), "type school t"],
  [get("/api/schools?q=u"), "type school u"],
  [get("/api/schools?q=w"), "type school w"],
  [get("/api/schools?q=n"), "type school n"],
  [get("/api/schools?q=p"), "type school p"],
  [get("/api/schools?q=e"), "type school e"],
  [get("/api/schools?q=b"), "type school b"],
  [(csrf) => post("/api/save", { field: "first", value: "Jane" }, { "x-csrf": csrf }), "type first Jane"],
];

describe("the stand-in", () => {
  it("answers every recorded request as the site did", () => {
    const { clone } = record(exploreSteps());
    const r = checkPass(clone, testDescription, "explore");
    expect(r.differences).toEqual([]);
    expect(r.same).toBe(exploreSteps().length);
  });

  it("answers a held-out search it never saw by the site's matching rule, from the saved dataset", () => {
    const { clone } = record([
      ...exploreSteps(),
      [get("/api/schools?q=te"), "search school te", "held-out"],
      [get("/api/schools?q=Col"), "search school Col", "held-out"],
      [get("/api/schools?q=zz"), "search school zz", "held-out"],
      [get("/api/regions?country=CA"), "choose country Canada", "held-out"],
    ]);
    const r = checkPass(clone, testDescription, "held-out");
    expect(r.differences).toEqual([]);
    expect(r.total).toBe(4);
  });

  it("fails a list request it has no answer for, naming it", () => {
    const { clone } = record(exploreSteps());
    const s = new StandIn(clone, testDescription, { latency: 0 });
    expect(s.handle(get("/api/regions?country=NZ"))).toBeNull();
    expect(s.handle(get("/favicon.ico"))).toBeNull();
    expect(s.problems.map((p) => [p.kind, p.url])).toEqual([
      ["unknown", `${TEST_SITE}/api/regions?country=NZ`],
      ["unknown", `${TEST_SITE}/favicon.ico`],
    ]);
  });

  it("never answers a submit, and records it", () => {
    const { clone } = record(exploreSteps());
    const s = new StandIn(clone, testDescription, { latency: 0 });
    expect(s.handle(post("/api/submit", {}))).toBeNull();
    expect(s.problems).toMatchObject([{ kind: "submit" }]);
  });

  it("issues tokens of its own, and refuses a request that sends one it didn't issue", () => {
    const { clone, bodies } = record(exploreSteps());
    const recordedToken = /"csrf":"([0-9a-f]+)"/;
    for (const b of bodies.values()) expect(b.toString()).not.toMatch(recordedToken);
    const s = new StandIn(clone, testDescription, { latency: 0 });
    const issued = JSON.parse(s.handle(get("/api/session"))?.body.toString() ?? "{}").csrf;
    expect(issued).toMatch(/^t[0-9a-f]{24}$/);
    expect(s.handle(post("/api/save", { field: "first", value: "Jane" }, { "x-csrf": "forged" }))?.status).toBe(403);
    expect(s.handle(post("/api/save", { field: "last", value: "Doe" }, { "x-csrf": issued }))?.status).toBe(200);
    expect(s.problems.map((p) => p.kind)).toEqual(["token"]);
    expect(s.saved.get("save")).toEqual([{ field: "last", value: "Doe" }]);
  });

  it("answers a step with its way on when the required parts are there, else with its refusal", () => {
    const ex = (id: number, body: unknown, status: number, answer: string): Exchange => ({
      id,
      method: "POST",
      url: `${TEST_SITE}/api/step`,
      resourceType: "fetch",
      reqHeaders: { "content-type": "application/json" },
      reqBody: Buffer.from(JSON.stringify(body)).toString("base64"),
      status,
      resHeaders: { "content-type": "application/json" },
      body: answer,
      action: "next",
      pass: "explore",
    });
    const clone = {
      exchanges: [
        ex(0, { step: 1 }, 422, "refused"),
        ex(1, { step: 1, first: "Jane", email: "j@example.com" }, 200, "on"),
      ],
      body: (h: string | undefined) => Buffer.from(h ?? ""),
    };
    const desc: CloneDescription = {
      endpoints: [
        { name: "step", kind: "step", url: /\/api\/step$/, key: ["body.step"], required: ["body.first", "body.email"] },
      ],
    };
    const s = new StandIn(clone, desc, { latency: 0 });
    expect(s.handle(post("/api/step", { step: 1, first: "John", email: "x@example.com" }))?.body.toString()).toBe("on");
    expect(s.handle(post("/api/step", { step: 1, first: "John", email: "" }))?.status).toBe(422);
    expect(s.handle(post("/api/step", { step: 2, first: "John", email: "x@example.com" }))).toBeNull();
  });

  it("gives a request's recorded answers in the order the site gave them", () => {
    const { clone } = record([
      [get("/api/countries"), "load"],
      [get("/api/countries"), "load"],
    ]);
    // Two different answers to one request: the second recorded after a change on the site.
    clone.exchanges[1] = { ...(clone.exchanges[1] as Exchange), status: 201 };
    const s = new StandIn(clone, testDescription, { latency: 0 });
    expect([
      s.handle(get("/api/countries"))?.status,
      s.handle(get("/api/countries"))?.status,
      s.handle(get("/api/countries"))?.status,
    ]).toEqual([200, 201, 201]);
  });

  it("holds each answer for a recorded time of its endpoint, scaled by the latency", () => {
    const { clone } = record(exploreSteps());
    const at = (latency: number) =>
      new StandIn(clone, testDescription, { latency, random: () => 0 }).handle(get("/api/countries"))?.delayMs;
    expect([at(0), at(1), at(2)]).toEqual([0, 120, 240]);
  });
});

describe("what a clone keeps", () => {
  it("drops cookies, auth headers and other requests' headers, and keeps bodies byte for byte", () => {
    const { clone, raw } = record([[get("/apply"), "load"]]);
    const [e] = clone.exchanges as [Exchange];
    expect(JSON.stringify(e)).not.toContain("secret");
    expect(e.resHeaders).toEqual({ "content-type": "text/html; charset=utf-8" });
    expect(clone.body(e.body).equals(raw[0]?.body as Buffer)).toBe(true);
  });

  it("keeps only http(s) requests, and puts a placeholder where a token was sent back", () => {
    const { exchanges } = normalise(
      [
        {
          method: "GET",
          url: "data:text/plain,x",
          resourceType: "other",
          reqHeaders: {},
          status: 200,
          resHeaders: {},
          action: "load",
          pass: "explore",
        },
        {
          method: "GET",
          url: `${TEST_SITE}/api/session`,
          resourceType: "fetch",
          reqHeaders: {},
          status: 200,
          resHeaders: {},
          body: Buffer.from('{"csrf":"abcdef123456"}'),
          action: "load",
          pass: "explore",
        },
        {
          method: "GET",
          url: `${TEST_SITE}/api/x?t=abcdef123456`,
          resourceType: "fetch",
          reqHeaders: {},
          status: 200,
          resHeaders: {},
          action: "load",
          pass: "explore",
        },
      ],
      testDescription,
    );
    expect(exchanges.map((e) => e.url)).toEqual([
      `${TEST_SITE}/api/session`,
      `${TEST_SITE}/api/x?t=${tokenPlaceholder("csrf")}`,
    ]);
  });
});

describe("the proposed description", () => {
  it("tells searches, nested lists, saves and lists apart from what the explorer was doing", () => {
    const { clone } = record(exploreSteps());
    const kinds = Object.fromEntries(propose(clone).map((p) => [p.url.replace(TEST_SITE, ""), p]));
    expect(kinds["/api/schools"]).toMatchObject({ kind: "search", query: "query.q", items: "results", label: "name" });
    expect(kinds["/api/regions"]).toMatchObject({ kind: "nested-list", key: ["query.country"] });
    expect(kinds["/api/save"]).toMatchObject({ kind: "save", method: "POST" });
    expect(kinds["/api/countries"]?.kind).toBe("static");
    expect(kinds["/apply"]).toBeUndefined();
    expect(TEST_URL).toContain("/apply");
  });
});
