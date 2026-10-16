import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const failures = vi.hoisted(() => ({ left: 0, code: "EPERM" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (failures.left > 0) {
        failures.left--;
        throw Object.assign(new Error(`${failures.code}: operation not permitted`), { code: failures.code });
      }
      return real.rename(from, to);
    },
  };
});

const { writeFileAtomic } = await import("../src/util/fs.js");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezapply-fs-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("retries a rename that fails while something has the target open", async () => {
    failures.left = 2;
    failures.code = "EBUSY";
    const path = join(dir, "meta.json");
    await writeFileAtomic(path, "{}\n");
    expect(await readFile(path, "utf8")).toBe("{}\n");
    expect(await readdir(dir)).toEqual(["meta.json"]);
  });

  it("reports a lock that outlasts the retries, blaming a viewer only for a PDF", async () => {
    failures.left = Number.POSITIVE_INFINITY;
    failures.code = "EPERM";
    await expect(writeFileAtomic(join(dir, "state.json"), "{}")).rejects.toMatchObject({
      message: expect.stringContaining("locked by another program"),
      hint: expect.not.stringContaining("PDF"),
    });
    await expect(writeFileAtomic(join(dir, "resume.pdf"), "%PDF")).rejects.toMatchObject({
      hint: expect.stringContaining("PDF viewers"),
    });
    failures.left = 0;
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  }, 10_000);
});
