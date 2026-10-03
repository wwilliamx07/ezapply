import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedHostPermissions, optionalHostPermissions, WORKDAY_HOST_PERMISSIONS } from "@ezapply/protocol";
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
  it("cover exactly the fixed hosts of the registry's sites (Workday's application hosts)", () => {
    for (const dir of ["dist", "dist-firefox"]) {
      expect(manifest(dir).host_permissions).toEqual(fixedHostPermissions());
      expect(manifest(dir).host_permissions).toEqual(expect.arrayContaining([...WORKDAY_HOST_PERMISSIONS]));
    }
  });

  it("let sites granted per origin (Oracle career sites, on any host) be granted one origin at a time", () => {
    for (const dir of ["dist", "dist-firefox"]) {
      expect(manifest(dir).optional_host_permissions).toEqual(optionalHostPermissions());
      expect(manifest(dir).optional_host_permissions).toEqual(["https://*/*"]);
    }
  });
});
