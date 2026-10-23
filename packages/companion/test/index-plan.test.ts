import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { componentsOver, ignoredPath, indexMode } from "../src/repos/index-plan.js";

describe("the index plan", () => {
  it("names the mode from the last index and what changed", () => {
    expect(indexMode(false, null)).toBe("full");
    expect(indexMode(true, null)).toBe("rebuild");
    expect(indexMode(true, [])).toBe("current");
    expect(indexMode(true, [{}])).toBe("reindex");
  });

  it("leaves out lock files, vendored and generated paths, and nothing else", () => {
    for (const p of ["package-lock.json", "api/go.sum", "vendor/lib/a.go", "web/dist/app.js", "a.min.js", "x_pb2.py"]) {
      expect(ignoredPath(p)).toBe(true);
    }
    for (const p of ["src/build.ts", "src/distance.ts", "README.md", "lockfile.md"]) expect(ignoredPath(p)).toBe(false);
  });

  it("lists the folders to depth 3 over 15 files or 2k lines, without ignored paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "ezapply-plan-"));
    try {
      const files: Record<string, string> = {};
      for (let i = 0; i < 16; i++) files[`src/ui/c${i}.ts`] = "x\n";
      files["src/core/big.ts"] = "x\n".repeat(2001);
      files["src/a/b/c/d/deep.ts"] = "x\n".repeat(2001);
      for (let i = 0; i < 20; i++) files[`node_modules/p/f${i}.js`] = "x\n";
      for (const [p, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, p)), { recursive: true });
        await writeFile(join(root, p), content);
      }
      const over = await componentsOver(root, Object.keys(files));
      expect(over).toEqual([
        { path: "src", files: 18, lines: 4018 },
        { path: "src/a", files: 1, lines: 2001 },
        { path: "src/a/b", files: 1, lines: 2001 },
        { path: "src/core", files: 1, lines: 2001 },
        { path: "src/ui", files: 16, lines: 16 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
