// @vitest-environment jsdom

import { T } from "@ezapply/engine/timing";
import type { DebugTrace } from "@ezapply/engine/trace";
import { STANDARD_WAITS } from "@ezapply/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomShims } from "../../engine/test/shims.js";
import { buildWorkdayStep, type StepOptions } from "../src/workday/test/fixture.js";
import { createWorkdayApi } from "./adapters.js";

installDomShims(document.defaultView as Window);

const URL = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply";
let api: ReturnType<typeof createWorkdayApi>;

const build = (opts: StepOptions = {}) => {
  buildWorkdayStep(document, opts);
  api = createWorkdayApi(document, () => URL);
};
const id = (automationId: string) =>
  api
    .getForm()
    .sections.flatMap((s) => s.fields)
    .find((f) => f.automationId === automationId)?.id as string;
const events = (trace: DebugTrace | undefined, k: string) => (trace?.events ?? []).filter((e) => e.k === k);

beforeEach(() => build());
afterEach(() => {
  api.takeDebug();
  api.setTiming(null);
});

/** What debug mode installs on the page, as it is without it. */
const pageAsItIs = () => ({
  querySelector: Element.prototype.querySelector,
  querySelectorAll: Document.prototype.querySelectorAll,
  getElementById: Document.prototype.getElementById,
  fetch: window.fetch,
  consoleError: console.error,
  xhrSend: XMLHttpRequest.prototype.send,
  wait: Object.getOwnPropertyDescriptor(T, "dropdownOpenMs"),
});

