import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageMarkup } from "@ezapply/engine/markup";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomShims } from "../../engine/test/shims.js";
import { workday } from "../../sites/src/workday/definition/site.js";
import { buildWorkdayStep } from "../../sites/src/workday/test/fixture.js";
import { createWorkdayApi, extractPage } from "../../sites/test/adapters.js";
import { debugExport, profileStrings } from "../src/forms/debug-export.js";

const URL = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply";
const PROFILE = `schemaVersion: 1
identity: { firstName: Janelle, lastName: Quinterro }
contact:
  email: janelle@example.com
  phone: "+1 555 0100"
  address: { city: Springfield, country: Canada }
`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezapply-export-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A Workday step on its own page, filled with the profile's values. */
async function filledStep() {
  const dom = new JSDOM("<!doctype html><html><head><title>Apply</title></head><body></body></html>", { url: URL });
  installDomShims(dom.window as unknown as Window);
  const doc = dom.window.document;
  buildWorkdayStep(doc);
  // The account the user is signed in with, in the page's header.
  doc.body.insertAdjacentHTML(
    "afterbegin",
    '<button data-automation-id="utilityButtonSignIn" aria-label="Janelle Quinterro">janelle@example.com</button>',
  );
  const api = createWorkdayApi(doc, () => URL);
  const ids = Object.fromEntries(
    api
      .getForm()
      .sections.flatMap((s) => s.fields)
      .map((f) => [f.automationId, f.id]),
  );
  const res = await api.fill([
    { fieldId: ids["formField-legalName--firstName"] as string, value: "Janelle" },
    { fieldId: ids["formField-countryDropdown"] as string, value: "Canada" },
    { fieldId: ids["formField-previousWorker"] as string, value: "No" },
    { fieldId: ids["formField-agreement"] as string, value: true },
  ]);
  expect(res.every((r) => r.ok)).toBe(true);
  return { doc, schema: api.getForm() };
}

const fieldsOf = (html: string) => {
  const dom = new JSDOM(html.replace(/^<!--[\s\S]*?-->\s*/, ""), { url: URL });
  return extractPage(workday, dom.window.document, URL).schema.sections.flatMap((s) => s.fields);
};

describe("ezapply debug export", () => {
  it("writes a fixture with no values and no profile strings, from which extraction gives the same fields", async () => {
    const { doc, schema } = await filledStep();
    const before = pageMarkup(doc);
    expect(before).toMatch(/value="Janelle"/);
    await writeFile(join(dir, "0003-before.html"), before);
    await writeFile(
      join(dir, "0003-fill_fields.json"),
      JSON.stringify({
        seq: 3,
        tool: "fill_fields",
        bridge: [{ method: "form.get", result: { ...schema, job: { title: "Widget Wrangler" } } }],
      }),
    );

    const r = await debugExport(dir, "3", "before", PROFILE);
    expect(r.file).toBe(join(dir, "0003-before.fixture.html"));
    const out = await readFile(r.file, "utf8");
    expect(out).toMatch(/^<!-- Debug export of a workday step, step "My Information" \(1 of 3\) \(0003-before\.html\)/);
    for (const s of ["Janelle", "Quinterro", "janelle@example.com", "Canada", 'aria-checked="true"']) {
      expect(out).not.toContain(s);
    }
    const inputs = out.match(/<input[^>]*>/g) ?? [];
    expect(inputs.filter((i) => /type="(text|email|tel)"[^>]*value=|\schecked[\s=>]/.test(i))).toEqual([]);
    // The values were blanked first; the header's name and email are left for the profile's strings.
    expect(r.replaced.profile).toBe(3);
    // "Have you previously worked for Acme?": the tenant, wherever it shows.
    expect(out).not.toMatch(/acme/i);
    expect(r.replaced.tenant).toBeGreaterThan(0);
    expect(r.values).toBeGreaterThanOrEqual(3);

    const original = fieldsOf(before);
    const exported = fieldsOf(out);
    expect(exported.map((f) => [f.id, f.kind])).toEqual(original.map((f) => [f.id, f.kind]));
    expect(exported.find((f) => f.automationId === "formField-legalName--firstName")?.currentValue).toBe("");
    expect(exported.find((f) => f.automationId === "formField-countryDropdown")?.currentValue).toBeNull();
  });

  it("says when the call saved no such page", async () => {
    await expect(debugExport(dir, "7", "after", null)).rejects.toThrow(/No 0007-after\.html/);
  });

  it("replaces whole profile values of three characters or more, longest first", () => {
    expect(profileStrings(PROFILE)).toEqual([
      "janelle@example.com",
      "+1 555 0100",
      "Springfield",
      "Quinterro",
      "Janelle",
      "Canada",
    ]);
  });
});
