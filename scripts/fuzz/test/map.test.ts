import { describe, expect, it } from "vitest";
import { parsePage, readMap } from "../lib/map.ts";
import { SCENARIOS } from "../lib/scenarios.ts";

describe("the UI map", () => {
  it("reads a page: its marker, each control's selector, condition and target", () => {
    const problems: string[] = [];
    const page = parsePage(
      "panel/list",
      [
        "# The list",
        "",
        '**Marker:** `role=heading[name="Applications"]`',
        "",
        "| Control | When | Selector | Does | Leads to |",
        "|---|---|---|---|---|",
        '| Capture | | `role=button[name="Capture"]` | `capture` | [Application](application.md), [List](list.md) |',
        "| Stop | an agent works | `css=.ez-app button` | `panel.stop` | stays |",
        "| Finish | | `role=button[name=/^Finish (setup\\|later)$/]` | `finish` | [Done](../onboarding/finished.md) |",
        "| A line | | `css=.textLayer span` *(triple-click)* | Selects it | same |",
        '| Download | | `role=link[name="Download"]` | The bytes | a download |',
      ].join("\n"),
      problems,
    );
    expect(problems).toEqual([]);
    expect(page.title).toBe("The list");
    expect(page.marker).toBe('role=heading[name="Applications"]');
    expect(page.controls.map((c) => [c.label, c.when, c.selector, c.target])).toEqual([
      ["Capture", "", 'role=button[name="Capture"]', { kind: "page", pages: ["panel/application", "panel/list"] }],
      ["Stop", "an agent works", "css=.ez-app button", { kind: "stays" }],
      ["Finish", "", "role=button[name=/^Finish (setup|later)$/]", { kind: "page", pages: ["onboarding/finished"] }],
      ["A line", "", "css=.textLayer span", { kind: "same" }],
      ["Download", "", 'role=link[name="Download"]', { kind: "download" }],
    ]);
    expect(page.controls.map((c) => c.tripleClick)).toEqual([false, false, false, true, false]);
  });

  it("says what it can't read: no marker, a row without a selector or a target", () => {
    const problems: string[] = [];
    parsePage(
      "panel/x",
      "# X\n\n| Control | When | Selector | Does | Leads to |\n|---|---|---|---|---|\n| A | | none | x | somewhere |",
      problems,
    );
    expect(problems).toHaveLength(2);
  });

  it("holds together: every page has a marker, every link a page, every scenario its start page", () => {
    const map = readMap();
    expect(map.problems).toEqual([]);
    expect(map.pages.size).toBeGreaterThan(30);
    for (const sc of SCENARIOS) {
      expect(map.pages.has(sc.start), sc.name).toBe(true);
      expect(sc.start.startsWith(`${sc.section}/`), sc.name).toBe(true);
    }
  });
});
