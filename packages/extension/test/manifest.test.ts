import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKDAY_HOST_PERMISSIONS } from "@ezapply/protocol";
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
  it("cover exactly the Workday application hosts that site detection knows", () => {
    for (const dir of ["dist", "dist-firefox"]) {
      expect(manifest(dir).host_permissions).toEqual([...WORKDAY_HOST_PERMISSIONS]);
    }
  });
});