describe("the adapter trace (debug mode)", () => {
  it("with debug off, installs nothing and records nothing", async () => {
    const before = pageAsItIs();
    const [r] = await api.fill([{ fieldId: id("formField-countryDropdown"), value: "Canada" }]);
    expect(r?.ok).toBe(true);
    expect(api.takeDebug()).toBeUndefined();
    expect(pageAsItIs()).toEqual(before);
    expect(before.wait).toMatchObject({ value: STANDARD_WAITS.dropdownOpenMs, writable: true });
  });

  it("takes every hook off again when the trace is taken", async () => {
    const before = pageAsItIs();
    api.setDebug({});
    expect(Element.prototype.querySelector).not.toBe(before.querySelector);
    expect(Object.getOwnPropertyDescriptor(T, "dropdownOpenMs")).toHaveProperty("get");
    await api.fill([{ fieldId: id("formField-legalName--firstName"), value: "Jane" }]);
    expect(api.takeDebug()).toBeDefined();
    expect(pageAsItIs()).toEqual(before);
    expect(T).toEqual(STANDARD_WAITS);
  });

  it("lists a dropdown's open, the listbox read, the match, and each wait's planned and actual time", async () => {
    const country = id("formField-countryDropdown");
    api.setDebug({});
    await api.fill([{ fieldId: country, value: "canada" }]);
    const trace = api.takeDebug();

    expect(trace?.page.before).toMatchObject({ url: URL, step: { title: "My Information", index: 1 } });
    expect(trace?.page.after?.visibility).toEqual(expect.any(String));
    expect(events(trace, "field")).toEqual([
      expect.objectContaining({ op: "fill", fieldId: country, ok: true, ms: expect.any(Number) }),
    ]);
    expect(events(trace, "press")[0]).toMatchObject({ el: 'button "Select One"' });
    expect(events(trace, "listbox")).toEqual([
      expect.objectContaining({
        read: "ul#lb-country(listbox)",
        options: ["Canada", "United States of America", "United Kingdom"],
      }),
    ]);
    expect(events(trace, "match")).toEqual([expect.objectContaining({ wanted: "canada", of: 3, chosen: "Canada" })]);
    expect(events(trace, "wait")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "waitFor",
          name: "dropdownOpenMs",
          max: T.dropdownOpenMs,
          end: "condition",
          ms: expect.any(Number),
        }),
        expect.objectContaining({
          kind: "settle",
          name: "afterFieldMaxMs",
          quiet: "afterFieldQuietMs",
          end: expect.stringMatching(/^(quiet|max)$/),
        }),
      ]),
    );
    // Queries by the adapter, with how many elements each found; a polling wait's repeats are one entry.
    expect(events(trace, "query")).toEqual(
      expect.arrayContaining([expect.objectContaining({ sel: '[role="listbox"]', in: "document" })]),
    );
    // The listbox appearing and going, and the button's text changing, as DOM changes.
    expect(trace?.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ k: "+", el: "ul#lb-country(listbox)" }),
        expect.objectContaining({ k: "-", el: "ul#lb-country(listbox)" }),
      ]),
    );
    expect(trace?.failedFields).toEqual([]);
  });

  it("names a wait the companion shortened by its key, as the adapter used it", async () => {
    api.setTiming({ ...STANDARD_WAITS, dropdownOpenMs: 333 });
    api.setDebug({});
    await api.fill([{ fieldId: id("formField-countryDropdown"), value: "Canada" }]);
    const open = events(api.takeDebug(), "wait").find((w) => w.name === "dropdownOpenMs");
    expect(open).toMatchObject({ max: 333 });
  });

  it("snapshots a failed field with its section and the list it read, and the page before and after", async () => {
    const country = id("formField-countryDropdown");
    api.setDebug({ before: true, after: true, failures: true });
    const res = await api.fill([
      { fieldId: id("formField-legalName--firstName"), value: "Jane" },
      { fieldId: country, value: "Atlantis" },
    ]);
    expect(res.map((r) => r.ok)).toEqual([true, false]);
    const trace = api.takeDebug();
    expect(trace?.failedFields).toEqual([country]);
    expect(events(trace, "match")).toEqual([
      expect.objectContaining({
        wanted: "Atlantis",
        options: ["Canada", "United States of America", "United Kingdom"],
      }),
    ]);
    const [failure] = trace?.markup?.failures ?? [];
    expect(failure?.fieldId).toBe(country);
    expect(failure?.html).toMatch(/formField-countryDropdown/);
    // The list had closed before the fill returned: the copy kept from when the page removed it.
    expect(failure?.html).toMatch(/the last popup the page closed[\s\S]*United Kingdom/);

    expect(trace?.markup?.before).toMatch(/^<!doctype html>/);
    expect(trace?.markup?.before).not.toMatch(/value="Jane"/);
    expect(trace?.markup?.after).toMatch(/value="Jane"/);
    expect(trace?.markup?.after).not.toMatch(/<script|<style/);
  });

  it("records the slow paths a filler took", async () => {
    build({ dateNeedsSecondPass: true });
    api.setDebug({});
    await api.fill([{ fieldId: id("formField-startDate"), value: "2024-12" }]);
    expect(events(api.takeDebug(), "branch")).toEqual([expect.objectContaining({ name: "date entered again" })]);

    build({ liveDropdowns: true, dismissedIgnoresNextPress: true });
    api.setTiming({ ...STANDARD_WAITS, dropdownOpenMs: 300, dropdownOpenRetryMs: 300 });
    const degree = id("formField-degreeLevel");
    await api.listOptions(degree);
    api.setDebug({});
    await api.fill([{ fieldId: degree, value: "Masters" }]);
    const trace = api.takeDebug();
    expect(events(trace, "react")).toEqual([expect.objectContaining({ handler: "onClick", missing: true })]);
    expect(events(trace, "branch")).toEqual([expect.objectContaining({ name: "dropdown re-open" })]);
    expect(events(trace, "wait")).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "dropdownOpenRetryMs", end: "max", max: 300 })]),
    );
  });

  it("records the page's errors and requests during the call, never a request's query or body", async () => {
    const calls: string[] = [];
    window.fetch = (async (input: string) => {
      calls.push(input);
      return { status: 503 } as Response;
    }) as typeof fetch;
    const logged = console.error;
    console.error = () => {};
    api.setDebug({});
    await window.fetch("https://acme.wd5.myworkdayjobs.com/wday/cxs/save?token=secret", {
      method: "post",
      body: "Jane",
    });
    console.error("widget threw", new Error("boom"));
    window.dispatchEvent(new ErrorEvent("error", { message: "Uncaught TypeError: x is undefined" }));
    api.getForm();
    const trace = api.takeDebug();
    console.error = logged;
    expect(calls).toEqual(["https://acme.wd5.myworkdayjobs.com/wday/cxs/save?token=secret"]);
    expect(trace?.requests).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "https://acme.wd5.myworkdayjobs.com/wday/cxs/save",
        status: 503,
      }),
    ]);
    expect(JSON.stringify(trace?.requests)).not.toMatch(/secret|Jane/);
    expect(trace?.errors).toEqual([
      expect.objectContaining({ k: "console", message: "widget threw boom" }),
      expect.objectContaining({ k: "error", message: "Uncaught TypeError: x is undefined" }),
    ]);
  });

  it("drops a trace left running by a call the companion gave up on, when the next one starts", async () => {
    api.setDebug({});
    await api.fill([{ fieldId: id("formField-legalName--firstName"), value: "Jane" }]);
    api.setDebug({});
    const trace = api.takeDebug();
    expect(trace?.events).toEqual([]);
  });
});
