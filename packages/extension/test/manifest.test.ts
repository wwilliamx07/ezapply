import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_PERMISSIONS } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";

// npm test builds first, so both outputs exist.
const manifest = (dir: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", dir, "manifest.json"), "utf8"));

describe("Firefox build", () => {
  const ff = manifest("dist-firefox");

  it("keeps the companion socket on ws:// (no upgrade-insecure-requests) and allows only loopback", () => {
    const csp: string = ff.content_security_policy.extension_pages;
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
    expect(csp).toMatch(/connect-src ws:\/\/127\.0\.0\.1:\*/);
    expect(csp).toMatch(/script-src 'self'/);
  });

  it("runs the background as an event page with a fixed gecko id", () => {
    expect(ff.background.scripts).toEqual(["background.js"]);
    expect(ff.browser_specific_settings.gecko.id).toBe("ezapply@ezapply.local");
  });
});

describe("host permissions", () => {
  it("cover every site, at install, and nothing is left to grant one origin at a time", () => {
    for (const dir of ["dist", "dist-firefox"]) {
      expect(manifest(dir).host_permissions).toEqual([...HOST_PERMISSIONS]);
      expect(manifest(dir).host_permissions).toEqual(["<all_urls>"]);
      expect(manifest(dir).optional_host_permissions).toBeUndefined();
    }
  });
});
