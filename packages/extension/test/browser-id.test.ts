import { describe, expect, it } from "vitest";
import { detectBrowser } from "../src/background/browser-id.js";

const brands = (...names: string[]) => ({
  userAgentData: {
    brands: [{ brand: "Not/A)Brand", version: "8" }, ...names.map((brand) => ({ brand, version: "131" }))],
  },
});

describe("detectBrowser", () => {
  it("names a Chromium browser by its own brand before the Chrome or Chromium it builds on", async () => {
    expect(await detectBrowser(brands("Chromium", "Google Chrome"))).toEqual({ name: "chrome", version: "131" });
    expect(await detectBrowser(brands("Chromium", "Microsoft Edge"))).toEqual({ name: "edge", version: "131" });
    expect(await detectBrowser(brands("Chromium", "Brave"))).toEqual({ name: "brave", version: "131" });
    expect(await detectBrowser(brands("Chromium"))).toEqual({ name: "chromium", version: "131" });
    expect(await detectBrowser({})).toBeUndefined();
  });
});
