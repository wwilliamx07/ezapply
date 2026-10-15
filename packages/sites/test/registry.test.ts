import { HOST_PERMISSIONS } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import { detectSite, FORM_SITE_IDS, isFormSite, SITES, siteSignatures } from "../src/registry.js";

describe("the site registry", () => {
  it("knows its own sites, and nothing else, as form sites", () => {
    for (const id of FORM_SITE_IDS) expect(isFormSite(id)).toBe(true);
    for (const id of ["generic", "", "sites", undefined]) expect(isFormSite(id)).toBe(false);
    expect(detectSite("https://example.com/careers/123")).toBe("generic");
  });

  it("has the extension hold every site, so it can read any page for a site's signature", () => {
    expect(HOST_PERMISSIONS).toEqual(["<all_urls>"]);
  });

  it("gives every site a signature, checked in registry order", () => {
    expect(siteSignatures().map(([id]) => id)).toEqual([...FORM_SITE_IDS]);
    for (const s of SITES) expect([s.id, s.signature.trim().length > 0]).toEqual([s.id, true]);
  });
});
