import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARK } from "../src/components/ui.js";

const ui = join(import.meta.dirname, "..");
const extension = join(ui, "../extension");

describe("ezapply's mark", () => {
  it("is drawn the same inline (Brand) as in mark.svg, which the favicon and the extension's icons come from", () => {
    const svg = readFileSync(join(ui, "static/mark.svg"), "utf8");
    expect(svg).toContain(`d="${MARK.path}"`);
    expect(svg).toContain(`fill="${MARK.background}"`);
  });

  it("is every icon the extension's manifest names, and each one is there", () => {
    const manifest = JSON.parse(readFileSync(join(extension, "static/manifest.json"), "utf8"));
    const files = [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)] as string[];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(existsSync(join(extension, "static", f)), f).toBe(true);
  });
});
