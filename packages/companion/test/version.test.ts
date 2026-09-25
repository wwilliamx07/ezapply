import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { COMPANION_VERSION } from "../src/version.js";

it("COMPANION_VERSION matches package.json", async () => {
  const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf8"));
  expect(COMPANION_VERSION).toBe(pkg.version);
});
