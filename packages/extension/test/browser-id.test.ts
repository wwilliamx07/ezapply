import { afterEach, describe, expect, it, vi } from "vitest";

type Globals = { chrome?: unknown };

/** Load browser-id.ts against a stubbed extension API. */
async function load(api: { getURL: (p: string) => string }) {
  vi.resetModules();
  (globalThis as Globals).chrome = { runtime: api };
  return import("../src/background/browser-id.js");
}

afterEach(() => {
  delete (globalThis as Globals).chrome;
});

const chromium = { getURL: (p: string) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${p}` };
const brands = (...names: string[]) => ({
  userAgentData: {
    brands: [{ brand: "Not/A)Brand", version: "8" }, ...names.map((brand) => ({ brand, version: "131" }))],
  },
});

describe("detectBrowser", () => {
  it("names a Chromium browser by its own brand before the Chrome or Chromium it builds on", async () => {
    const { detectBrowser } = await load(chromium);
    expect(await detectBrowser(brands("Chromium", "Google Chrome"))).toEqual({ name: "chrome", version: "131" });
    expect(await detectBrowser(brands("Chromium", "Microsoft Edge"))).toEqual({ name: "edge", version: "131" });
    expect(await detectBrowser(brands("Chromium", "Brave"))).toEqual({ name: "brave", version: "131" });
    expect(await detectBrowser(brands("Chromium"))).toEqual({ name: "chromium", version: "131" });
    expect(await detectBrowser({})).toBeUndefined();
  });
});
