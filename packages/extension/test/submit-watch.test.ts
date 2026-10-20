import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Session and local storage, kept in memory. */
const areas = { session: new Map<string, unknown>(), local: new Map<string, unknown>() };
const area = (m: Map<string, unknown>) => ({
  get: async (key: string) => (m.has(key) ? { [key]: structuredClone(m.get(key)) } : {}),
  set: async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) m.set(k, structuredClone(v));
  },
  remove: async (key: string) => {
    m.delete(key);
  },
});
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { session: area(areas.session), local: area(areas.local) },
};

const { SubmitWatch } = await import("../src/background/submit-watch.js");

const URL_A = "https://example-tenant.myworkdayjobs.com/en-US/External/job/x/apply";

describe("the watch for the user's Submit", () => {
  let confirmed: Map<number, string>;
  let reports: unknown[];
  let reachable: boolean;
  let now: number;
  const watch = () =>
    new SubmitWatch({
      confirmationIn: async (tabId, host) => {
        const url = confirmed.get(tabId);
        return url && new URL(url).host === host ? url : undefined;
      },
      report: async (r) => {
        if (!reachable) throw new Error("not connected");
        reports.push(r);
      },
      now: () => now,
    });

  beforeEach(() => {
    areas.session.clear();
    areas.local.clear();
    confirmed = new Map();
    reports = [];
    reachable = true;
    now = Date.parse("2026-01-01T00:00:00Z");
    // The poll's timer never fires: each test checks by hand.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a watched tab's confirmation page once, for its posting", async () => {
    const w = watch();
    await w.watch(3, URL_A, "p1");
    await w.check();
    expect(reports).toEqual([]);
    confirmed.set(3, `${URL_A}/done`);
    await w.check();
    await w.check();
    expect(reports).toEqual([{ postingId: "p1", url: `${URL_A}/done`, at: "2026-01-01T00:00:00.000Z" }]);
  });

  it("counts only a confirmation on the application's host", async () => {
    const w = watch();
    await w.watch(3, URL_A, "p1");
    confirmed.set(3, "https://other.example.com/thanks");
    await w.check();
    expect(reports).toEqual([]);
    await w.forget(3);
  });

  it("forgets a closed tab, and a watch nobody submitted on after a day", async () => {
    const w = watch();
    await w.watch(3, URL_A, "p1");
    await w.watch(4, URL_A, "p2");
    await w.forget(3);
    now += 25 * 60 * 60 * 1000;
    confirmed.set(3, URL_A);
    confirmed.set(4, URL_A);
    await w.check();
    expect(reports).toEqual([]);
  });

  it("keeps a confirmation seen while the companion is away, and sends it on the next connection", async () => {
    const w = watch();
    await w.watch(3, URL_A, "p1");
    reachable = false;
    confirmed.set(3, URL_A);
    await w.check();
    expect(reports).toEqual([]);
    reachable = true;
    await w.flush();
    expect(reports).toEqual([{ postingId: "p1", url: URL_A, at: "2026-01-01T00:00:00.000Z" }]);
    await w.flush();
    expect(reports).toHaveLength(1);
  });

  it("outlives a background restart: the watches are in session storage", async () => {
    await watch().watch(3, URL_A, "p1");
    confirmed.set(3, URL_A);
    const again = watch();
    await again.checkTab(9);
    expect(reports).toEqual([]);
    await again.checkTab(3);
    expect(reports).toHaveLength(1);
  });
});
