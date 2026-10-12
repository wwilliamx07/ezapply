import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_PERMISSIONS } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";

// npm test builds first, so the output exists.
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "dist", "manifest.json"), "utf8"));

describe("the built manifest", () => {
  it("lets extension pages connect only to the companion on loopback, and run only the extension's scripts", () => {
    const csp: string = manifest.content_security_policy.extension_pages;
    expect(csp).toMatch(/connect-src ws:\/\/127\.0\.0\.1:\*/);
    expect(csp).toMatch(/script-src 'self'/);
  });

  it("holds the debugger, for focus emulation", () => {
    expect(manifest.permissions).toContain("debugger");
  });

  it("covers every site, at install, and nothing is left to grant one origin at a time", () => {
    expect(manifest.host_permissions).toEqual([...HOST_PERMISSIONS]);
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.optional_host_permissions).toBeUndefined();
  });
});
