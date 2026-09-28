import { afterEach, describe, expect, it, vi } from "vitest";

type Globals = { chrome?: unknown; browser?: unknown };

/** Load browser-id.ts against a stubbed WebExtensions API (ext.ts reads it once, at import). */
async function load(api: { getURL: (p: string) => string; getBrowserInfo?: () => Promise<{ version: string }> }) {
  vi.resetModules();
  const stub = { runtime: api };
  (globalThis as Globals).chrome = stub;
  if (api.getBrowserInfo) (globalThis as Globals).browser = stub;
  return import("../src/background/browser-id.js");
}

afterEach(() => {
  delete (globalThis as Globals).chrome;
  delete (globalThis as Globals).browser;
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

  it("asks Firefox itself", async () => {
    const { detectBrowser } = await load({
      getURL: (p) => `moz-extension://0f8e3c2a-5b1d-4c6e-9a7f-2d4b6e8a1c3f/${p}`,
      getBrowserInfo: async () => ({ version: "140.0" }),
    });
    expect(await detectBrowser({})).toEqual({ name: "firefox", version: "140.0" });
  });
});
