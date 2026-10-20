import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STANDARD_WAITS, type TabInfo } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import type { ExtensionBridge } from "../src/bridge/server.js";
import { type CallRecord, extractFiles, pruneDebug, stripBulk } from "../src/forms/debug.js";
import { debugReport } from "../src/forms/debug-report.js";
import {
  closestOptions,
  FormsService,
  leanFillResult,
  leanForm,
  MAX_INLINE_OPTIONS,
  MISS_OPTIONS,
} from "../src/forms/service.js";
import { loadTiming, TIMING_FILE, timingFileTemplate } from "../src/forms/timing.js";
import { createLogger } from "../src/logger.js";
import type { PostingsService } from "../src/postings/service.js";
import type { Workspace } from "../src/workspace/workspace.js";

const tab = (tabId: number): TabInfo => ({
  tabId,
  windowId: 1,
  url: `https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply?t=${tabId}`,
  title: "Apply",
  active: tabId === 7,
  site: "workday",
});

/**
 * A bridge whose page calls take a while and record how many run on each tab at once. Its status answers come
 * back in reverse order (the first asked is answered last), so a call can only keep its place by not racing.
 */
function slowBridge() {
  const running = new Map<number, number>();
  const most = new Map<number, number>();
  const order: string[] = [];
  let statuses = 0;
  const call = async (method: string, params: { tabId?: number; fieldId?: string }) => {
    if (method === "browser.status") {
      await new Promise((r) => setTimeout(r, Math.max(0, 20 - 5 * statuses++)));
      return { extensionVersion: "1", tabs: [tab(7), tab(8)] };
    }
    const id = params.tabId as number;
    running.set(id, (running.get(id) ?? 0) + 1);
    most.set(id, Math.max(most.get(id) ?? 0, running.get(id) ?? 0));
    order.push(`${id}:${params.fieldId}:start`);
    await new Promise((r) => setTimeout(r, 30));
    order.push(`${id}:${params.fieldId}:end`);
    running.set(id, (running.get(id) ?? 1) - 1);
    return [{ label: `options of ${params.fieldId}` }];
  };
  return { bridge: { call } as unknown as ExtensionBridge, most, order };
}

/** A workspace whose files live in `dir` (by default one without autofill-timing.yaml). */
const workspaceAt = (dir = join(tmpdir(), "ezapply-no-such-workspace")) =>
  ({ path: (...p: string[]) => join(dir, ...p) }) as unknown as Workspace;

/** FormsService over `bridge`, with focus emulation always on (`tab.show` is answered here, not by the bridge). */
function forms(bridge: ExtensionBridge, ws: Workspace = workspaceAt()) {
  const postings = { ownPosting: async () => null } as unknown as PostingsService;
  const shown = {
    call: (method: string, params: { tabId: number }, timeoutMs?: number) =>
      method === "tab.show"
        ? Promise.resolve({ tabId: params.tabId, emulated: true, hidden: false })
        : (bridge.call as (m: string, p: unknown, t?: number) => Promise<unknown>)(method, params, timeoutMs),
  } as unknown as ExtensionBridge;
  const reviews = { pending: () => false } as never;
  const profile = { profile: async () => ({ exists: false }) } as never;
  return new FormsService(ws, postings, shown, reviews, profile, createLogger({ toFile: false, level: "silent" }));
}

describe("form calls on one tab", () => {
  it("run one at a time and in order, each reading its own field, while other tabs aren't held up", async () => {
    const b = slowBridge();
    const f = forms(b.bridge);
    const results = await Promise.all([
      f.searchOptions("gender", "q", 7),
      f.searchOptions("disability", "q", 7),
      f.searchOptions("veteran", "q", 7),
      f.searchOptions("country", "q", 8),
    ]);
    expect(results.map((r) => (r as { label: string }[])[0]?.label)).toEqual([
      "options of gender",
      "options of disability",
      "options of veteran",
      "options of country",
    ]);
    expect(b.most.get(7)).toBe(1);
    const tab7 = b.order.filter((e) => e.startsWith("7:"));
    expect(tab7).toEqual([
      "7:gender:start",
      "7:gender:end",
      "7:disability:start",
      "7:disability:end",
      "7:veteran:start",
      "7:veteran:end",
    ]);
    // Tab 8 started before tab 7's queue had drained.
    expect(b.order.indexOf("8:country:start")).toBeLessThan(b.order.indexOf("7:veteran:start"));
  });

  it("keep going after a call fails", async () => {
    const b = slowBridge();
    const failing = {
      call: async (method: string, params: { tabId?: number; fieldId?: string }) => {
        if (method !== "browser.status" && params.fieldId === "broken") throw new Error("listbox never opened");
        return (b.bridge.call as (m: string, p: unknown) => Promise<unknown>)(method, params);
      },
    } as unknown as ExtensionBridge;
    const f = forms(failing);
    const [first, second] = await Promise.allSettled([
      f.searchOptions("broken", "q", 7),
      f.searchOptions("gender", "q", 7),
    ]);
    expect(first.status).toBe("rejected");
    expect(second).toMatchObject({ status: "fulfilled", value: [{ label: "options of gender" }] });
  });
});

describe("autofill-timing.yaml", () => {
  /** A bridge that records each call's params and timeout. */
  function recordingBridge() {
    const calls: { method: string; params: Record<string, unknown>; timeoutMs?: number }[] = [];
    const call = async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
      if (method === "browser.status") return { extensionVersion: "1", tabs: [tab(7)] };
      calls.push({ method, params, ...(timeoutMs ? { timeoutMs } : {}) });
      if (method === "form.get") {
        return {
          adapter: "workday",
          tabId: 7,
          url: tab(7).url,
          pageKind: "step",
          sections: [],
          addButtons: [],
          actions: [],
          errors: [],
        };
      }
      return [{ fieldId: "a", ok: true, readBack: "x" }];
    };
    return { bridge: { call } as unknown as ExtensionBridge, calls };
  }

  async function withFile(content: string | null, fn: (ws: Workspace) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-timing-"));
    try {
      if (content !== null) await writeFile(join(dir, TIMING_FILE), content, "utf8");
      await fn(workspaceAt(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("sends the defaults without a file, and the template changes nothing", async () => {
    await withFile(null, async (ws) => {
      expect(await loadTiming(ws)).toEqual({ timing: STANDARD_WAITS, fillTimeoutMs: 120_000, issues: [] });
    });
    await withFile(timingFileTemplate(), async (ws) => {
      expect(await loadTiming(ws)).toEqual({ timing: STANDARD_WAITS, fillTimeoutMs: 120_000, issues: [] });
    });
  });

  it("sends the file's waits with every call, scaled, and its fill timeout", async () => {
    await withFile("scale: 0.5\ndropdownOpenMs: 800\npollMs: 20\nfillTimeoutSeconds: 300\n", async (ws) => {
      const b = recordingBridge();
      const f = forms(b.bridge, ws);
      await f.getForm({ tabId: 7 });
      await f.fill([{ fieldId: "a", value: "x", source: "profile" }], 7);
      const [get, fill] = b.calls;
      expect(get?.params.timing).toMatchObject({
        dropdownOpenMs: 800,
        afterFieldMaxMs: 750,
        dropdownClosedMs: 100,
        pollMs: 20,
      });
      expect(fill?.params.timing).toEqual(get?.params.timing);
      expect(fill?.timeoutMs).toBe(300_000);
    });
  });

  it("reads the file for every call, so an edit applies to the next one", async () => {
    await withFile("dropdownOpenMs: 800\n", async (ws) => {
      const b = recordingBridge();
      const f = forms(b.bridge, ws);
      await f.getForm({ tabId: 7 });
      await writeFile(ws.path(TIMING_FILE), "dropdownOpenMs: 300\n", "utf8");
      await f.getForm({ tabId: 7 });
      expect(b.calls.map((c) => (c.params.timing as Record<string, number>).dropdownOpenMs)).toEqual([800, 300]);
    });
  });

  it("falls back to the default for each mistake and says so in get_form, without failing the call", async () => {
    await withFile("dropdownOpenMs: fast\nbogusMs: 5\nscale: 50\n", async (ws) => {
      const f = forms(recordingBridge().bridge, ws);
      const form = await f.getForm({ tabId: 7 });
      expect(form.pageKind).toBe("step");
      expect(form.timingIssues).toEqual([
        "autofill-timing.yaml: dropdownOpenMs must be a number from 0 to 120000; using the default.",
        'autofill-timing.yaml: unknown key "bogusMs" ignored.',
        "autofill-timing.yaml: scale must be a number from 0.1 to 10; using the default.",
      ]);
    });
    await withFile("dropdownOpenMs: [\n", async (ws) => {
      const loaded = await loadTiming(ws);
      expect(loaded.timing).toEqual(STANDARD_WAITS);
      expect(loaded.issues[0]).toMatch(/couldn't be read, so the defaults are used/);
    });
  });
});

describe("debug mode", () => {
  it("still records a call that timed out, with the bridge calls made before it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      await writeFile(join(dir, "ezapply.config.json"), JSON.stringify({ schemaVersion: 1, debug: { enabled: true } }));
      const bridge = {
        call: async (method: string) => {
          if (method === "browser.status") return { extensionVersion: "1", tabs: [tab(7)] };
          throw new Error("Request form.fill timed out after 120000 ms");
        },
      } as unknown as ExtensionBridge;
      const f = forms(bridge, workspaceAt(dir));
      await expect(f.fill([{ fieldId: "a", value: "x", source: "user" }], 7)).rejects.toThrow(/timed out/);
      await f.debugIdle();
      const session = join(dir, "debug", `${new Date().toISOString().slice(0, 10)}-no-posting`);
      const record = JSON.parse(await readFile(join(session, "0001-fill_fields.json"), "utf8"));
      expect(record).toMatchObject({
        tool: "fill_fields",
        params: { fills: [{ fieldId: "a", value: "x", source: "user" }] },
        bridge: [{ method: "form.fill", error: expect.stringMatching(/timed out/) }],
        error: { message: expect.stringMatching(/timed out/) },
      });
      expect(record.bridge[0].params).not.toHaveProperty("timing");
      const index = JSON.parse((await readFile(join(session, "index.jsonl"), "utf8")).trim());
      expect(index).toMatchObject({ seq: 1, tool: "fill_fields", ok: false, debug: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records nothing when it's off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      const f = forms(slowBridge().bridge, workspaceAt(dir));
      await f.searchOptions("gender", "q", 7);
      await f.debugIdle();
      await expect(readdir(join(dir, "debug"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps debug/ under its size, deleting the oldest sessions but never the current one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      for (const name of ["2026-09-01-a", "2026-09-02-b", "2026-09-03-c"]) {
        await mkdir(join(dir, name));
        await writeFile(join(dir, name, "0001-get_form.json"), "x".repeat(1000));
      }
      expect(await pruneDebug(dir, 1500, join(dir, "2026-09-01-a"))).toEqual([
        join(dir, "2026-09-02-b"),
        join(dir, "2026-09-03-c"),
      ]);
      expect(await readdir(dir)).toEqual(["2026-09-01-a"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops an upload's file contents from the record, keeping its size", () => {
    expect(
      stripBulk({ fieldId: "f", file: { name: "a.pdf", base64: "AAAA" }, tabId: 7, timing: {}, debug: {} }),
    ).toEqual({
      fieldId: "f",
      file: { name: "a.pdf", bytes: 3 },
    });
  });

  it("asks each adapter call for its trace and the markup debug.markup says, and notes an extension without one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      await writeFile(
        join(dir, "ezapply.config.json"),
        JSON.stringify({ schemaVersion: 1, debug: { enabled: true, markup: "always" } }),
      );
      const sent: { method: string; debug?: unknown }[] = [];
      // An extension built before the trace: it ignores `debug` and never calls back with one.
      const bridge = {
        call: async (method: string, params: { debug?: unknown }) => {
          sent.push({ method, debug: params.debug });
          if (method === "browser.status") return { extensionVersion: "1", tabs: [tab(7)] };
          if (method === "tab.show") return { tabId: 7, emulated: true, hidden: false };
          if (method === "form.searchOptions") return [{ label: "Yes" }];
          return {
            adapter: "workday",
            url: tab(7).url,
            pageKind: "step",
            sections: [],
            addButtons: [],
            actions: [],
            errors: [],
          };
        },
      } as unknown as ExtensionBridge;
      const f = forms(bridge, workspaceAt(dir));
      await f.searchOptions("gender", "q", 7);
      await f.debugIdle();
      // The page before the call is saved by a tool call's first adapter call only (e2e.test.ts sees the rest).
      expect(sent.filter((s) => s.method.startsWith("form.")).map((s) => s.debug)).toEqual([
        { before: true, after: true, failures: true },
      ]);
      expect(sent.filter((s) => !s.method.startsWith("form.")).every((s) => s.debug === undefined)).toBe(true);
      const session = join(dir, "debug", `${new Date().toISOString().slice(0, 10)}-no-posting`);
      const record = JSON.parse(await readFile(join(session, "0001-search_options.json"), "utf8"));
      expect(record.notes.noTrace).toEqual([expect.stringMatching(/built before it/)]);
      expect(await debugReport(session)).toMatch(/No adapter trace in 1 calls/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("takes the markup and screenshots out of the record, into files of their own", () => {
    const record = {
      bridge: [
        { method: "form.get", trace: { events: [], markup: { before: "<p>1</p>", after: "<p>2</p>" } } },
        {
          method: "form.fill",
          trace: {
            events: [],
            markup: {
              before: "<p>ignored: the first call's is kept</p>",
              after: "<p>3</p>",
              failures: [
                { fieldId: "work-experience-1.jobTitle#2", html: "<p>a</p>" },
                { fieldId: "work-experience-1.jobTitle#2", html: "<p>b</p>" },
              ],
            },
            screenshot: Buffer.from("png").toString("base64"),
          },
        },
      ],
    } as unknown as CallRecord;
    const files = new Map(extractFiles(record, "0004"));
    expect([...files.keys()]).toEqual([
      "0004-before.html",
      "0004-after.html",
      "0004-fail-work-experience-1.jobTitle_2.html",
      "0004-fail-work-experience-1.jobTitle_2-2.html",
      "0004-fail.png",
    ]);
    expect(files.get("0004-before.html")).toBe("<p>1</p>");
    expect(files.get("0004-after.html")).toBe("<p>3</p>");
    expect(files.get("0004-fail.png")).toEqual(Buffer.from("png"));
    expect(record.bridge[1]?.trace).toMatchObject({
      markup: {
        before: "0004-before.html",
        after: "0004-after.html",
        failures: [
          { fieldId: "work-experience-1.jobTitle#2", file: "0004-fail-work-experience-1.jobTitle_2.html" },
          { fieldId: "work-experience-1.jobTitle#2", file: "0004-fail-work-experience-1.jobTitle_2-2.html" },
        ],
      },
      screenshot: "0004-fail.png",
    });
  });
});

describe("leanForm", () => {
  const field = (id: string, options?: string[]) => ({
    id,
    label: id,
    required: false,
    kind: "dropdown" as const,
    currentValue: null,
    ...(options ? { options } : {}),
  });
  const form = (fields: ReturnType<typeof field>[]) =>
    ({ sections: [{ id: "s", title: "S", fields }] }) as unknown as Parameters<typeof leanForm>[0];

  it("sends a long option list as its count, a short one as it is", () => {
    const many = Array.from({ length: MAX_INLINE_OPTIONS + 1 }, (_, i) => `Issuer ${i}`);
    const lean = leanForm(form([field("issuer", many), field("yes-no", ["Yes", "No"]), field("free", [])]));
    expect(lean.sections[0]?.fields).toEqual([
      { id: "issuer", label: "issuer", kind: "dropdown", currentValue: null, optionCount: MAX_INLINE_OPTIONS + 1 },
      { id: "yes-no", label: "yes-no", kind: "dropdown", currentValue: null, options: ["Yes", "No"] },
      { id: "free", label: "free", kind: "dropdown", currentValue: null },
    ]);
  });
});

describe("a fill that misses", () => {
  it("returns the closest options, closest first, and how many there were", () => {
    const issuers = Array.from({ length: 400 }, (_, i) => `Issuer ${i}`);
    const options = [...issuers.slice(0, 200), "Amazon Web Services (AWS)", ...issuers.slice(200)];
    const r = leanFillResult(
      { fieldId: "cert", ok: false, error: "No option matches", availableOptions: options },
      "AWS",
    );
    expect(r.availableOptions).toHaveLength(MISS_OPTIONS);
    expect(r.availableOptions?.[0]).toBe("Amazon Web Services (AWS)");
    expect(r.optionCount).toBe(401);
    expect(closestOptions("Master's degree", ["Undergraduate", "Ph.D", "Masters"], 10)).toEqual([
      "Masters",
      "Undergraduate",
      "Ph.D",
    ]);
  });

  it("ranks a typeahead entry's suggestions the same way, nested paths included", () => {
    const r = leanFillResult(
      {
        fieldId: "source",
        ok: false,
        unmatched: [{ value: "LinkedIn", suggestions: ["Company Website", "Job Board > LinkedIn"] }],
      },
      "LinkedIn",
    );
    expect(r.unmatched?.[0]?.suggestions).toEqual(["Job Board > LinkedIn", "Company Website"]);
    expect(r.optionCount).toBeUndefined();
  });
});
